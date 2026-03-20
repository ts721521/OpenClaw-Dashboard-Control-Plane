// @ts-nocheck
import { fetchJSON } from './actions';
import { state, safe } from './state';

(window as any).__SYSTEM_DASHBOARD_BOOTSTRAP__ = true;

function fmtTime(v) {
  return new Date(v || Date.now()).toLocaleString('zh-CN');
}

async function requestJSON(url, method = 'GET', payload = null) {
  const response = await fetch(url, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function graphViewKey() {
  if (state.view === 'architecture') return 'architecture';
  if (state.view === 'inter-team-flow') return 'inter-team-flow';
  if (state.view === 'team-workflow') return 'team-workflow';
  return null;
}

function graphZoom(view = state.view) {
  return Number(state.graphZoom?.[view] || 1);
}

function graphLayout(view = state.view) {
  if (view === 'architecture') return state.architectureLayout || { positions: {} };
  if (view === 'inter-team-flow') return state.interTeamLayout || { positions: {} };
  return { positions: {} };
}

function getSavedPosition(view, key, fallback) {
  const positions = graphLayout(view)?.positions || {};
  const point = positions[key];
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return fallback;
  return point;
}

function clampPoint(point) {
  return {
    x: Math.max(24, Math.round(point.x || 0)),
    y: Math.max(24, Math.round(point.y || 0)),
  };
}

function setSavedPosition(view, key, point) {
  if (view === 'architecture') {
    state.architectureLayout = state.architectureLayout || { positions: {}, updatedAt: null };
    state.architectureLayout.positions[key] = { x: Math.round(point.x), y: Math.round(point.y) };
    return;
  }
  if (view === 'inter-team-flow') {
    state.interTeamLayout = state.interTeamLayout || { positions: {}, updatedAt: null };
    state.interTeamLayout.positions[key] = { x: Math.round(point.x), y: Math.round(point.y) };
  }
}

function architectureAutoPositions() {
  const positions = {};
  const teams = state.teams || [];
  const standalone = state.standaloneAgents || [];
  const cols = Math.max(1, Math.min(3, teams.length || 1));
  teams.forEach((team, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    positions[`team:${team.team_id}`] = {
      x: 80 + col * 290,
      y: 70 + row * 190,
    };
  });
  const standaloneBaseY = 90 + Math.max(1, Math.ceil(teams.length / cols)) * 190;
  standalone.forEach((agent, index) => {
    const side = index % 2 === 0 ? 'left' : 'right';
    const lane = Math.floor(index / 2);
    positions[`agent:${agent.agent_id}`] = {
      x: side === 'left' ? 24 : 80 + cols * 290,
      y: standaloneBaseY + lane * 88,
    };
  });
  return positions;
}

function interTeamAutoPositions() {
  const positions = {};
  const teams = state.teams || [];
  const edges = (state.architecture?.edges || []).filter((edge) => edge.type === 'business_flow');
  const indegree = new Map();
  const levels = new Map();
  teams.forEach((team) => indegree.set(team.team_id, 0));
  edges.forEach((edge) => indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1));
  const queue = teams.filter((team) => !indegree.get(team.team_id)).map((team) => team.team_id);
  while (queue.length) {
    const current = queue.shift();
    const currentLevel = levels.get(current) || 0;
    edges.filter((edge) => edge.from === current).forEach((edge) => {
      const nextLevel = Math.max(levels.get(edge.to) || 0, currentLevel + 1);
      levels.set(edge.to, nextLevel);
      indegree.set(edge.to, (indegree.get(edge.to) || 1) - 1);
      if ((indegree.get(edge.to) || 0) <= 0) queue.push(edge.to);
    });
  }
  const buckets = new Map();
  teams.forEach((team) => {
    const level = levels.get(team.team_id) || 0;
    const list = buckets.get(level) || [];
    list.push(team);
    buckets.set(level, list);
  });
  Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([level, list]) => {
      list.forEach((team, index) => {
        positions[`team:${team.team_id}`] = {
          x: 80 + level * 300,
          y: 70 + index * 170,
        };
      });
    });
  return positions;
}

function graphAutoPositions(view) {
  if (view === 'architecture') return architectureAutoPositions();
  if (view === 'inter-team-flow') return interTeamAutoPositions();
  return {};
}

function mergePositions(view, autoPositions) {
  const saved = graphLayout(view)?.positions || {};
  const result = { ...autoPositions };
  Object.entries(saved).forEach(([key, value]) => {
    if (!value || typeof value.x !== 'number' || typeof value.y !== 'number') return;
    result[key] = clampPoint(value as any);
  });
  return result;
}

function stageSizeFromPositions(entries, fallbackWidth = 980, fallbackHeight = 620) {
  let maxX = 0;
  let maxY = 0;
  entries.forEach(({ x, y, w, h }) => {
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });
  return {
    width: Math.max(fallbackWidth, maxX + 100),
    height: Math.max(fallbackHeight, maxY + 120),
  };
}

async function persistLayout(view) {
  if (view === 'architecture') {
    state.architectureLayout = await requestJSON('/api/architecture/layout', 'PUT', {
      positions: state.architectureLayout?.positions || {},
    });
  } else if (view === 'inter-team-flow') {
    state.interTeamLayout = await requestJSON('/api/inter-team-flow/layout', 'PUT', {
      positions: state.interTeamLayout?.positions || {},
    });
  }
}

function clearLayout(view) {
  if (view === 'architecture') state.architectureLayout = { positions: {}, updatedAt: null };
  if (view === 'inter-team-flow') state.interTeamLayout = { positions: {}, updatedAt: null };
}

async function applyAutoLayout(view) {
  const positions = graphAutoPositions(view);
  if (view === 'architecture') {
    state.architectureLayout = { positions, updatedAt: null };
  } else if (view === 'inter-team-flow') {
    state.interTeamLayout = { positions, updatedAt: null };
  }
  await persistLayout(view);
}

function enableCanvasPanning(scroll) {
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let active = false;
  scroll.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.node')) return;
    active = true;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = scroll.scrollLeft;
    originTop = scroll.scrollTop;
    scroll.classList.add('panning');
  });
  window.addEventListener('pointermove', (event) => {
    if (!active) return;
    scroll.scrollLeft = originLeft - (event.clientX - startX);
    scroll.scrollTop = originTop - (event.clientY - startY);
  });
  window.addEventListener('pointerup', () => {
    active = false;
    scroll.classList.remove('panning');
  });
}

function fitCurrentView() {
  const view = graphViewKey();
  if (!view) return;
  const scroll = document.getElementById('stageScroll');
  const inner = document.getElementById('stageInner');
  if (!scroll || !inner) return;
  const width = Number(inner.dataset.baseWidth || inner.clientWidth || 1);
  const height = Number(inner.dataset.baseHeight || inner.clientHeight || 1);
  const scale = Math.max(0.55, Math.min(1.1, Math.min(scroll.clientWidth / width, scroll.clientHeight / height)));
  state.graphZoom[view] = Number(scale.toFixed(2));
  renderAll();
}

function updateGraphControls() {
  const view = graphViewKey();
  const isLayoutView = view === 'architecture' || view === 'inter-team-flow';
  const zoomIn = document.getElementById('zoomInBtn');
  const zoomOut = document.getElementById('zoomOutBtn');
  const fit = document.getElementById('fitViewBtn');
  const autoLayout = document.getElementById('autoLayoutBtn');
  const resetLayout = document.getElementById('resetLayoutBtn');
  if (zoomIn) zoomIn.toggleAttribute('disabled', !view);
  if (zoomOut) zoomOut.toggleAttribute('disabled', !view);
  if (fit) fit.toggleAttribute('disabled', !view);
  if (autoLayout) autoLayout.toggleAttribute('disabled', !isLayoutView);
  if (resetLayout) resetLayout.toggleAttribute('disabled', !isLayoutView);
}

function getTeamById(teamId) {
  return (state.teams || []).find((team) => team.team_id === teamId) || null;
}

function getStandaloneById(agentId) {
  return (state.standaloneAgents || []).find((agent) => agent.agent_id === agentId) || null;
}

function getMemberById(agentId) {
  for (const team of state.teams || []) {
    const member = (team.members || []).find((item) => item.agent_id === agentId);
    if (member) {
      return { ...member, team_id: team.team_id, team_name: team.team_name };
    }
  }
  return null;
}

function teamTasks(teamId) {
  return (state.tasks || []).filter((task) => {
    const flow = Array.isArray(task.team_flow) ? task.team_flow : [];
    return task.team === teamId || flow.includes(teamId);
  });
}

function taskAlertLabel(task) {
  if (task.runtime_state === 'stalled') return '停滞';
  if (task.status === 'pending') return '待推进';
  if (task.status === 'in_progress') return '运行中';
  return safe(task.status);
}

function tasksForFlow(flowId) {
  if (!flowId) return [];
  if (String(flowId).startsWith('team:')) {
    const teamId = String(flowId).split(':', 2)[1];
    return teamTasks(teamId);
  }
  if (String(flowId).startsWith('task:')) {
    const taskId = String(flowId).split(':', 2)[1];
    return (state.tasks || []).filter((task) => task.task_id === taskId);
  }
  return [];
}

function activeCount(list) {
  return list.filter((item) => item.status === 'in_progress').length;
}

function alertCount(list) {
  return list.filter((item) => item.runtime_state === 'stalled' || item.status === 'pending').length;
}

function renderTaskQueueItems(title, tasks, emptyText, hrefBuilder) {
  return `
    <section class="card">
      <h4>${safe(title)}</h4>
      <ul class="queue-list">
        ${
          (tasks || []).length
            ? tasks
                .slice(0, 5)
                .map(
                  (task) => `
              <li>
                <div>
                  <strong>${safe(task.task_name || task.task_id)}</strong>
                  <div class="muted" style="font-size:12px;line-height:1.5;margin-top:4px;">
                    ${safe(task.current_responsible || task.owner || '-')} · ${safe(task.closure_state || task.status || '-')}
                    ${task.closure_reason ? ` · ${safe(task.closure_reason)}` : ''}
                  </div>
                </div>
                <a class="btn" href="${safe(hrefBuilder(task))}">打开</a>
              </li>
            `
                )
                .join('')
            : `<li>${safe(emptyText)}</li>`
        }
      </ul>
    </section>
  `;
}

function currentTeamForObject() {
  if (state.selectedObjectType === 'team') return state.selectedObjectId;
  if (state.selectedObjectType === 'member') {
    const member = getMemberById(state.selectedObjectId);
    return member?.team_id || null;
  }
  if (state.selectedObjectType === 'agent') {
    const edges = (state.architecture?.edges || []).filter((edge) => edge.type === 'standalone_collab' && edge.from === state.selectedObjectId);
    return edges[0]?.to || null;
  }
  return null;
}

function graphEditTarget(view = state.view) {
  if (view === 'architecture') return { kind: 'architecture', targetId: 'default' };
  if (view === 'inter-team-flow') return { kind: 'inter-team-flow', targetId: state.interTeamFlowId || 'inter-team:default' };
  if (view === 'team-workflow') return { kind: 'team-workflow', targetId: state.selectedTeamId || state.teams?.[0]?.team_id || null };
  return null;
}

async function loadGraphEdit(view = state.view) {
  const target = graphEditTarget(view);
  if (!target || !target.targetId) return;
  state.graphEdit[target.kind] = await requestJSON(`/api/graph-edit/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.targetId)}`);
}

function graphEditPayload(view = state.view) {
  const target = graphEditTarget(view);
  if (!target) return null;
  return state.graphEdit[target.kind] || null;
}

function currentGraphForView(view = state.view) {
  const payload = graphEditPayload(view);
  if (payload?.draft_graph) return payload.draft_graph;
  if (payload?.current_graph) return payload.current_graph;
  return null;
}

function graphVisualState(view = state.view) {
  const payload = graphEditPayload(view);
  const currentGraph = payload?.current_graph || null;
  const draftGraph = payload?.draft_graph || null;
  const pendingGraph = payload?.implementation?.implementation_result_graph || null;
  if (draftGraph) return { graph: draftGraph, compareGraph: currentGraph, mode: 'pending' };
  if (pendingGraph) return { graph: currentGraph, compareGraph: pendingGraph, mode: 'current' };
  return { graph: currentGraph, compareGraph: null, mode: 'current' };
}

function setDraftGraph(view, graph) {
  const target = graphEditTarget(view);
  if (!target) return;
  const payload = state.graphEdit[target.kind] || { kind: target.kind, target_id: target.targetId };
  payload.draft_graph = JSON.parse(JSON.stringify(graph || {}));
  state.graphEdit[target.kind] = payload;
}

function discardDraftGraph(view) {
  const payload = graphEditPayload(view);
  if (!payload) return;
  payload.draft_graph = null;
}

function connectPendingNode(view = state.view) {
  return state.graphConnectPending?.[view] || null;
}

function clearGraphConnect(view = state.view) {
  if (!state.graphConnectPending) return;
  state.graphConnectPending[view] = null;
  if (state.graphConnectDrag) state.graphConnectDrag[view] = null;
}

function connectDragState(view = state.view) {
  return state.graphConnectDrag?.[view] || null;
}

function curvePathData(x1, y1, x2, y2) {
  const dx = Math.max(42, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function updateWirePreview(view, pointer) {
  const drag = connectDragState(view);
  const svg = document.getElementById('edges');
  if (!drag || !svg) return;
  let path = svg.querySelector('.wire-preview');
  if (!path) {
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'wire-preview');
    svg.appendChild(path);
  }
  const target = drag.hoverTarget?.bounds || null;
  const x2 = target ? target.x : Number(pointer?.x || drag.pointer?.x || drag.origin.x);
  const y2 = target ? target.y : Number(pointer?.y || drag.pointer?.y || drag.origin.y);
  path.setAttribute('d', curvePathData(drag.origin.x, drag.origin.y, x2, y2));
}

function clearWirePreview() {
  document.querySelectorAll('#edges .wire-preview').forEach((node) => node.remove());
}

function startGraphConnectDrag(view, sourceRef, origin, pointerId) {
  state.graphConnectPending[view] = sourceRef;
  state.graphConnectDrag[view] = {
    source: sourceRef,
    origin,
    pointer: origin,
    pointerId,
    hoverTarget: null,
  };
  updateWirePreview(view, origin);
}

function updateGraphConnectHover(view, targetRef, bounds) {
  const drag = connectDragState(view);
  if (!drag) return;
  if (!targetRef) {
    drag.hoverTarget = null;
    updateWirePreview(view, drag.pointer);
    return;
  }
  if (drag.source?.id === targetRef.id && drag.source?.type === targetRef.type) {
    drag.hoverTarget = null;
    updateWirePreview(view, drag.pointer);
    return;
  }
  drag.hoverTarget = { ...targetRef, bounds };
  updateWirePreview(view, drag.pointer);
}

function finishGraphConnectDrag(view) {
  const drag = connectDragState(view);
  if (!drag) return false;
  const target = drag.hoverTarget || null;
  if (target && !(drag.source?.id === target.id && drag.source?.type === target.type)) {
    const graphDoc = JSON.parse(JSON.stringify(currentGraphForView(view) || { nodes: [], edges: [] }));
    const result = appendGraphEdge(view, graphDoc, drag.source, target);
    if (!result.ok) {
      alert(result.message || '图上连线失败。');
      clearGraphConnect(view);
      clearWirePreview();
      renderAll();
      return true;
    }
    setDraftGraph(view, graphDoc);
  }
  clearGraphConnect(view);
  clearWirePreview();
  renderAll();
  return true;
}

function edgeDefaultsForView(view) {
  if (view === 'inter-team-flow') {
    return {
      handoffType: String(document.getElementById('interTeamEdgeType')?.value || 'normal').trim(),
      condition: String(document.getElementById('interTeamEdgeCondition')?.value || '通过').trim() || '通过',
      requiresConfirmation: false,
    };
  }
  if (view === 'team-workflow') {
    return {
      transitionType: String(document.getElementById('teamWorkflowEdgeType')?.value || 'normal').trim(),
      condition: String(document.getElementById('teamWorkflowEdgeCondition')?.value || '通过').trim() || '通过',
      requiresConfirmation: false,
    };
  }
  return {};
}

function appendGraphEdge(view, graphDoc, fromNode, toNode) {
  if (!fromNode || !toNode || fromNode.id === toNode.id) return { ok: false, message: '来源和目标不能是同一个节点。' };
  graphDoc.edges = graphDoc.edges || [];
  if (view === 'architecture') {
    if (fromNode.type === 'team' && toNode.type === 'team') {
      const exists = graphDoc.edges.some((edge) => edge.from === fromNode.id && edge.to === toNode.id && edge.type === 'business_flow');
      if (exists) return { ok: false, message: '该团队上下游关系已存在。' };
      graphDoc.edges.push({ key: `${fromNode.id}->${toNode.id}:business_flow`, from: fromNode.id, to: toNode.id, type: 'business_flow' });
      return { ok: true };
    }
    if (fromNode.type === 'agent' && toNode.type === 'team') {
      const exists = graphDoc.edges.some((edge) => edge.from === fromNode.id && edge.to === toNode.id && edge.type === 'standalone_collab');
      if (exists) return { ok: false, message: '该独立 Agent 协作关系已存在。' };
      graphDoc.edges.push({ key: `${fromNode.id}->${toNode.id}:standalone_collab`, from: fromNode.id, to: toNode.id, type: 'standalone_collab' });
      return { ok: true };
    }
    return { ok: false, message: '架构关系图只支持 团队→团队 或 独立Agent→团队 的连线。' };
  }
  if (view === 'inter-team-flow') {
    const defaults = edgeDefaultsForView(view);
    const type = defaults.handoffType || 'normal';
    const exists = graphDoc.edges.some((edge) => edge.from === fromNode.id && edge.to === toNode.id && String(edge.handoffType || 'normal') === String(type));
    if (exists) return { ok: false, message: '该团队交接关系已存在。' };
    graphDoc.edges.push({
      key: `${fromNode.id}->${toNode.id}:${type}`,
      from: fromNode.id,
      to: toNode.id,
      handoffType: type,
      condition: defaults.condition || '通过',
      requiresConfirmation: false,
    });
    return { ok: true };
  }
  if (view === 'team-workflow') {
    const defaults = edgeDefaultsForView(view);
    const type = defaults.transitionType || 'normal';
    const exists = graphDoc.edges.some((edge) => edge.from === fromNode.id && edge.to === toNode.id && String(edge.transitionType || 'normal') === String(type));
    if (exists) return { ok: false, message: '该角色交接关系已存在。' };
    graphDoc.edges.push({
      key: `${fromNode.id}->${toNode.id}:${type}`,
      from: fromNode.id,
      to: toNode.id,
      transitionType: type,
      condition: defaults.condition || '通过',
      requiresConfirmation: false,
    });
    return { ok: true };
  }
  return { ok: false, message: '当前视图不支持图上连线。' };
}

function handleGraphConnectClick(view, nodeRef) {
  if (!state.graphEditMode?.[view] || !state.graphConnectMode?.[view]) return false;
  const pending = connectPendingNode(view);
  if (!pending) {
    state.graphConnectPending[view] = nodeRef;
    renderAll();
    return true;
  }
  if (pending.id === nodeRef.id && pending.type === nodeRef.type) {
    clearGraphConnect(view);
    renderAll();
    return true;
  }
  const graphDoc = JSON.parse(JSON.stringify(currentGraphForView(view) || { nodes: [], edges: [] }));
  const result = appendGraphEdge(view, graphDoc, pending, nodeRef);
  if (!result.ok) {
    alert(result.message || '图上连线失败。');
    return true;
  }
  setDraftGraph(view, graphDoc);
  clearGraphConnect(view);
  renderAll();
  return true;
}

function normalizeEdgeTypeLabel(view, edge) {
  if (view === 'architecture') return safe(edge.type);
  if (view === 'inter-team-flow') return safe(edge.handoffType || edge.handoff_type || 'normal');
  return safe(edge.transitionType || edge.transition_type || 'normal');
}

function diffSummaryText(view = state.view) {
  const payload = graphEditPayload(view);
  const summary = payload?.implementation?.diff_summary;
  return summary?.summary_text || '当前没有待提交草稿。';
}

function renderDiffEdgeList(title, edges) {
  if (!(edges || []).length) return '';
  return `
    <div style="margin-top:8px;">
      <div class="muted" style="font-size:12px;font-weight:700;">${safe(title)}</div>
      <ul class="queue-list" style="margin-top:6px;">
        ${(edges || [])
          .slice(0, 8)
          .map(
            (edge) => `
              <li>
                <div><strong>${safe(edge.from)}</strong> → <strong>${safe(edge.to)}</strong> · ${safe(edge.type)}</div>
              </li>
            `
          )
          .join('')}
      </ul>
    </div>
  `;
}

function graphStructureSummary(graph) {
  const nodeCount = Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
  const edgeCount = Array.isArray(graph?.edges) ? graph.edges.length : 0;
  return { nodeCount, edgeCount };
}

function edgeSignature(edge) {
  if (!edge) return '';
  return [
    String(edge.from || ''),
    String(edge.to || ''),
    String(edge.type || edge.handoffType || edge.handoff_type || edge.transitionType || edge.transition_type || 'normal'),
    String(edge.condition || ''),
  ].join('::');
}

function edgeDiffStatus(edge, compareGraph, mode = 'current') {
  const compare = new Set(((compareGraph?.edges || []) as any[]).map((item) => edgeSignature(item)));
  const exists = compare.has(edgeSignature(edge));
  if (mode === 'current') return exists ? 'same' : 'removed';
  return exists ? 'same' : 'added';
}

function diffStatusLabel(status) {
  if (status === 'added') return '新增';
  if (status === 'removed') return '删除';
  return '保留';
}

function graphOverlayEdges(graph, compareGraph, mode = 'current') {
  if (!compareGraph?.edges?.length) return [];
  const existing = new Set(((graph?.edges || [])).map((item) => edgeSignature(item)));
  const status = mode === 'current' ? 'added' : 'removed';
  return (compareGraph.edges || [])
    .filter((item) => !existing.has(edgeSignature(item)))
    .map((item) => ({ ...item, __diffStatus: status }));
}

function renderEdgePreviewList(graph, compareGraph, mode = 'current') {
  const edges = (graph?.edges || []).slice(0, 6);
  if (!edges.length) return '<div class="muted" style="margin-top:6px;font-size:12px;line-height:1.6;">当前没有可预览的关系。</div>';
  return `
    <div style="margin-top:8px;">
      <div class="muted" style="font-size:12px;font-weight:700;">关系预览</div>
      <ul class="queue-list" style="margin-top:6px;">
        ${edges
          .map((edge) => {
            const status = edgeDiffStatus(edge, compareGraph, mode);
            return `
              <li>
                <div>
                  <strong>${safe(edge.from)}</strong> → <strong>${safe(edge.to)}</strong> · ${safe(normalizeEdgeTypeLabel(state.view, edge))}
                  <span class="diff-chip ${status}">${diffStatusLabel(status)}</span>
                </div>
              </li>
            `;
          })
          .join('')}
      </ul>
    </div>
  `;
}

function renderGraphStructureCard(title, graph, versionLabel, compareGraph = null, mode = 'current', emptyText = '当前没有可展示的图结构。') {
  if (!graph) {
    return `
      <div style="margin-top:10px;">
        <div class="muted" style="font-size:12px;font-weight:700;">${safe(title)}</div>
        <div class="muted" style="margin-top:6px;font-size:12px;line-height:1.6;">${safe(emptyText)}</div>
      </div>
    `;
  }
  const summary = graphStructureSummary(graph);
  return `
    <div style="margin-top:10px;">
      <div class="muted" style="font-size:12px;font-weight:700;">${safe(title)}</div>
      <table class="link-table" style="margin-top:6px;">
        <tbody>
          <tr><th>版本</th><td>${safe(versionLabel || '未命名')}</td></tr>
          <tr><th>节点数</th><td>${safe(summary.nodeCount)}</td></tr>
          <tr><th>关系数</th><td>${safe(summary.edgeCount)}</td></tr>
        </tbody>
      </table>
      ${renderEdgePreviewList(graph, compareGraph, mode)}
    </div>
  `;
}

function graphDispatchStatusLabel(implementation = null) {
  const status = String(implementation?.implementation_dispatch_status || '').trim();
  if (status === 'dispatched') return '等待鲁班处理';
  if (status === 'failed') return '鲁班投递失败';
  if (implementation?.implementation_status === 'pending_implementation') return '等待鲁班处理';
  if (implementation?.implementation_status === 'failed') return '鲁班投递失败';
  return '未投递';
}

function graphDraftStatusLabel(payload = null) {
  const implementation = payload?.implementation || null;
  if (implementation?.implementation_status === 'ready_for_confirm') return '待确认实施结果';
  if (implementation?.implementation_status === 'pending_implementation') return '已提交等待实施';
  if (payload?.draft_graph) return '存在未提交草稿';
  return '当前无草稿';
}

function renderGraphDiffSummary(view = state.view) {
  const payload = graphEditPayload(view);
  const implementation = payload?.implementation || null;
  const summary = implementation?.diff_summary || null;
  const currentVersion = payload?.current_graph?.version || '未发布';
  const pendingVersion = implementation?.implementation_status === 'ready_for_confirm' ? implementation?.change_id || '待确认' : '无';
  const implementationSummary = implementation?.implementation_summary || '';
  const requestedBy = implementation?.requested_by || '-';
  const dispatchRequestedAt = implementation?.implementation_dispatch_requested_at || '';
  const changeId = implementation?.change_id || '-';
  const currentGraph = payload?.current_graph || null;
  const pendingGraph = implementation?.implementation_result_graph || payload?.draft_graph || null;
  return `
    <section class="card">
      <h4>草稿差异</h4>
      <table class="link-table">
        <tbody>
          <tr><th>草稿状态</th><td>${safe(graphDraftStatusLabel(payload))}</td></tr>
          <tr><th>当前版本</th><td>${safe(currentVersion)}</td></tr>
          <tr><th>待确认版本</th><td>${safe(pendingVersion)}</td></tr>
          <tr><th>最近变更单</th><td>${safe(changeId)}</td></tr>
          <tr><th>提交人</th><td>${safe(requestedBy)}</td></tr>
          <tr><th>最近投递</th><td>${safe(dispatchRequestedAt || '-')}</td></tr>
          <tr><th>差异摘要</th><td>${safe(summary?.summary_text || '当前没有待提交草稿。')}</td></tr>
          <tr><th>实施状态</th><td>${safe(implementation?.implementation_status || '未提交')}</td></tr>
          <tr><th>投递状态</th><td>${safe(graphDispatchStatusLabel(implementation))}</td></tr>
        </tbody>
      </table>
      ${implementationSummary ? `<div class="muted" style="margin-top:8px;font-size:12px;line-height:1.6;">${safe(implementationSummary)}</div>` : ''}
      ${renderGraphStructureCard('当前版本结构', currentGraph, currentVersion, pendingGraph, 'current', '当前还没有已生效版本。')}
      ${renderGraphStructureCard('待确认版本结构', pendingGraph, pendingVersion, currentGraph, 'pending', '当前没有待确认版本。')}
      <div style="margin-top:10px;">
        <div class="muted" style="font-size:12px;font-weight:700;">最近一次实施结果</div>
        <div class="muted" style="margin-top:6px;font-size:12px;line-height:1.6;">
          ${safe(implementationSummary || (implementation?.implementation_status ? `最近一次实施状态：${implementation.implementation_status}` : '当前还没有鲁班实施结果。'))}
        </div>
      </div>
      ${renderDiffEdgeList('新增关系', summary?.added_edges || [])}
      ${renderDiffEdgeList('删除关系', summary?.removed_edges || [])}
    </section>
  `;
}

async function submitCurrentGraphToLuban(view = state.view) {
  const target = graphEditTarget(view);
  const payload = graphEditPayload(view);
  const draftGraph = payload?.draft_graph || payload?.current_graph;
  if (!target || !target.targetId || !draftGraph) return;
  const result = await requestJSON(
    `/api/graph-edit/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.targetId)}/submit-to-luban`,
    'POST',
    { draft_graph: draftGraph, operator: 'dashboard-ui' }
  );
  state.graphEdit[target.kind] = await requestJSON(`/api/graph-edit/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.targetId)}`);
  return result;
}

async function refreshImplementation(view = state.view) {
  const target = graphEditTarget(view);
  if (!target || !target.targetId) return null;
  const result = await requestJSON(`/api/graph-edit/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.targetId)}/implementation`);
  const payload = state.graphEdit[target.kind] || {};
  payload.implementation = result.implementation || null;
  state.graphEdit[target.kind] = payload;
  return result;
}

async function confirmImplementation(view = state.view) {
  const target = graphEditTarget(view);
  const payload = graphEditPayload(view);
  const changeId = payload?.implementation?.change_id;
  if (!target || !target.targetId || !changeId) return null;
  const result = await requestJSON(
    `/api/graph-edit/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.targetId)}/confirm-apply`,
    'POST',
    { change_id: changeId, operator: 'dashboard-ui' }
  );
  await refreshAll();
  return result;
}

async function discardDraft(view = state.view) {
  const target = graphEditTarget(view);
  if (!target || !target.targetId) return null;
  await requestJSON(`/api/graph-edit/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.targetId)}/discard-draft`, 'POST', {});
  discardDraftGraph(view);
  clearGraphConnect(view);
  await loadGraphEdit(view);
  renderAll();
  return true;
}

function ensureSelectionDefaults() {
  const firstTeam = state.teams?.[0]?.team_id || null;
  if (!state.selectedTeamId) state.selectedTeamId = currentTeamForObject() || firstTeam;
  if (state.view === 'team-workflow' && !state.selectedTeamId) state.selectedTeamId = firstTeam;
  if (state.view === 'flow-detail' && !state.selectedFlowId) {
    state.selectedFlowId = state.selectedTeamId ? `team:${state.selectedTeamId}` : (state.flows?.[0]?.flow_id || null);
  }
}

function parseRoute() {
  const params = new URLSearchParams(window.location.search);
  const subview = params.get('subview');
  state.view = ['architecture', 'inter-team-flow', 'team-workflow', 'flow-detail'].includes(subview || '') ? subview : 'architecture';
  state.selectedObjectType = params.get('object_type') || null;
  state.selectedObjectId = params.get('object_id') || null;
  state.selectedTeamId = params.get('target_id') || params.get('team_id') || null;
  state.selectedFlowId = params.get('flow_id') || null;
}

function syncRoute() {
  const url = new URL(window.location.href);
  url.searchParams.set('subview', state.view);
  if (state.selectedObjectType && state.selectedObjectId) {
    url.searchParams.set('object_type', state.selectedObjectType);
    url.searchParams.set('object_id', state.selectedObjectId);
  } else {
    url.searchParams.delete('object_type');
    url.searchParams.delete('object_id');
  }
  if (state.view === 'team-workflow' && state.selectedTeamId) {
    url.searchParams.set('target_id', state.selectedTeamId);
  } else if (state.view === 'inter-team-flow' && state.selectedTeamId) {
    url.searchParams.set('team_id', state.selectedTeamId);
    url.searchParams.delete('target_id');
  } else {
    url.searchParams.delete('target_id');
    url.searchParams.delete('team_id');
  }
  if (state.view === 'flow-detail' && state.selectedFlowId) {
    url.searchParams.set('flow_id', state.selectedFlowId);
  } else {
    url.searchParams.delete('flow_id');
  }
  window.history.replaceState({}, '', url);
}

async function loadAllData() {
  const [architecture, teams, standalone, tasks, flows, runtimeVersions, architectureLayout, interTeamLayout] = await Promise.all([
    fetchJSON('/api/architecture'),
    fetchJSON('/api/teams'),
    fetchJSON('/api/standalone-agents'),
    fetchJSON('/api/tasks?include_history=1&limit=500'),
    fetchJSON('/api/flows'),
    fetchJSON('/api/runtime-versions'),
    requestJSON('/api/architecture/layout'),
    requestJSON('/api/inter-team-flow/layout'),
  ]);
  state.architecture = architecture;
  state.teams = teams.teams || [];
  state.standaloneAgents = standalone.agents || [];
  state.tasks = tasks.tasks || [];
  state.flows = flows.flows || [];
  state.runtimeVersions = runtimeVersions || {};
  state.architectureLayout = architectureLayout || { positions: {}, updatedAt: null };
  state.interTeamLayout = interTeamLayout || { positions: {}, updatedAt: null };
  state.updatedAt = architecture.updated_at || tasks.updated_at || Date.now();
  ensureSelectionDefaults();
  if (state.view === 'flow-detail' && state.selectedFlowId) {
    state.flowDetail = await fetchJSON(`/api/flow/detail?flow_id=${encodeURIComponent(state.selectedFlowId)}`);
  } else if (state.view === 'team-workflow' && state.selectedTeamId) {
    state.flowDetail = await fetchJSON(`/api/flow/detail?flow_id=${encodeURIComponent(`team:${state.selectedTeamId}`)}`);
  } else {
    state.flowDetail = null;
  }
  if (state.view === 'architecture' || state.view === 'inter-team-flow' || state.view === 'team-workflow') {
    await loadGraphEdit(state.view);
  }
}

function renderTabs() {
  document.querySelectorAll('.tab[data-view]').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-view') === state.view);
  });
}

function renderSideStats() {
  const side = document.getElementById('sideStats');
  if (!side) return;
  side.innerHTML = `
    <div class="side-stat"><div class="n">${(state.teams || []).length}</div><div class="l">团队总数</div></div>
    <div class="side-stat"><div class="n">${(state.tasks || []).length}</div><div class="l">活跃任务对象</div></div>
    <div class="side-stat"><div class="n" style="font-size:13px;line-height:1.3;color:#32463b;">${fmtTime(state.updatedAt)}</div><div class="l">实时更新时间</div></div>
    <div class="side-stat"><div class="n" style="font-size:13px;line-height:1.3;color:#32463b;">${safe(state.runtimeVersions?.workflow_version || '-')} / ${safe(state.runtimeVersions?.routing_version || '-')}</div><div class="l">规则版本</div></div>
  `;
}

function createStage(width, height) {
  const zoom = graphZoom();
  const body = document.getElementById('mainBody');
  body.innerHTML = `
    <div class="stage-scroll">
      <div class="stage-zoom" id="stageZoom" style="width:${Math.max(860, Math.round(width * zoom))}px;height:${Math.max(460, Math.round(height * zoom))}px;">
        <div class="stage-inner" id="stageInner" data-base-width="${width}" data-base-height="${height}" style="width:${width}px;height:${height}px;transform:scale(${zoom});">
          <svg id="edges" viewBox="0 0 ${width} ${height}"></svg>
        </div>
      </div>
    </div>
  `;
  const scroll = document.querySelector('.stage-scroll');
  const inner = document.getElementById('stageInner');
  const svg = document.getElementById('edges');
  svg.innerHTML = `
    <defs>
      <marker id="arrow-main" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 z" fill="#84af99"></path>
      </marker>
      <marker id="arrow-warn" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 z" fill="#b27a37"></path>
      </marker>
      <marker id="arrow-added" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 z" fill="#1f8f5f"></path>
      </marker>
      <marker id="arrow-removed" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 z" fill="#c24d44"></path>
      </marker>
    </defs>
  `;
  enableCanvasPanning(scroll);
  return { scroll, inner, svg };
}

function drawCurve(svg, from, to, color = '#84af99', dashed = false, diffStatus = 'same') {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  path.setAttribute('d', curvePathData(x1, y1, x2, y2));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('class', `edge-path diff-${diffStatus}`);
  if (dashed) path.setAttribute('stroke-dasharray', '6 4');
  path.setAttribute(
    'marker-end',
    diffStatus === 'added' ? 'url(#arrow-added)' : diffStatus === 'removed' ? 'url(#arrow-removed)' : 'url(#arrow-main)'
  );
  svg.appendChild(path);
}

function addNode(inner, cfg) {
  const el = document.createElement('div');
  el.className = `node clickable ${cfg.selected ? 'selected' : ''} ${cfg.connectSource ? 'connect-source' : ''} ${cfg.diffStatus ? `diff-${cfg.diffStatus}` : ''}`.trim();
  el.style.left = `${cfg.x}px`;
  el.style.top = `${cfg.y}px`;
  el.style.width = `${cfg.w}px`;
  el.style.minHeight = `${cfg.h}px`;
  el.innerHTML = `
    <div class="title">${safe(cfg.title)}</div>
    <div class="sub">${safe(cfg.sub)}</div>
    ${cfg.badge ? `<span class="badge">${safe(cfg.badge)}</span>` : ''}
    ${cfg.canConnect ? '<button class="connector-handle" type="button" aria-label="连线"></button>' : ''}
  `;
  let moved = false;
  el.addEventListener('click', () => {
    if (moved) {
      moved = false;
      return;
    }
    cfg.onClick?.();
  });
  if (cfg.layoutKey && (cfg.view === 'architecture' || cfg.view === 'inter-team-flow')) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = cfg.x;
    let originY = cfg.y;
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      originX = parseFloat(el.style.left || String(cfg.x));
      originY = parseFloat(el.style.top || String(cfg.y));
      el.classList.add('dragging');
      el.setPointerCapture?.(event.pointerId);
    });
    el.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      moved = true;
      const x = originX + event.clientX - startX;
      const y = originY + event.clientY - startY;
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
    });
    el.addEventListener('pointerup', async (event) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      const x = parseFloat(el.style.left || String(cfg.x));
      const y = parseFloat(el.style.top || String(cfg.y));
      setSavedPosition(cfg.view, cfg.layoutKey, { x, y });
      await persistLayout(cfg.view);
      renderAll();
      el.releasePointerCapture?.(event.pointerId);
    });
  } else if (cfg.onMove) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = cfg.x;
    let originY = cfg.y;
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      originX = parseFloat(el.style.left || String(cfg.x));
      originY = parseFloat(el.style.top || String(cfg.y));
      el.classList.add('dragging');
      el.setPointerCapture?.(event.pointerId);
    });
    el.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      moved = true;
      const x = originX + event.clientX - startX;
      const y = originY + event.clientY - startY;
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
    });
    el.addEventListener('pointerup', async (event) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      const x = parseFloat(el.style.left || String(cfg.x));
      const y = parseFloat(el.style.top || String(cfg.y));
      await cfg.onMove({ x, y });
      renderAll();
      el.releasePointerCapture?.(event.pointerId);
    });
  }
  if (cfg.canConnect) {
    const connector = el.querySelector('.connector-handle');
    connector?.addEventListener('pointerdown', (event) => {
      if (!state.graphEditMode?.[cfg.view] || !state.graphConnectMode?.[cfg.view]) return;
      event.preventDefault();
      event.stopPropagation();
      startGraphConnectDrag(
        cfg.view,
        cfg.nodeRef,
        { x: cfg.x + cfg.w, y: cfg.y + cfg.h / 2 },
        event.pointerId
      );
      const move = (moveEvent) => {
        const drag = connectDragState(cfg.view);
        if (!drag || drag.pointerId !== event.pointerId) return;
        const stageInner = document.getElementById('stageInner');
        const zoom = dt(cfg.view);
        if (stageInner) {
          const rect = stageInner.getBoundingClientRect();
          drag.pointer = {
            x: (moveEvent.clientX - rect.left) / zoom,
            y: (moveEvent.clientY - rect.top) / zoom,
          };
        } else {
          drag.pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
        }
        updateWirePreview(cfg.view, drag.pointer);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        finishGraphConnectDrag(cfg.view);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    });
    el.addEventListener('pointerenter', () => {
      if (!connectDragState(cfg.view)) return;
      if (cfg.nodeRef?.id === connectDragState(cfg.view)?.source?.id && cfg.nodeRef?.type === connectDragState(cfg.view)?.source?.type) return;
      el.classList.add('connect-target');
      updateGraphConnectHover(cfg.view, cfg.nodeRef, { x: cfg.x, y: cfg.y + cfg.h / 2 });
    });
    el.addEventListener('pointerleave', () => {
      if (!connectDragState(cfg.view)) return;
      el.classList.remove('connect-target');
      updateGraphConnectHover(cfg.view, null, null);
    });
  }
  inner.appendChild(el);
  return { el, x: cfg.x, y: cfg.y, w: cfg.w, h: cfg.h };
}

function renderArchitecture() {
  document.getElementById('mainTitle').textContent = '架构关系图';
  document.getElementById('contextTitle').textContent = '对象详情';
  document.getElementById('contextMeta').textContent = '默认收起团队成员，点击团队后可展开或查看流程。';

  const teams = state.teams || [];
  const standalone = state.standaloneAgents || [];
  const visual = graphVisualState('architecture');
  const graph = visual.graph || { edges: [] };
  const compareGraph = visual.compareGraph;
  const overlayEdges = graphOverlayEdges(graph, compareGraph, visual.mode);
  const changedNodeStatuses = new Map();
  (graph.edges || []).forEach((edge) => {
    const status = compareGraph ? edgeDiffStatus(edge, compareGraph, visual.mode) : 'same';
    if (status !== 'same') {
      changedNodeStatuses.set(edge.from, status);
      changedNodeStatuses.set(edge.to, status);
    }
  });
  overlayEdges.forEach((edge) => {
    changedNodeStatuses.set(edge.from, edge.__diffStatus);
    changedNodeStatuses.set(edge.to, edge.__diffStatus);
  });
  const positions = mergePositions('architecture', architectureAutoPositions());
  const sizing = [];
  teams.forEach((team) => {
    const point = positions[`team:${team.team_id}`] || { x: 80, y: 70 };
    sizing.push({ x: point.x, y: point.y, w: 220, h: 84 + (state.expandedTeams[team.team_id] ? Math.min((team.members || []).length, 4) * 78 + 24 : 0) });
  });
  standalone.forEach((agent) => {
    const point = positions[`agent:${agent.agent_id}`] || { x: 24, y: 70 };
    sizing.push({ x: point.x, y: point.y, w: 112, h: 64 });
  });
  const stageSize = stageSizeFromPositions(sizing, 980, 620);
  const { inner, svg } = createStage(stageSize.width, stageSize.height);
  const teamNodes = {};

  teams.forEach((team) => {
    const point = positions[`team:${team.team_id}`] || { x: 80, y: 70 };
    const x = point.x;
    const y = point.y;
    const isSelected = state.selectedObjectType === 'team' && state.selectedObjectId === team.team_id;
    const taskCount = teamTasks(team.team_id).length;
    const teamNode = addNode(inner, {
      x,
      y,
      w: 220,
      h: 84,
      title: team.team_name,
      sub: `${team.team_id} · ${safe(team.lead?.name || '-')}`,
      badge: `${taskCount} 个相关任务`,
      diffStatus: changedNodeStatuses.get(team.team_id) || '',
      selected: isSelected,
      connectSource: connectPendingNode('architecture')?.type === 'team' && connectPendingNode('architecture')?.id === team.team_id,
      canConnect: state.graphEditMode.architecture && state.graphConnectMode.architecture,
      nodeRef: { id: team.team_id, type: 'team' },
      view: 'architecture',
      layoutKey: `team:${team.team_id}`,
      onClick: () => {
        if (handleGraphConnectClick('architecture', { id: team.team_id, type: 'team' })) return;
        state.selectedObjectType = 'team';
        state.selectedObjectId = team.team_id;
        state.selectedTeamId = team.team_id;
        syncRoute();
        renderAll();
      },
    });
    teamNodes[team.team_id] = teamNode;

    if (state.expandedTeams[team.team_id]) {
      (team.members || []).slice(0, 4).forEach((member, memberIndex) => {
        addNode(inner, {
          x,
          y: y + 96 + memberIndex * 78,
          w: 220,
          h: 66,
          title: member.name,
          sub: `${member.agent_id} · ${safe(member.status)}`,
          badge: member.model,
          selected: state.selectedObjectType === 'member' && state.selectedObjectId === member.agent_id,
          onClick: () => {
            state.selectedObjectType = 'member';
            state.selectedObjectId = member.agent_id;
            state.selectedTeamId = team.team_id;
            syncRoute();
            renderAll();
          },
        });
      });
    }
  });

  const standaloneNodes = {};
  standalone.slice(0, 8).forEach((agent) => {
    const point = positions[`agent:${agent.agent_id}`] || { x: 24, y: 70 };
    standaloneNodes[agent.agent_id] = addNode(inner, {
      x: point.x,
      y: point.y,
      w: 112,
      h: 64,
      title: agent.name,
      sub: agent.agent_id,
      badge: '独立',
      diffStatus: changedNodeStatuses.get(agent.agent_id) || '',
      selected: state.selectedObjectType === 'agent' && state.selectedObjectId === agent.agent_id,
      connectSource: connectPendingNode('architecture')?.type === 'agent' && connectPendingNode('architecture')?.id === agent.agent_id,
      canConnect: state.graphEditMode.architecture && state.graphConnectMode.architecture,
      nodeRef: { id: agent.agent_id, type: 'agent' },
      view: 'architecture',
      layoutKey: `agent:${agent.agent_id}`,
      onClick: () => {
        if (handleGraphConnectClick('architecture', { id: agent.agent_id, type: 'agent' })) return;
        state.selectedObjectType = 'agent';
        state.selectedObjectId = agent.agent_id;
        syncRoute();
        renderAll();
      },
    });
  });

  (graph.edges || []).filter((edge) => edge.type === 'business_flow').forEach((edge) => {
    const from = teamNodes[edge.from];
    const to = teamNodes[edge.to];
    const status = compareGraph ? edgeDiffStatus(edge, compareGraph, visual.mode) : 'same';
    if (from && to) drawCurve(svg, from, to, status === 'removed' ? '#c24d44' : status === 'added' ? '#1f8f5f' : '#b27a37', true, status);
  });
  (graph.edges || []).filter((edge) => edge.type === 'standalone_collab').forEach((edge) => {
    const from = standaloneNodes[edge.from];
    const to = teamNodes[edge.to];
    const status = compareGraph ? edgeDiffStatus(edge, compareGraph, visual.mode) : 'same';
    if (from && to) drawCurve(svg, from, to, status === 'removed' ? '#c24d44' : status === 'added' ? '#1f8f5f' : '#2e6f9a', true, status);
  });
  overlayEdges.forEach((edge) => {
    const from = edge.type === 'standalone_collab' ? standaloneNodes[edge.from] : teamNodes[edge.from];
    const to = teamNodes[edge.to];
    if (from && to) drawCurve(svg, from, to, edge.__diffStatus === 'removed' ? '#c24d44' : '#1f8f5f', true, edge.__diffStatus);
  });

  renderArchitectureContext();
}

function renderArchitectureContext() {
  const list = document.getElementById('flowList');
  const detail = document.getElementById('flowContext');
  list.innerHTML = '<div class="object-list-note">图上只显示最小必要信息。先看对象详情，再决定查看团队任务、团队间流程或团队内流程。</div>';

  if (!state.selectedObjectType || !state.selectedObjectId) {
    detail.innerHTML = `
      <section class="card">
        <h4>未选中对象</h4>
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">请先点击团队、成员或独立 Agent。团队默认收起，避免全图重叠。系统会先展示对象详情，再决定进入团队任务或流程页面。</div>
      </section>
    `;
    return;
  }

  if (state.selectedObjectType === 'team') {
    const team = getTeamById(state.selectedObjectId);
    const relatedTasks = teamTasks(team.team_id);
    const graph = currentGraphForView('architecture') || { nodes: [], edges: [] };
    const relevantEdges = (graph.edges || []).filter((edge) => edge.from === team.team_id || edge.to === team.team_id);
    const teamOptions = (state.teams || []).map((item) => `<option value="${safe(item.team_id)}">${safe(item.team_name)}</option>`).join('');
    const agentOptions = (state.standaloneAgents || []).map((item) => `<option value="${safe(item.agent_id)}">${safe(item.name)}</option>`).join('');
    const implementation = graphEditPayload('architecture')?.implementation || null;
    detail.innerHTML = `
      <section class="card">
        <h4>${safe(team.team_name)}</h4>
        <div class="mono">${safe(team.team_id)}</div>
        <div style="margin-top:8px;font-size:13px;color:var(--muted);line-height:1.6;">${safe(team.description)}</div>
      </section>
      <section class="card">
        <h4>当前最关键的信息</h4>
        <table class="link-table">
          <tbody>
            <tr><th>团队负责人</th><td>${safe(team.lead?.name)}</td></tr>
            <tr><th>成员数量</th><td>${safe((team.members || []).length)}</td></tr>
            <tr><th>相关任务</th><td>${safe(relatedTasks.length)}</td></tr>
            <tr><th>当前阶段</th><td>${safe(team.workflow?.current_stage)}</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card">
        <h4>操作</h4>
        <div class="row-actions">
          <button class="btn" id="toggleTeamMembersBtn">${state.expandedTeams[team.team_id] ? '收起成员' : '展开成员'}</button>
          <a class="btn" href="task_dashboard.html?team=${encodeURIComponent(team.team_id)}">查看团队任务</a>
          <a class="btn" href="system_dashboard.html?subview=team-workflow&target_id=${encodeURIComponent(team.team_id)}">查看团队内流程</a>
          <a class="btn" href="system_dashboard.html?subview=inter-team-flow&team_id=${encodeURIComponent(team.team_id)}">查看团队间流程</a>
        </div>
      </section>
      <section class="card">
        <h4>编辑关系模式</h4>
        <div class="muted" style="font-size:13px;line-height:1.6;">默认不直接改活跃配置。先在图上形成草稿，再提交给鲁班实施，实施结果回写后再确认应用。</div>
        <div class="row-actions" style="margin-top:10px;">
          <button class="btn" id="toggleArchitectureEditBtn">${state.graphEditMode.architecture ? '退出编辑' : '进入编辑'}</button>
          <button class="btn" id="toggleArchitectureConnectBtn">${state.graphConnectMode.architecture ? '退出图上连线' : '图上连线模式'}</button>
          <button class="btn" id="submitArchitectureDraftBtn">提交给鲁班</button>
          <button class="btn" id="viewArchitectureImplementationBtn">查看实施结果</button>
          <button class="btn" id="confirmArchitectureImplementationBtn">确认应用</button>
          <button class="btn" id="discardArchitectureDraftBtn">丢弃草稿</button>
        </div>
        <div class="mono" style="margin-top:8px;">${safe(diffSummaryText('architecture'))}</div>
        <div class="muted" style="margin-top:8px;font-size:12px;">当前实施状态：${safe(implementation?.implementation_status || '未提交')}</div>
        <div class="muted" style="margin-top:8px;font-size:12px;">当前投递状态：${safe(graphDispatchStatusLabel(implementation))}</div>
        <div class="muted" style="margin-top:8px;font-size:12px;">${state.graphConnectMode.architecture ? (connectPendingNode('architecture') ? `已选来源：${safe(connectPendingNode('architecture')?.id)}，请拖动节点右侧连线点到目标节点，或点击目标节点完成连线。` : '图上连线模式已开启：拖动节点右侧连线点到目标节点，也可先点来源节点再点目标节点。') : '图上连线模式关闭。'}</div>
        ${
          state.graphEditMode.architecture
            ? `
          <div class="field-grid" style="margin-top:10px;">
            <label>
              <span>关系类型</span>
              <select id="architectureEdgeType">
                <option value="business_flow">团队上下游</option>
                <option value="standalone_collab">独立 Agent 协作</option>
              </select>
            </label>
            <label>
              <span>来源团队 / Agent</span>
              <select id="architectureEdgeFrom">
                <optgroup label="团队">${teamOptions}</optgroup>
                <optgroup label="独立 Agent">${agentOptions}</optgroup>
              </select>
            </label>
            <label>
              <span>目标团队</span>
              <select id="architectureEdgeTo">
                ${teamOptions}
              </select>
            </label>
          </div>
          <div class="row-actions" style="margin-top:10px;">
            <button class="btn primary" id="architectureAddEdgeBtn">新增关系</button>
          </div>
        `
            : ''
        }
        <ul class="queue-list" style="margin-top:10px;">
          ${
            relevantEdges.length
              ? relevantEdges
                  .map(
                    (edge, index) => `
                <li>
                  <div><strong>${safe(edge.from)}</strong> → <strong>${safe(edge.to)}</strong> · ${safe(edge.type)}</div>
                  ${state.graphEditMode.architecture ? `<button class="btn" data-arch-edge-index="${index}">删除</button>` : ''}
                </li>
              `
                  )
                  .join('')
              : '<li>当前对象没有配置中的上下游关系。</li>'
          }
        </ul>
      </section>
    `;
    document.getElementById('toggleTeamMembersBtn')?.addEventListener('click', () => {
      state.expandedTeams[team.team_id] = !state.expandedTeams[team.team_id];
      renderAll();
    });
    document.getElementById('toggleArchitectureEditBtn')?.addEventListener('click', () => {
      state.graphEditMode.architecture = !state.graphEditMode.architecture;
      if (!state.graphEditMode.architecture) {
        state.graphConnectMode.architecture = false;
        clearGraphConnect('architecture');
      }
      renderAll();
    });
    document.getElementById('toggleArchitectureConnectBtn')?.addEventListener('click', () => {
      if (!state.graphEditMode.architecture) state.graphEditMode.architecture = true;
      state.graphConnectMode.architecture = !state.graphConnectMode.architecture;
      if (!state.graphConnectMode.architecture) clearGraphConnect('architecture');
      renderAll();
    });
    document.getElementById('architectureAddEdgeBtn')?.addEventListener('click', () => {
      const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('architecture') || { nodes: [], edges: [] }));
      const from = String(detail.querySelector('#architectureEdgeFrom')?.value || '').trim();
      const to = String(detail.querySelector('#architectureEdgeTo')?.value || '').trim();
      const type = String(detail.querySelector('#architectureEdgeType')?.value || 'business_flow').trim();
      if (!from || !to || !type) return;
      if (type === 'standalone_collab' && !(state.standaloneAgents || []).some((item) => item.agent_id === from)) {
        alert('独立 Agent 协作关系的来源必须是独立 Agent。');
        return;
      }
      graphDoc.edges = graphDoc.edges || [];
      const exists = graphDoc.edges.some((edge) => edge.from === from && edge.to === to && edge.type === type);
      if (!exists) graphDoc.edges.push({ key: `${from}->${to}:${type}`, from, to, type });
      setDraftGraph('architecture', graphDoc);
      renderAll();
    });
    detail.querySelectorAll('[data-arch-edge-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('architecture') || { nodes: [], edges: [] }));
        graphDoc.edges.splice(Number(button.getAttribute('data-arch-edge-index') || -1), 1);
        setDraftGraph('architecture', graphDoc);
        renderAll();
      });
    });
    document.getElementById('submitArchitectureDraftBtn')?.addEventListener('click', async () => {
      try {
        await submitCurrentGraphToLuban('architecture');
        alert('已提交给鲁班。');
        renderAll();
      } catch (error) {
        alert(`提交失败: ${safe(error?.message || error)}`);
      }
    });
    document.getElementById('viewArchitectureImplementationBtn')?.addEventListener('click', async () => {
      try {
        await refreshImplementation('architecture');
        renderAll();
      } catch (error) {
        alert(`读取实施结果失败: ${safe(error?.message || error)}`);
      }
    });
    document.getElementById('confirmArchitectureImplementationBtn')?.addEventListener('click', async () => {
      try {
        await confirmImplementation('architecture');
      } catch (error) {
        alert(`确认应用失败: ${safe(error?.message || error)}`);
      }
    });
    document.getElementById('discardArchitectureDraftBtn')?.addEventListener('click', async () => {
      try {
        await discardDraft('architecture');
      } catch (error) {
        alert(`丢弃草稿失败: ${safe(error?.message || error)}`);
      }
    });
    return;
  }

  if (state.selectedObjectType === 'member') {
    const member = getMemberById(state.selectedObjectId);
    detail.innerHTML = `
      <section class="card">
        <h4>${safe(member?.name)}</h4>
        <div class="mono">${safe(member?.agent_id)}</div>
      </section>
      <section class="card">
        <h4>归属与状态</h4>
        <table class="link-table">
          <tbody>
            <tr><th>所属团队</th><td>${safe(member?.team_name)}</td></tr>
            <tr><th>当前状态</th><td>${safe(member?.status)}</td></tr>
            <tr><th>当前任务</th><td>${safe(member?.current_task_name || member?.current_task)}</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card">
        <h4>操作</h4>
        <div class="row-actions">
          <a class="btn" href="task_dashboard.html?team=${encodeURIComponent(member?.team_id || '')}">查看团队任务</a>
          <a class="btn" href="system_dashboard.html?subview=team-workflow&target_id=${encodeURIComponent(member?.team_id || '')}">查看团队内流程</a>
        </div>
      </section>
    `;
    return;
  }

  const agent = getStandaloneById(state.selectedObjectId);
  const architectureGraph = currentGraphForView('architecture') || { edges: [] };
  const relatedEdges = (architectureGraph.edges || []).filter((edge) => edge.type === 'standalone_collab' && edge.from === agent?.agent_id);
  detail.innerHTML = `
    <section class="card">
      <h4>${safe(agent?.name)}</h4>
      <div class="mono">${safe(agent?.agent_id)}</div>
    </section>
    <section class="card">
      <h4>独立 Agent 上下文</h4>
      <table class="link-table">
        <tbody>
          <tr><th>当前状态</th><td>${safe(agent?.status)}</td></tr>
          <tr><th>当前任务</th><td>${safe(agent?.current_task_name || agent?.current_task)}</td></tr>
          <tr><th>关联团队</th><td>${relatedEdges.map((edge) => safe(edge.to)).join(' / ') || '-'}</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <h4>编辑关系模式</h4>
      <div class="row-actions">
        <button class="btn" id="toggleArchitectureEditBtn">${state.graphEditMode.architecture ? '退出编辑' : '进入编辑'}</button>
        <button class="btn" id="toggleArchitectureConnectBtn">${state.graphConnectMode.architecture ? '退出图上连线' : '图上连线模式'}</button>
        <button class="btn" id="submitArchitectureDraftBtn">提交给鲁班</button>
      </div>
      <div class="muted" style="margin-top:8px;font-size:12px;">${state.graphConnectMode.architecture ? (connectPendingNode('architecture') ? `已选来源：${safe(connectPendingNode('architecture')?.id)}，请拖动节点右侧连线点到目标团队，或点击目标团队完成连线。` : '图上连线模式已开启：拖动节点右侧连线点到目标团队，也可先点独立Agent再点目标团队。') : '图上连线模式关闭。'}</div>
      ${
        state.graphEditMode.architecture
          ? `
        <div class="field-grid" style="margin-top:10px;">
          <label>
            <span>协作目标团队</span>
            <select id="architectureAgentTarget">
              ${(state.teams || []).map((item) => `<option value="${safe(item.team_id)}">${safe(item.team_name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="row-actions" style="margin-top:10px;">
          <button class="btn primary" id="architectureAddAgentEdgeBtn">新增协作关系</button>
        </div>
      `
          : ''
      }
      <ul class="queue-list" style="margin-top:10px;">
        ${
          relatedEdges.length
            ? relatedEdges
                .map(
                  (edge, index) => `
              <li>
                <div><strong>${safe(edge.from)}</strong> → <strong>${safe(edge.to)}</strong> · ${safe(edge.type)}</div>
                ${state.graphEditMode.architecture ? `<button class="btn" data-agent-edge-index="${index}">删除</button>` : ''}
              </li>
            `
                )
                .join('')
            : '<li>当前独立 Agent 还没有协作关系。</li>'
        }
      </ul>
    </section>
    ${renderGraphDiffSummary('architecture')}
  `;
  document.getElementById('toggleArchitectureEditBtn')?.addEventListener('click', () => {
    state.graphEditMode.architecture = !state.graphEditMode.architecture;
    if (!state.graphEditMode.architecture) {
      state.graphConnectMode.architecture = false;
      clearGraphConnect('architecture');
    }
    renderAll();
  });
  document.getElementById('toggleArchitectureConnectBtn')?.addEventListener('click', () => {
    if (!state.graphEditMode.architecture) state.graphEditMode.architecture = true;
    state.graphConnectMode.architecture = !state.graphConnectMode.architecture;
    if (!state.graphConnectMode.architecture) clearGraphConnect('architecture');
    renderAll();
  });
  document.getElementById('architectureAddAgentEdgeBtn')?.addEventListener('click', () => {
    const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('architecture') || { nodes: [], edges: [] }));
    const to = String(detail.querySelector('#architectureAgentTarget')?.value || '').trim();
    if (!agent?.agent_id || !to) return;
    graphDoc.edges = graphDoc.edges || [];
    const exists = graphDoc.edges.some((edge) => edge.from === agent.agent_id && edge.to === to && edge.type === 'standalone_collab');
    if (!exists) graphDoc.edges.push({ key: `${agent.agent_id}->${to}:standalone_collab`, from: agent.agent_id, to, type: 'standalone_collab' });
    setDraftGraph('architecture', graphDoc);
    renderAll();
  });
  detail.querySelectorAll('[data-agent-edge-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('architecture') || { nodes: [], edges: [] }));
      const edges = (graphDoc.edges || []).filter((edge) => !(edge.type === 'standalone_collab' && edge.from === agent?.agent_id));
      const keep = [];
      let removed = false;
      (graphDoc.edges || []).forEach((edge) => {
        if (!removed && edge.type === 'standalone_collab' && edge.from === agent?.agent_id && String(edge.to) === String(relatedEdges[Number(button.getAttribute('data-agent-edge-index') || -1)]?.to || '')) {
          removed = true;
          return;
        }
        keep.push(edge);
      });
      graphDoc.edges = keep;
      setDraftGraph('architecture', graphDoc);
      renderAll();
    });
  });
  document.getElementById('submitArchitectureDraftBtn')?.addEventListener('click', async () => {
    try {
      await submitCurrentGraphToLuban('architecture');
      alert('已提交给鲁班。');
      renderAll();
    } catch (error) {
      alert(`提交失败: ${safe(error?.message || error)}`);
    }
  });
}

function renderInterTeamFlow() {
  document.getElementById('mainTitle').textContent = '团队间流程';
  document.getElementById('contextTitle').textContent = '团队交接详情';
  document.getElementById('contextMeta').textContent = '默认展示全部团队之间的流程关系。';

  const teams = state.teams || [];
  const visual = graphVisualState('inter-team-flow');
  const graph = visual.graph || { edges: [] };
  const compareGraph = visual.compareGraph;
  const overlayEdges = graphOverlayEdges(graph, compareGraph, visual.mode);
  const changedNodeStatuses = new Map();
  (graph.edges || []).forEach((edge) => {
    const status = compareGraph ? edgeDiffStatus(edge, compareGraph, visual.mode) : 'same';
    if (status !== 'same') {
      changedNodeStatuses.set(edge.from, status);
      changedNodeStatuses.set(edge.to, status);
    }
  });
  overlayEdges.forEach((edge) => {
    changedNodeStatuses.set(edge.from, edge.__diffStatus);
    changedNodeStatuses.set(edge.to, edge.__diffStatus);
  });
  const positions = mergePositions('inter-team-flow', interTeamAutoPositions());
  const sizing = teams.map((team) => {
    const point = positions[`team:${team.team_id}`] || { x: 80, y: 70 };
    return { x: point.x, y: point.y, w: 220, h: 86 };
  });
  const stageSize = stageSizeFromPositions(sizing, 980, 560);
  const { inner, svg } = createStage(stageSize.width, stageSize.height);
  const teamNodes = {};

  teams.forEach((team) => {
    const point = positions[`team:${team.team_id}`] || { x: 80, y: 70 };
    teamNodes[team.team_id] = addNode(inner, {
      x: point.x,
      y: point.y,
      w: 220,
      h: 86,
      title: team.team_name,
      sub: `${team.team_id} · ${safe(team.lead?.name)}`,
      badge: `活跃 ${activeCount(teamTasks(team.team_id))} · 告警 ${alertCount(teamTasks(team.team_id))}`,
      diffStatus: changedNodeStatuses.get(team.team_id) || '',
      selected: state.selectedTeamId === team.team_id,
      connectSource: connectPendingNode('inter-team-flow')?.id === team.team_id,
      canConnect: state.graphEditMode['inter-team-flow'] && state.graphConnectMode['inter-team-flow'],
      nodeRef: { id: team.team_id, type: 'team' },
      view: 'inter-team-flow',
      layoutKey: `team:${team.team_id}`,
      onClick: () => {
        if (handleGraphConnectClick('inter-team-flow', { id: team.team_id, type: 'team' })) return;
        state.selectedTeamId = team.team_id;
        state.selectedObjectType = 'team';
        state.selectedObjectId = team.team_id;
        syncRoute();
        renderAll();
      },
    });
  });

  (graph.edges || []).forEach((edge) => {
    const from = teamNodes[edge.from];
    const to = teamNodes[edge.to];
    const status = compareGraph ? edgeDiffStatus(edge, compareGraph, visual.mode) : 'same';
    if (from && to) drawCurve(svg, from, to, status === 'removed' ? '#c24d44' : status === 'added' ? '#1f8f5f' : '#b27a37', true, status);
  });
  overlayEdges.forEach((edge) => {
    const from = teamNodes[edge.from];
    const to = teamNodes[edge.to];
    if (from && to) drawCurve(svg, from, to, edge.__diffStatus === 'removed' ? '#c24d44' : '#1f8f5f', true, edge.__diffStatus);
  });

  renderInterTeamContext();
}

function renderInterTeamContext() {
  const list = document.getElementById('flowList');
  const detail = document.getElementById('flowContext');
  list.innerHTML = '<div class="object-list-note">节点=团队，边=团队交接。默认只看全局主流程 inter-team:default。</div>';
  const team = getTeamById(state.selectedTeamId) || state.teams?.[0];
  if (!team) {
    detail.innerHTML = '<section class="card"><h4>暂无团队</h4></section>';
    return;
  }
  state.selectedTeamId = team.team_id;
  const graph = currentGraphForView('inter-team-flow') || { edges: [] };
  const inbound = (graph.edges || []).filter((edge) => edge.to === team.team_id);
  const outbound = (graph.edges || []).filter((edge) => edge.from === team.team_id);
  const relatedTasks = teamTasks(team.team_id);
  const blockedTasks = relatedTasks.filter((task) => task.runtime_state === 'stalled' || ['blocked', 'rework'].includes(String(task.closure_state || '')));
  const handoffTasks = relatedTasks.filter((task) => String(task.closure_state || '') === 'ready_for_handoff');
  const recoveryTasks = relatedTasks.filter((task) => Boolean(task.recovery_reason || task.recovery_priority));
  const selectedHandoffTask =
    handoffTasks.find((task) => task.task_id === state.selectedInterTeamHandoffTaskId) || handoffTasks[0] || null;
  state.selectedInterTeamHandoffTaskId = selectedHandoffTask?.task_id || null;
  const implementation = graphEditPayload('inter-team-flow')?.implementation || null;
  const handoffDefaultOwner = String(
    selectedHandoffTask?.next_recommended_owner ||
      selectedHandoffTask?.next_owner ||
      selectedHandoffTask?.current_responsible ||
      ''
  );
  const queuePanels = [
    renderTaskQueueItems('相关任务队列', relatedTasks, '当前团队没有相关任务。', (task) => `task_dashboard.html?task_id=${encodeURIComponent(task.task_id)}`),
    renderTaskQueueItems('阻塞任务队列', blockedTasks, '当前团队没有阻塞任务。', (task) => `task_dashboard.html?task_id=${encodeURIComponent(task.task_id)}`),
    renderTaskQueueItems('待确认交接队列', handoffTasks, '当前团队没有待确认交接任务。', (task) => `task_dashboard.html?task_id=${encodeURIComponent(task.task_id)}`),
    renderTaskQueueItems('恢复候选队列', recoveryTasks, '当前团队没有恢复候选任务。', (task) => `task_dashboard.html?task_id=${encodeURIComponent(task.task_id)}`),
  ].join('');
  const handoffQuickForm = selectedHandoffTask
    ? `
      <section class="card">
        <h4>直接确认交接</h4>
        <div class="muted" style="font-size:13px;line-height:1.6;">在系统架构中心直接提交当前团队的待确认交接。这里只处理当前已经进入 <span class="mono">ready_for_handoff</span> 的对象。</div>
        <div class="field-grid" style="margin-top:10px;">
          <label>
            <span>待交接任务</span>
            <select id="interTeamHandoffTaskSelect">
              ${handoffTasks
                .map(
                  (task) =>
                    `<option value="${safe(task.task_id)}" ${task.task_id === selectedHandoffTask.task_id ? 'selected' : ''}>${safe(
                      task.task_name || task.task_id
                    )}</option>`
                )
                .join('')}
            </select>
          </label>
          <label>
            <span>下一接手人</span>
            <input id="handoffQuickNextOwner" type="text" value="${safe(handoffDefaultOwner)}" placeholder="例如 rd_tester" />
          </label>
          <label style="grid-column:1 / -1;">
            <span>交接说明</span>
            <textarea id="handoffQuickNote" placeholder="交接说明，例如阶段完成、风险和注意事项"></textarea>
          </label>
          <label style="grid-column:1 / -1;">
            <span>产物摘要</span>
            <textarea id="handoffArtifactSummary" placeholder="交接产物摘要，例如 PRD / 代码 / 报告 / 审查结论"></textarea>
          </label>
        </div>
        <div class="row-actions" style="margin-top:10px;">
          <button class="btn primary" id="handoffQuickSubmit">直接确认交接</button>
          <a class="btn" href="task_dashboard.html?task_id=${encodeURIComponent(selectedHandoffTask.task_id)}">打开任务详情</a>
        </div>
      </section>
    `
    : `
      <section class="card">
        <h4>直接确认交接</h4>
        <div class="muted" style="font-size:13px;line-height:1.6;">当前团队没有处于待确认交接状态的任务。</div>
      </section>
    `;
  detail.innerHTML = `
    <section class="card">
      <h4>${safe(team.team_name)}</h4>
      <div class="mono">${safe(team.team_id)} · inter-team:default</div>
    </section>
    <section class="card">
      <h4>当前交接负载</h4>
      <table class="link-table">
        <tbody>
          <tr><th>相关任务</th><td>${safe(relatedTasks.length)}</td></tr>
          <tr><th>阻塞任务</th><td>${safe(blockedTasks.length)}</td></tr>
          <tr><th>待确认交接</th><td>${safe(handoffTasks.length)}</td></tr>
          <tr><th>恢复候选</th><td>${safe(recoveryTasks.length)}</td></tr>
          <tr><th>上游团队</th><td>${inbound.map((edge) => safe(edge.from)).join(' / ') || '-'}</td></tr>
          <tr><th>下游团队</th><td>${outbound.map((edge) => safe(edge.to)).join(' / ') || '-'}</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <h4>当前交接负载面</h4>
      <div class="muted" style="font-size:13px;line-height:1.6;">从这里直接进入任务中心处理当前团队的阻塞、交接确认和恢复候选。对已经进入待确认交接状态的对象，也可以在下方直接提交交接。</div>
      <div class="row-actions" style="margin-top:10px;">
        <a class="btn" href="task_dashboard.html?team=${encodeURIComponent(team.team_id)}">查看该团队任务</a>
        <a class="btn" href="task_dashboard.html?team=${encodeURIComponent(team.team_id)}&team_focus=blocked&inter_team_flow=inter-team%3Adefault">查看阻塞任务</a>
        <a class="btn" href="task_dashboard.html?team=${encodeURIComponent(team.team_id)}&team_focus=handoff&inter_team_flow=inter-team%3Adefault">查看待确认交接</a>
        <a class="btn" href="task_dashboard.html?team=${encodeURIComponent(team.team_id)}&team_focus=recovery&inter_team_flow=inter-team%3Adefault">查看恢复候选</a>
      </div>
    </section>
    ${queuePanels}
    ${handoffQuickForm}
    <section class="card">
      <h4>编辑关系模式</h4>
      <div class="muted" style="font-size:13px;line-height:1.6;">默认编辑全局主流程 <span class="mono">inter-team:default</span>，草稿先提交给鲁班实施，实施结果回写后再确认应用。</div>
      <div class="row-actions" style="margin-top:10px;">
        <button class="btn" id="toggleInterTeamEditBtn">${state.graphEditMode['inter-team-flow'] ? '退出编辑' : '编辑关系模式'}</button>
        <button class="btn" id="toggleInterTeamConnectBtn">${state.graphConnectMode['inter-team-flow'] ? '退出图上连线' : '图上连线模式'}</button>
        <button class="btn" id="submitInterTeamDraftBtn">提交给鲁班</button>
        <button class="btn" id="viewInterTeamImplementationBtn">查看实施结果</button>
        <button class="btn" id="confirmInterTeamImplementationBtn">确认应用</button>
        <button class="btn" id="discardInterTeamDraftBtn">丢弃草稿</button>
      </div>
      <div class="mono" style="margin-top:8px;">${safe(diffSummaryText('inter-team-flow'))}</div>
      <div class="muted" style="margin-top:8px;font-size:12px;">当前实施状态：${safe(implementation?.implementation_status || '未提交')}</div>
      <div class="muted" style="margin-top:8px;font-size:12px;">当前投递状态：${safe(graphDispatchStatusLabel(implementation))}</div>
      <div class="muted" style="margin-top:8px;font-size:12px;">${state.graphConnectMode['inter-team-flow'] ? (connectPendingNode('inter-team-flow') ? `已选来源：${safe(connectPendingNode('inter-team-flow')?.id)}，请拖动节点右侧连线点到目标团队，或点击目标团队完成连线。` : '图上连线模式已开启：拖动节点右侧连线点到目标团队，也可先点来源团队再点目标团队。') : '图上连线模式关闭。'}</div>
      ${
        state.graphEditMode['inter-team-flow']
          ? `
        <div class="field-grid" style="margin-top:10px;">
          <label>
            <span>来源团队</span>
            <select id="interTeamEdgeFrom">
              ${(state.teams || []).map((item) => `<option value="${safe(item.team_id)}" ${item.team_id === team.team_id ? 'selected' : ''}>${safe(item.team_name)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>目标团队</span>
            <select id="interTeamEdgeTo">
              ${(state.teams || []).map((item) => `<option value="${safe(item.team_id)}">${safe(item.team_name)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>交接类型</span>
            <select id="interTeamEdgeType">
              <option value="normal">normal</option>
              <option value="review">review</option>
              <option value="rework">rework</option>
              <option value="blocked">blocked</option>
              <option value="escalated">escalated</option>
            </select>
          </label>
          <label style="grid-column:1 / -1;">
            <span>条件</span>
            <input id="interTeamEdgeCondition" type="text" value="通过" />
          </label>
        </div>
        <div class="row-actions" style="margin-top:10px;">
          <button class="btn primary" id="interTeamAddEdgeBtn">新增团队交接</button>
        </div>
      `
          : ''
      }
      <ul class="queue-list" style="margin-top:10px;">
        ${
          [...inbound, ...outbound].length
            ? [...inbound, ...outbound]
                .map(
                  (edge, index) => `
                <li>
                  <div><strong>${safe(edge.from)}</strong> → <strong>${safe(edge.to)}</strong> · ${safe(edge.handoffType || 'normal')} · ${safe(edge.condition || '通过')}</div>
                  ${state.graphEditMode['inter-team-flow'] ? `<button class="btn" data-inter-edge-index="${index}">删除</button>` : ''}
                </li>
              `
                )
                .join('')
            : '<li>当前团队还没有团队间交接关系。</li>'
        }
      </ul>
    </section>
    ${renderGraphDiffSummary('inter-team-flow')}
    <section class="card">
      <h4>操作</h4>
      <div class="row-actions">
        <a class="btn" href="task_dashboard.html?team=${encodeURIComponent(team.team_id)}">查看该团队任务</a>
        <a class="btn" href="system_dashboard.html?subview=team-workflow&target_id=${encodeURIComponent(team.team_id)}">查看团队内流程</a>
        <a class="btn" href="system_dashboard.html?subview=flow-detail&flow_id=${encodeURIComponent(state.interTeamFlowId)}">查看流程详情</a>
      </div>
    </section>
  `;
  detail.querySelector('#interTeamHandoffTaskSelect')?.addEventListener('change', (event) => {
    state.selectedInterTeamHandoffTaskId = event.target.value;
    renderInterTeamContext();
  });
  detail.querySelector('#handoffQuickSubmit')?.addEventListener('click', async () => {
    try {
      const taskId = String(detail.querySelector('#interTeamHandoffTaskSelect')?.value || '').trim();
      const nextOwner = String(detail.querySelector('#handoffQuickNextOwner')?.value || '').trim();
      const handoffNote = String(detail.querySelector('#handoffQuickNote')?.value || '').trim();
      const artifactSummary = String(detail.querySelector('#handoffArtifactSummary')?.value || '').trim();
      if (!taskId || !nextOwner || !handoffNote || !artifactSummary) {
        alert('请完整填写待交接任务、下一接手人、交接说明和产物摘要。');
        return;
      }
      await requestJSON(`/api/tasks/${encodeURIComponent(taskId)}/confirm-handoff`, 'POST', {
        actor_id: 'dashboard-ui',
        actor_role: 'admin',
        next_owner: nextOwner,
        handoff_note: handoffNote,
        artifact_summary: artifactSummary,
      });
      alert('交接已提交。');
      await refreshAll();
    } catch (error) {
      alert(`交接提交失败: ${safe(error?.message || error)}`);
    }
  });
  detail.querySelector('#toggleInterTeamEditBtn')?.addEventListener('click', () => {
    state.graphEditMode['inter-team-flow'] = !state.graphEditMode['inter-team-flow'];
    if (!state.graphEditMode['inter-team-flow']) {
      state.graphConnectMode['inter-team-flow'] = false;
      clearGraphConnect('inter-team-flow');
    }
    renderInterTeamContext();
  });
  detail.querySelector('#toggleInterTeamConnectBtn')?.addEventListener('click', () => {
    if (!state.graphEditMode['inter-team-flow']) state.graphEditMode['inter-team-flow'] = true;
    state.graphConnectMode['inter-team-flow'] = !state.graphConnectMode['inter-team-flow'];
    if (!state.graphConnectMode['inter-team-flow']) clearGraphConnect('inter-team-flow');
    renderInterTeamContext();
  });
  detail.querySelector('#interTeamAddEdgeBtn')?.addEventListener('click', () => {
    const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('inter-team-flow') || { nodes: [], edges: [] }));
    const from = String(detail.querySelector('#interTeamEdgeFrom')?.value || '').trim();
    const to = String(detail.querySelector('#interTeamEdgeTo')?.value || '').trim();
    const handoffType = String(detail.querySelector('#interTeamEdgeType')?.value || 'normal').trim();
    const condition = String(detail.querySelector('#interTeamEdgeCondition')?.value || '通过').trim();
    if (!from || !to || !condition) return;
    graphDoc.edges = graphDoc.edges || [];
    const exists = graphDoc.edges.some((edge) => edge.from === from && edge.to === to && edge.handoffType === handoffType);
    if (!exists) {
      graphDoc.edges.push({
        key: `${from}->${to}:${handoffType}`,
        from,
        to,
        handoffType,
        condition,
        requiresConfirmation: false,
      });
    }
    setDraftGraph('inter-team-flow', graphDoc);
    renderAll();
  });
  detail.querySelectorAll('[data-inter-edge-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const currentEdges = [...inbound, ...outbound];
      const targetEdge = currentEdges[Number(button.getAttribute('data-inter-edge-index') || -1)];
      const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('inter-team-flow') || { nodes: [], edges: [] }));
      graphDoc.edges = (graphDoc.edges || []).filter(
        (edge) => !(edge.from === targetEdge?.from && edge.to === targetEdge?.to && String(edge.handoffType || 'normal') === String(targetEdge?.handoffType || 'normal'))
      );
      setDraftGraph('inter-team-flow', graphDoc);
      renderAll();
    });
  });
  detail.querySelector('#submitInterTeamDraftBtn')?.addEventListener('click', async () => {
    try {
      await submitCurrentGraphToLuban('inter-team-flow');
      alert('已提交给鲁班。');
      renderAll();
    } catch (error) {
      alert(`提交失败: ${safe(error?.message || error)}`);
    }
  });
  detail.querySelector('#viewInterTeamImplementationBtn')?.addEventListener('click', async () => {
    try {
      await refreshImplementation('inter-team-flow');
      renderAll();
    } catch (error) {
      alert(`读取实施结果失败: ${safe(error?.message || error)}`);
    }
  });
  detail.querySelector('#confirmInterTeamImplementationBtn')?.addEventListener('click', async () => {
    try {
      await confirmImplementation('inter-team-flow');
    } catch (error) {
      alert(`确认应用失败: ${safe(error?.message || error)}`);
    }
  });
  detail.querySelector('#discardInterTeamDraftBtn')?.addEventListener('click', async () => {
    try {
      await discardDraft('inter-team-flow');
    } catch (error) {
      alert(`丢弃草稿失败: ${safe(error?.message || error)}`);
    }
  });
}

function renderTeamWorkflow() {
  const teamId = state.selectedTeamId || state.teams?.[0]?.team_id;
  const team = getTeamById(teamId);
  document.getElementById('mainTitle').textContent = '团队内流程';
  document.getElementById('contextTitle').textContent = '团队流程上下文';
  document.getElementById('contextMeta').textContent = '节点=团队角色/阶段责任，边=团队内交接。';
  if (!team) {
    document.getElementById('mainBody').innerHTML = '<div class="placeholder">暂无团队流程数据。</div>';
    document.getElementById('flowList').innerHTML = '';
    document.getElementById('flowContext').innerHTML = '';
    return;
  }

  const visual = graphVisualState('team-workflow');
  const graph = visual.graph || { nodes: [], edges: [], startNodeId: null, terminalNodes: [] };
  const compareGraph = visual.compareGraph;
  const overlayEdges = graphOverlayEdges(graph, compareGraph, visual.mode);
  const changedNodeStatuses = new Map();
  (graph.edges || []).forEach((edge) => {
    const status = compareGraph ? edgeDiffStatus(edge, compareGraph, visual.mode) : 'same';
    if (status !== 'same') {
      changedNodeStatuses.set(edge.from, status);
      changedNodeStatuses.set(edge.to, status);
    }
  });
  overlayEdges.forEach((edge) => {
    changedNodeStatuses.set(edge.from, edge.__diffStatus);
    changedNodeStatuses.set(edge.to, edge.__diffStatus);
  });
  const nodesSource = graph.nodes || [];
  const width = Math.max(960, nodesSource.length * 240 + 120);
  const height = 420;
  const { inner, svg } = createStage(width, height);
  const nodes = {};
  nodesSource.forEach((step, index) => {
    nodes[step.id] = addNode(inner, {
      x: Number(step.x || 60 + index * 230),
      y: Number(step.y || 110),
      w: 200,
      h: 84,
      title: step.label || step.id,
      sub: `${safe(step.role)} / ${safe((step.defaultAgents || [])[0] || '-')}`,
      badge: step.isTerminal ? '终止' : step.isStart ? '开始' : safe(step.unifiedState),
      diffStatus: changedNodeStatuses.get(step.id) || '',
      selected: state.selectedWorkflowNodeId === step.id,
      connectSource: connectPendingNode('team-workflow')?.id === step.id,
      canConnect: state.graphEditMode['team-workflow'] && state.graphConnectMode['team-workflow'],
      nodeRef: { id: step.id, type: 'role' },
      onMove: async (point) => {
        const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('team-workflow') || { nodes: [], edges: [] }));
        graphDoc.nodes = (graphDoc.nodes || []).map((node) => (node.id === step.id ? { ...node, x: Math.round(point.x), y: Math.round(point.y) } : node));
        setDraftGraph('team-workflow', graphDoc);
      },
      onClick: () => {
        if (handleGraphConnectClick('team-workflow', { id: step.id, type: 'role' })) return;
        state.selectedWorkflowNodeId = step.id;
        renderAll();
      },
    });
  });
  (graph.edges || []).forEach((edge) => {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    const status = compareGraph ? edgeDiffStatus(edge, compareGraph, visual.mode) : 'same';
    const baseColor = edge.transitionType === 'rework' ? '#b9513f' : '#84af99';
    if (from && to) drawCurve(svg, from, to, status === 'removed' ? '#c24d44' : status === 'added' ? '#1f8f5f' : baseColor, edge.transitionType === 'rework', status);
  });
  overlayEdges.forEach((edge) => {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    if (from && to) drawCurve(svg, from, to, edge.__diffStatus === 'removed' ? '#c24d44' : '#1f8f5f', String(edge.transitionType || 'normal') === 'rework', edge.__diffStatus);
  });

  const flowList = document.getElementById('flowList');
  flowList.innerHTML = `
    <div class="object-list-note">选择团队切换团队内流程。</div>
    ${(state.teams || []).map((item) => `
      <article class="flow-item ${item.team_id === teamId ? 'active' : ''}" data-team-id="${safe(item.team_id)}">
        <div class="t">${safe(item.team_name)}</div>
        <div class="m mono">${safe(item.team_id)}</div>
      </article>
    `).join('')}
  `;
  flowList.querySelectorAll('.flow-item[data-team-id]').forEach((item) => {
    item.addEventListener('click', async () => {
      state.selectedTeamId = item.getAttribute('data-team-id');
      state.flowDetail = await fetchJSON(`/api/flow/detail?flow_id=${encodeURIComponent(`team:${state.selectedTeamId}`)}`);
      await loadGraphEdit('team-workflow');
      syncRoute();
      renderAll();
    });
  });

  const selectedNode =
    (graph.nodes || []).find((node) => node.id === state.selectedWorkflowNodeId) ||
    (graph.nodes || [])[0] ||
    null;
  state.selectedWorkflowNodeId = selectedNode?.id || null;
  const relatedEdges = (graph.edges || []).filter((edge) => edge.from === selectedNode?.id || edge.to === selectedNode?.id);
  const implementation = graphEditPayload('team-workflow')?.implementation || null;
  document.getElementById('flowContext').innerHTML = `
    <section class="card">
      <h4>${safe(team.team_name)}</h4>
      <div class="mono">${safe(team.team_id)}</div>
      <div style="margin-top:8px;font-size:13px;color:var(--muted);line-height:1.6;">${safe(team.description)}</div>
    </section>
    <section class="card">
      <h4>关键职责</h4>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;">${(team.responsibilities || []).map((item) => safe(item)).join('、') || '暂无职责定义'}</div>
    </section>
    <section class="card">
      <h4>编辑关系模式</h4>
      <div class="row-actions">
        <button class="btn" id="toggleTeamWorkflowEditBtn">${state.graphEditMode['team-workflow'] ? '退出编辑' : '编辑关系模式'}</button>
        <button class="btn" id="toggleTeamWorkflowConnectBtn">${state.graphConnectMode['team-workflow'] ? '退出图上连线' : '图上连线模式'}</button>
        <button class="btn" id="submitTeamWorkflowDraftBtn">提交给鲁班</button>
        <button class="btn" id="viewTeamWorkflowImplementationBtn">查看实施结果</button>
        <button class="btn" id="confirmTeamWorkflowImplementationBtn">确认应用</button>
        <button class="btn" id="discardTeamWorkflowDraftBtn">丢弃草稿</button>
      </div>
      <div class="mono" style="margin-top:8px;">${safe(diffSummaryText('team-workflow'))}</div>
      <div class="muted" style="margin-top:8px;font-size:12px;">当前实施状态：${safe(implementation?.implementation_status || '未提交')}</div>
      <div class="muted" style="margin-top:8px;font-size:12px;">当前投递状态：${safe(graphDispatchStatusLabel(implementation))}</div>
      <div class="muted" style="margin-top:8px;font-size:12px;">${state.graphConnectMode['team-workflow'] ? (connectPendingNode('team-workflow') ? `已选来源：${safe(connectPendingNode('team-workflow')?.id)}，请拖动节点右侧连线点到目标角色，或点击目标角色完成连线。` : '图上连线模式已开启：拖动节点右侧连线点到目标节点，也可先点来源角色再点目标角色。') : '图上连线模式关闭。'}</div>
      ${
        state.graphEditMode['team-workflow']
          ? `
        <div class="field-grid" style="margin-top:10px;">
          <label>
            <span>来源角色</span>
            <select id="teamWorkflowEdgeFrom">
              ${(graph.nodes || []).map((node) => `<option value="${safe(node.id)}" ${node.id === selectedNode?.id ? 'selected' : ''}>${safe(node.label || node.id)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>目标角色</span>
            <select id="teamWorkflowEdgeTo">
              ${(graph.nodes || []).map((node) => `<option value="${safe(node.id)}">${safe(node.label || node.id)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>交接类型</span>
            <select id="teamWorkflowEdgeType">
              <option value="normal">normal</option>
              <option value="rework">rework</option>
              <option value="blocked">blocked</option>
              <option value="escalated">escalated</option>
              <option value="failure">failure</option>
            </select>
          </label>
          <label style="grid-column:1 / -1;">
            <span>条件</span>
            <input id="teamWorkflowEdgeCondition" type="text" value="通过" />
          </label>
        </div>
        <div class="row-actions" style="margin-top:10px;">
          <button class="btn primary" id="teamWorkflowAddEdgeBtn">新增角色交接</button>
        </div>
      `
          : ''
      }
      <ul class="queue-list" style="margin-top:10px;">
        ${
          relatedEdges.length
            ? relatedEdges
                .map(
                  (edge, index) => `
                <li>
                  <div><strong>${safe(edge.from)}</strong> → <strong>${safe(edge.to)}</strong> · ${safe(edge.transitionType || 'normal')} · ${safe(edge.condition || '通过')}</div>
                  ${state.graphEditMode['team-workflow'] ? `<button class="btn" data-team-workflow-edge-index="${index}">删除</button>` : ''}
                </li>
              `
                )
                .join('')
            : '<li>当前角色还没有配置中的上下游关系。</li>'
        }
      </ul>
    </section>
    ${renderGraphDiffSummary('team-workflow')}
    <section class="card">
      <h4>操作</h4>
      <div class="row-actions">
        <a class="btn" href="system_dashboard.html?subview=flow-detail&flow_id=${encodeURIComponent(`team:${team.team_id}`)}">查看流程详情</a>
      </div>
    </section>
  `;
  document.getElementById('toggleTeamWorkflowEditBtn')?.addEventListener('click', () => {
    state.graphEditMode['team-workflow'] = !state.graphEditMode['team-workflow'];
    if (!state.graphEditMode['team-workflow']) {
      state.graphConnectMode['team-workflow'] = false;
      clearGraphConnect('team-workflow');
    }
    renderAll();
  });
  document.getElementById('toggleTeamWorkflowConnectBtn')?.addEventListener('click', () => {
    if (!state.graphEditMode['team-workflow']) state.graphEditMode['team-workflow'] = true;
    state.graphConnectMode['team-workflow'] = !state.graphConnectMode['team-workflow'];
    if (!state.graphConnectMode['team-workflow']) clearGraphConnect('team-workflow');
    renderAll();
  });
  document.getElementById('teamWorkflowAddEdgeBtn')?.addEventListener('click', () => {
    const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('team-workflow') || { nodes: [], edges: [] }));
    const from = String(document.getElementById('teamWorkflowEdgeFrom')?.value || '').trim();
    const to = String(document.getElementById('teamWorkflowEdgeTo')?.value || '').trim();
    const transitionType = String(document.getElementById('teamWorkflowEdgeType')?.value || 'normal').trim();
    const condition = String(document.getElementById('teamWorkflowEdgeCondition')?.value || '通过').trim();
    if (!from || !to || !condition) return;
    graphDoc.edges = graphDoc.edges || [];
    const exists = graphDoc.edges.some((edge) => edge.from === from && edge.to === to && edge.transitionType === transitionType);
    if (!exists) {
      graphDoc.edges.push({
        key: `${from}->${to}`,
        from,
        to,
        transitionType,
        condition,
        requiresConfirmation: false,
      });
    }
    setDraftGraph('team-workflow', graphDoc);
    renderAll();
  });
  document.querySelectorAll('[data-team-workflow-edge-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetEdge = relatedEdges[Number(button.getAttribute('data-team-workflow-edge-index') || -1)];
      const graphDoc = JSON.parse(JSON.stringify(currentGraphForView('team-workflow') || { nodes: [], edges: [] }));
      graphDoc.edges = (graphDoc.edges || []).filter(
        (edge) => !(edge.from === targetEdge?.from && edge.to === targetEdge?.to && String(edge.transitionType || 'normal') === String(targetEdge?.transitionType || 'normal'))
      );
      setDraftGraph('team-workflow', graphDoc);
      renderAll();
    });
  });
  document.getElementById('submitTeamWorkflowDraftBtn')?.addEventListener('click', async () => {
    try {
      await submitCurrentGraphToLuban('team-workflow');
      alert('已提交给鲁班。');
      renderAll();
    } catch (error) {
      alert(`提交失败: ${safe(error?.message || error)}`);
    }
  });
  document.getElementById('viewTeamWorkflowImplementationBtn')?.addEventListener('click', async () => {
    try {
      await refreshImplementation('team-workflow');
      renderAll();
    } catch (error) {
      alert(`读取实施结果失败: ${safe(error?.message || error)}`);
    }
  });
  document.getElementById('confirmTeamWorkflowImplementationBtn')?.addEventListener('click', async () => {
    try {
      await confirmImplementation('team-workflow');
    } catch (error) {
      alert(`确认应用失败: ${safe(error?.message || error)}`);
    }
  });
  document.getElementById('discardTeamWorkflowDraftBtn')?.addEventListener('click', async () => {
    try {
      await discardDraft('team-workflow');
    } catch (error) {
      alert(`丢弃草稿失败: ${safe(error?.message || error)}`);
    }
  });
}

function computeFlowIssues(detail) {
  const issues = [];
  const steps = detail?.steps || [];
  if (!steps.length) issues.push('没有任何流程节点。');
  if (detail?.flow_type === 'team' && !steps.some((step) => step.owner_role || step.owner_agent)) {
    issues.push('当前团队流程没有明确责任人。');
  }
  return issues;
}

function renderFlowDetail() {
  const detail = state.flowDetail;
  document.getElementById('mainTitle').textContent = '流程详情';
  document.getElementById('contextTitle').textContent = '详情跳转';
  document.getElementById('contextMeta').textContent = '这里只解释结构，不承担主编辑职责。';
  if (!detail || detail.error) {
    document.getElementById('mainBody').innerHTML = '<div class="placeholder">暂无流程详情数据。</div>';
    document.getElementById('flowList').innerHTML = '';
    document.getElementById('flowContext').innerHTML = '';
    return;
  }
  const linkedTasks = tasksForFlow(detail.flow_id);
  const issues = computeFlowIssues(detail);
  const taskLink =
    detail.flow_type === 'team'
      ? `task_dashboard.html?team=${encodeURIComponent(detail.flow_id.split(':', 2)[1])}`
      : `task_dashboard.html?task_id=${encodeURIComponent(detail.metadata?.task_id || '')}`;
  const editLink =
    detail.flow_type === 'team'
      ? `system_dashboard.html?subview=team-workflow&target_id=${encodeURIComponent(detail.flow_id.split(':', 2)[1])}`
      : `system_dashboard.html?subview=inter-team-flow`;

  document.getElementById('mainBody').innerHTML = `
    <div class="governance">
      <section class="card">
        <h4>流程摘要</h4>
        <table class="link-table">
          <tbody>
            <tr><th>流程名称</th><td>${safe(detail.flow_name)}</td></tr>
            <tr><th>流程 ID</th><td class="mono">${safe(detail.flow_id)}</td></tr>
            <tr><th>流程类型</th><td>${safe(detail.flow_type)}</td></tr>
            <tr><th>活跃任务数</th><td>${safe(activeCount(linkedTasks))}</td></tr>
            <tr><th>告警任务数</th><td>${safe(alertCount(linkedTasks))}</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card">
        <h4>结构与上下游</h4>
        <ul class="queue-list">
          ${(detail.steps || []).map((step) => `<li><strong>${safe(step.name)}</strong> · ${safe(step.owner_role || step.team)} / ${safe(step.owner_agent || '-')} · ${safe(step.status || 'pending')}</li>`).join('') || '<li>暂无结构节点</li>'}
        </ul>
        ${(detail.rework_edges || []).length ? `<div class="mono" style="margin-top:8px;">返工边：${detail.rework_edges.map((edge) => `${safe(edge.from)} → ${safe(edge.to)} (${safe(edge.type)})`).join(' / ')}</div>` : '' }
      </section>
      <section class="card">
        <h4>校验结果</h4>
        ${issues.length ? `<ul class="designer-error-list">${issues.map((issue) => `<li>${safe(issue)}</li>`).join('')}</ul>` : '<div style="font-size:13px;color:var(--brand);font-weight:800;">当前流程详情没有发现明显结构问题。</div>'}
      </section>
      <section class="card">
        <h4>关联任务</h4>
        <table class="link-table">
          <tbody>
            <tr><th>活跃任务</th><td>${safe(activeCount(linkedTasks))}</td></tr>
            <tr><th>告警任务</th><td>${safe(alertCount(linkedTasks))}</td></tr>
            <tr><th>最近卡住</th><td>${safe(linkedTasks.find((task) => task.runtime_state === 'stalled')?.task_name || '-')}</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  `;
  document.getElementById('flowList').innerHTML = '<div class="object-list-note">流程详情固定只保留摘要、结构、校验结果和关联任务四块。</div>';
  document.getElementById('flowContext').innerHTML = `
    <section class="card">
      <h4>可执行跳转</h4>
      <div class="row-actions">
        <a class="btn" href="${editLink}">${detail.flow_type === 'team' ? '进入团队内流程设计' : '进入团队间流程设计'}</a>
        <a class="btn" href="${taskLink}">查看全部关联任务</a>
      </div>
    </section>
  `;
}

function renderMainPanel() {
  if (state.view === 'architecture') {
    renderArchitecture();
  } else if (state.view === 'inter-team-flow') {
    renderInterTeamFlow();
  } else if (state.view === 'team-workflow') {
    renderTeamWorkflow();
  } else {
    renderFlowDetail();
  }
}

function renderAll() {
  renderTabs();
  renderSideStats();
  renderMainPanel();
  updateGraphControls();
  const updatedAt = document.getElementById('updatedAt');
  if (updatedAt) updatedAt.textContent = fmtTime(state.updatedAt);
}

async function refreshAll() {
  await loadAllData();
  syncRoute();
  renderAll();
}

document.getElementById('refreshBtn')?.addEventListener('click', async () => {
  try {
    await refreshAll();
  } catch (error) {
    alert(`刷新失败: ${safe(error?.message || error)}`);
  }
});

document.getElementById('zoomInBtn')?.addEventListener('click', () => {
  const view = graphViewKey();
  if (!view) return;
  state.graphZoom[view] = Math.min(1.8, Number((graphZoom(view) + 0.1).toFixed(2)));
  renderAll();
});

document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
  const view = graphViewKey();
  if (!view) return;
  state.graphZoom[view] = Math.max(0.55, Number((graphZoom(view) - 0.1).toFixed(2)));
  renderAll();
});

document.getElementById('fitViewBtn')?.addEventListener('click', () => {
  fitCurrentView();
});

document.getElementById('autoLayoutBtn')?.addEventListener('click', async () => {
  const view = graphViewKey();
  if (view !== 'architecture' && view !== 'inter-team-flow') return;
  try {
    await applyAutoLayout(view);
    fitCurrentView();
  } catch (error) {
    alert(`自动布局失败: ${safe(error?.message || error)}`);
  }
});

document.getElementById('resetLayoutBtn')?.addEventListener('click', async () => {
  const view = graphViewKey();
  if (view !== 'architecture' && view !== 'inter-team-flow') return;
  try {
    clearLayout(view);
    await persistLayout(view);
    state.graphZoom[view] = 1;
    renderAll();
  } catch (error) {
    alert(`重置布局失败: ${safe(error?.message || error)}`);
  }
});

document.querySelectorAll('.tab[data-view]').forEach((tab) => {
  tab.addEventListener('click', async () => {
    state.view = tab.getAttribute('data-view');
    ensureSelectionDefaults();
    if (state.view === 'flow-detail' && !state.selectedFlowId && state.selectedTeamId) {
      state.selectedFlowId = `team:${state.selectedTeamId}`;
    }
    if (state.view === 'team-workflow' && state.selectedTeamId) {
      state.flowDetail = await fetchJSON(`/api/flow/detail?flow_id=${encodeURIComponent(`team:${state.selectedTeamId}`)}`);
    }
    if (state.view === 'flow-detail' && state.selectedFlowId) {
      state.flowDetail = await fetchJSON(`/api/flow/detail?flow_id=${encodeURIComponent(state.selectedFlowId)}`);
    }
    if (state.view === 'architecture' || state.view === 'inter-team-flow' || state.view === 'team-workflow') {
      await loadGraphEdit(state.view);
    }
    syncRoute();
    renderAll();
  });
});

window.addEventListener('resize', () => {
  renderAll();
});

(async () => {
  try {
    parseRoute();
    await refreshAll();
  } catch (error) {
    console.error(error);
    const body = document.getElementById('mainBody');
    if (body) body.innerHTML = `<div class="placeholder">页面加载失败：${safe(error?.message || error)}</div>`;
  }
})();
