import { state, safe } from './state';
import { fetchJSON, postJSON } from './actions';
import {
  getArchitectureIndex,
  getRelevantConfigGroups,
  getTargetTeamLead,
  getTargetStateMachine,
  syncEditableTargetFromSelection,
} from './architecture';
import {
  cloneDoc,
  normalizeStateId,
  transitionTypeLabel,
  buildWorkflowGraph as buildWorkflowGraphModel,
  validateWorkflowGraph,
  serializeWorkflowGraph as serializeWorkflowGraphModel,
} from './workflow_model';

type AdvancedConfigCallbacks = {
  loadGovernance: () => Promise<void>;
  loadAllData: () => Promise<void>;
  renderAll: () => void;
  syncRouteState: () => void;
};

let callbacks: AdvancedConfigCallbacks = {
  loadGovernance: async () => {},
  loadAllData: async () => {},
  renderAll: () => {},
  syncRouteState: () => {},
};

const API = `${window.location.protocol}//${window.location.host}`;

export function bindAdvancedConfigCallbacks(next: AdvancedConfigCallbacks): void {
  callbacks = next;
}

export async function loadConfigDocs(): Promise<void> {
  const [teamLeadsRes, teamStateRes, runtimeVersionRes] = await Promise.all([
    fetchJSON('/api/config/team-leads'),
    fetchJSON('/api/config/team-state-machines'),
    fetchJSON('/api/runtime-versions'),
  ]);
  state.teamLeadsDoc = teamLeadsRes.doc || null;
  state.teamStateDoc = teamStateRes.doc || null;
  state.runtimeVersions = runtimeVersionRes || {};
  await callbacks.loadGovernance();
}

function buildWorkflowGraph(targetId: string): any {
  return buildWorkflowGraphModel(state.teamStateDoc, targetId);
}

export function ensureWorkflowGraph(targetId: string): any {
  if (!targetId) {
    state.workflowGraphTargetId = null;
    state.workflowGraph = null;
    state.selectedWorkflowNodeId = null;
    state.selectedWorkflowEdgeKey = null;
    state.workflowLinkFromNodeId = null;
    return null;
  }
  if (state.workflowGraph && state.workflowGraphTargetId === targetId) return state.workflowGraph;
  state.workflowGraphTargetId = targetId;
  state.workflowGraph = buildWorkflowGraph(targetId);
  state.selectedWorkflowNodeId = state.workflowGraph.startNodeId || state.workflowGraph.nodes[0]?.id || null;
  state.selectedWorkflowEdgeKey = null;
  state.workflowLinkFromNodeId = null;
  return state.workflowGraph;
}

function getSelectedWorkflowNode(): any | null {
  return state.workflowGraph?.nodes?.find((node) => node.id === state.selectedWorkflowNodeId) || null;
}

function getSelectedWorkflowEdge(): any | null {
  return state.workflowGraph?.edges?.find((edge) => edge.key === state.selectedWorkflowEdgeKey) || null;
}

function serializeWorkflowGraph(targetId: string, graph: any): any {
  return serializeWorkflowGraphModel(state.teamStateDoc, targetId, graph);
}

function queueWorkflowDoc(doc: any, targetId: string): void {
  state.pendingChanges['team-state-machines'] = {
    target: 'team-state-machines',
    doc,
    desc: `${targetId} 团队流程设计器`,
  };
}

async function putJSON(path: string, payload: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function fmtTime(v: number | string): string {
  return new Date(v || Date.now()).toLocaleString('zh-CN');
}

function workflowCanvasSize(graph: any): { width: number; height: number } {
  const nodes = graph?.nodes || [];
  const maxX = Math.max(980, ...nodes.map((node) => node.x + 280));
  const maxY = Math.max(560, ...nodes.map((node) => node.y + 190));
  return { width: maxX, height: maxY };
}

function workflowEdgePath(graph: any, edge: any): string {
  const from = graph.nodes.find((node) => node.id === edge.from);
  const to = graph.nodes.find((node) => node.id === edge.to);
  if (!from || !to) return '';
  const x1 = from.x + 210;
  const y1 = from.y + 52;
  const x2 = to.x;
  const y2 = to.y + 52;
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function renderWorkflowDesignerHtml(meta: any, graph: any, targetSummary: string, pendingCount: number): string {
  const issues = validateWorkflowGraph(graph);
  const selectedNode = getSelectedWorkflowNode();
  const selectedEdge = getSelectedWorkflowEdge();
  const size = workflowCanvasSize(graph);
  const lastPublished = graph.lastPublishedAt ? fmtTime(graph.lastPublishedAt) : '-';
  const nodesHtml = graph.nodes.map((node) => `
    <article
      class="workflow-node ${state.selectedWorkflowNodeId === node.id ? 'selected' : ''} ${node.isStart ? 'start-node' : ''} ${node.isTerminal ? 'terminal-node' : ''}"
      data-workflow-node-id="${safe(node.id)}"
      style="left:${node.x}px;top:${node.y}px;"
    >
      <div class="headline">
        <div class="name">${safe(node.id)}</div>
        ${node.isStart ? '<span class="workflow-chip">开始</span>' : ''}
      </div>
      <div class="body">
        <div>${safe(node.unifiedState)}</div>
        <div>${safe(node.role || '未指定责任角色')}</div>
        <div class="designer-path">${safe(node.description || '暂无阶段说明')}</div>
      </div>
      <div class="mini-chip-row">
        <span class="workflow-chip">${node.heartbeatInterval}s</span>
        <span class="workflow-chip">${node.heartbeatTimeout}s timeout</span>
        ${node.isTerminal ? '<span class="workflow-chip">终止</span>' : ''}
      </div>
    </article>
  `).join('');
  const edgesHtml = graph.edges.map((edge) => {
    const selected = state.selectedWorkflowEdgeKey === edge.key;
    const stroke = selected ? '#116346' : (edge.transitionType === 'rework' ? '#b9513f' : edge.transitionType === 'blocked' ? '#b27a37' : '#84af99');
    return `
      <g data-svg-edge="${safe(edge.key)}">
        <path d="${workflowEdgePath(graph, edge)}" fill="none" stroke="${stroke}" stroke-width="${selected ? 3 : 2}" marker-end="url(#arrow-main)"></path>
      </g>
    `;
  }).join('');
  const edgeListHtml = graph.edges.length ? graph.edges.map((edge) => `
    <article class="designer-list-item ${state.selectedWorkflowEdgeKey === edge.key ? 'selected' : ''}" data-edge-key="${safe(edge.key)}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div style="font-weight:800;">${safe(edge.from)} -> ${safe(edge.to)}</div>
        <span class="workflow-chip">${transitionTypeLabel(edge.transitionType)}</span>
      </div>
      <div class="designer-path" style="margin-top:6px;">条件=${safe(edge.condition || '-')} · 人工确认=${edge.requiresConfirmation ? 'yes' : 'no'}</div>
    </article>
  `).join('') : '<div class="designer-empty">当前还没有连线。选中节点后点击“开始连线”，再点另一个节点创建流转。</div>';

  return `
    <section class="editor-card" style="margin-bottom:12px;border-color:#7bb094;background:linear-gradient(135deg,#f2fbf6 0%,#fbf8ef 100%);">
      <h4>流程设计器</h4>
      <div style="font-size:13px;color:var(--muted);line-height:1.7;">当前正在用图形方式编辑 ${safe(targetSummary)} 的团队流程状态机。保存时会回写现有 team-state-machines 文档，原始 JSON 仅保留在专家模式。</div>
    </section>

    <div class="mode-switch">
      <button class="btn primary" id="workflowDesignerModeBtn">流程设计器</button>
      <button class="btn" id="expertModeTabBtn">专家模式</button>
    </div>

    <section class="designer-meta">
      <article class="designer-meta-card"><div class="label">当前团队</div><div class="value">${safe(targetSummary)}</div></article>
      <article class="designer-meta-card"><div class="label">当前版本</div><div class="value">${safe(graph.version || '-')}</div></article>
      <article class="designer-meta-card"><div class="label">最近发布时间</div><div class="value">${safe(lastPublished)}</div></article>
      <article class="designer-meta-card"><div class="label">未发布变更</div><div class="value">${pendingCount ? `${pendingCount} 项待发布` : '当前无待发布变更'}</div></article>
    </section>

    <div class="designer-shell">
      <section class="designer-stage">
        <div class="designer-toolbar">
          <button class="btn" id="addWorkflowNodeBtn">添加阶段</button>
          <button class="btn" id="startLinkModeBtn" ${selectedNode ? '' : 'disabled'}>${state.workflowLinkFromNodeId ? `正在连线 ${safe(state.workflowLinkFromNodeId)}` : '开始连线'}</button>
          <button class="btn warn" id="deleteWorkflowNodeBtn" ${selectedNode ? '' : 'disabled'}>删除选中阶段</button>
          <button class="btn" id="saveWorkflowDraftBtn">保存草稿</button>
          <button class="btn" id="queueWorkflowBtn">加入发布队列</button>
          <button class="btn primary" id="publishWorkflowBtn">发布</button>
        </div>
        <div class="designer-canvas-scroll">
          <div id="workflowDesignerCanvas" class="designer-canvas" style="width:${size.width}px;height:${size.height}px;">
            <svg class="designer-edges" viewBox="0 0 ${size.width} ${size.height}">
              <defs>
                <marker id="arrow-main" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                  <path d="M0,0 L8,3 L0,6 z" fill="#84af99"></path>
                </marker>
              </defs>
              ${edgesHtml}
            </svg>
            ${nodesHtml}
          </div>
        </div>
      </section>

      <aside class="designer-side">
        <section class="editor-card">
          <h4>流程校验</h4>
          ${issues.length ? `<ul class="designer-error-list">${issues.map((issue) => `<li>${safe(issue)}</li>`).join('')}</ul>` : '<div style="font-size:13px;color:var(--brand);font-weight:800;">当前流程图通过基础校验。</div>'}
        </section>

        <section class="editor-card">
          <h4>节点详情</h4>
          ${selectedNode ? `
            <div class="designer-field"><label>阶段名称</label><input id="workflowNodeNameInput" value="${safe(selectedNode.id)}" /></div>
            <div class="designer-field"><label>统一状态映射</label>
              <select id="workflowNodeUnifiedSelect">
                ${(state.teamStateDoc?.unified_states || []).map((s) => `<option value="${safe(s)}" ${selectedNode.unifiedState === s ? 'selected' : ''}>${safe(s)}</option>`).join('')}
              </select>
            </div>
            <div class="designer-field"><label>责任角色/说明</label><input id="workflowNodeRoleInput" value="${safe(selectedNode.role || '')}" placeholder="例如：RD Lead / Reviewer" /></div>
            <div class="designer-field"><label>阶段说明</label><textarea id="workflowNodeDescInput" placeholder="说明该阶段负责什么">${safe(selectedNode.description || '')}</textarea></div>
            <div class="designer-field"><label>心跳间隔（秒）</label><input id="workflowNodeHeartbeatInput" type="number" min="30" step="30" value="${safe(selectedNode.heartbeatInterval)}" /></div>
            <div class="designer-field"><label>超时阈值（秒）</label><input id="workflowNodeTimeoutInput" type="number" min="60" step="30" value="${safe(selectedNode.heartbeatTimeout)}" /></div>
            <div class="row-actions">
              <label class="chip"><input type="checkbox" id="workflowNodeStartCk" ${selectedNode.isStart ? 'checked' : ''} /> 开始节点</label>
              <label class="chip"><input type="checkbox" id="workflowNodeTerminalCk" ${selectedNode.isTerminal ? 'checked' : ''} /> 终止节点</label>
            </div>
            <div class="designer-path">提示：拖拽节点可调整画布布局；开始连线后点击另一个节点即可创建流转。</div>
          ` : '<div class="designer-empty">选中画布中的阶段节点后，这里可以编辑名称、统一状态、责任说明和心跳要求。</div>'}
        </section>

        <section class="editor-card">
          <h4>连线详情</h4>
          ${selectedEdge ? `
            <div class="designer-path">${safe(selectedEdge.from)} -> ${safe(selectedEdge.to)}</div>
            <div class="designer-field"><label>流转类型</label>
              <select id="edgeTypeSelect">
                ${['normal','rework','blocked','escalated','failure'].map((type) => `<option value="${type}" ${selectedEdge.transitionType === type ? 'selected' : ''}>${transitionTypeLabel(type)}</option>`).join('')}
              </select>
            </div>
            <div class="designer-field"><label>条件块</label>
              <select id="edgeConditionSelect">
                ${['通过','失败','返工','阻塞','超时','人工确认','缺输入'].map((label) => `<option value="${label}" ${selectedEdge.condition === label ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
            <div class="row-actions">
              <label class="chip"><input type="checkbox" id="edgeConfirmCk" ${selectedEdge.requiresConfirmation ? 'checked' : ''} /> 需要人工确认</label>
              <button class="btn warn" id="deleteWorkflowEdgeBtn">删除连线</button>
            </div>
          ` : '<div class="designer-empty">从下方列表或画布选择一条连线后，这里可以编辑流转类型与条件块。</div>'}
        </section>

        <section class="editor-card">
          <h4>流转列表</h4>
          <div class="designer-list">${edgeListHtml}</div>
        </section>
      </aside>
    </div>
  `;
}

function renderAdvancedConfigExpertHtml(
  targetSummary: string,
  targetTeam: any,
  targetId: string,
  leadConfig: any,
  machineConfig: any,
  relatedGroups: Set<string>,
  leadsText: string,
  stateText: string,
  pendingHtml: string,
  proposal: string,
  pendingCount: number
): string {
  return `
    <div class="mode-switch">
      <button class="btn" id="workflowDesignerModeBtn">流程设计器</button>
      <button class="btn primary" id="expertModeTabBtn">专家模式</button>
    </div>

    <section class="editor-card" style="margin-bottom:12px;border-color:#dca45f;background:#fffaf2;">
      <h4>专家模式</h4>
      <div style="font-size:13px;color:#795428;line-height:1.7;">这里保留底层规则编辑器和发布队列，适合需要直接处理 team-state-machines 原始文档、提示词补丁和发布细节的专家用户。</div>
    </section>

    <details class="config-group" ${relatedGroups.has('team-leads') ? 'open' : ''}>
      <summary><span>团队负责人</span><span class="chip">${safe(targetSummary)}</span></summary>
      <div class="config-group-body">
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">这里改的是团队负责人归属和职责，不是改单个任务。当前会影响 ${safe(targetTeam?.team_name || targetId)} 的 lead 分派与团队入口。</div>
        <div class="mono">当前 lead: ${safe(leadConfig?.lead_name || leadConfig?.lead_agent || '-')} · backup: ${safe(leadConfig?.backup || '-')}</div>
        <textarea id="teamLeadsEditor">${safe(leadsText)}</textarea>
        <div class="row-actions">
          <button class="btn" id="saveTeamLeadsBtn">保存到配置</button>
          <button class="btn primary" id="queueTeamLeadsBtn">加入发布队列</button>
        </div>
      </div>
    </details>

    <details class="config-group" ${relatedGroups.has('team-state-machines') ? 'open' : ''}>
      <summary><span>团队流程状态机</span><span class="chip">${safe(targetSummary)}</span></summary>
      <div class="config-group-body">
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">这里是 team-state-machines 的原始专家编辑器。默认请先用流程设计器，只有需要直接处理原始文档时才在这里改。</div>
        <div class="mono">当前阶段: ${safe((machineConfig?.internal_states || []).join(' -> ') || '-')}</div>
        <textarea id="teamStateEditor">${safe(stateText)}</textarea>
        <div class="row-actions">
          <button class="btn" id="saveTeamStateBtn">保存到配置</button>
          <button class="btn primary" id="queueTeamStateBtn">加入发布队列</button>
        </div>
      </div>
    </details>

    <details class="config-group" ${relatedGroups.has('patch-from-prompt') ? 'open' : ''}>
      <summary><span>治理提示词补丁</span><span class="chip">${safe(targetSummary)}</span></summary>
      <div class="config-group-body">
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">这里生成的是针对团队流程状态机的补丁提案，不会直接生效。先生成提案，再决定是否进入发布队列。</div>
        <textarea id="promptInput" placeholder="例如：${safe(targetId || 'team-rd')} 添加职责: 代码审计；并新增 TESTING -> REWORK"></textarea>
        <div class="row-actions">
          <button class="btn" id="genPatchBtn">生成提案</button>
        </div>
        ${proposal}
      </div>
    </details>

    <details class="config-group" ${relatedGroups.has('publish-queue') ? 'open' : ''}>
      <summary><span>发布队列</span><span class="chip">${pendingCount} 项待发布</span></summary>
      <div class="config-group-body">
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">这里控制底层规则何时正式生效。发布队列是全局队列，但当前主要面向 ${safe(targetTeam?.team_name || targetId)} 的相关变更。</div>
        ${pendingHtml}
        <div class="row-actions">
          <label class="chip"><input id="restartGatewayCk" type="checkbox" /> 发布后重启 Gateway</label>
          <button class="btn warn" id="clearQueueBtn">清空发布队列</button>
          <button class="btn primary" id="publishBtn">发布底层变更</button>
        </div>
        <div class="danger-text">发布流程：validate → backup → apply → optional restart</div>
      </div>
    </details>
  `;
}

function attachWorkflowDesignerInteractions(targetId: string): void {
  const graph = ensureWorkflowGraph(targetId);
  if (!graph) return;

  const rerender = () => renderAdvancedConfig();
  const selectedNode = getSelectedWorkflowNode();
  const selectedEdge = getSelectedWorkflowEdge();

  document.querySelectorAll('[data-workflow-node-id]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      const nodeId = (el as HTMLElement).dataset.workflowNodeId;
      if (state.workflowLinkFromNodeId && state.workflowLinkFromNodeId !== nodeId) {
        const edgeKey = `${state.workflowLinkFromNodeId}->${nodeId}`;
        const exists = graph.edges.some((edge) => edge.key === edgeKey);
        if (!exists) {
          graph.edges.push({
            key: edgeKey,
            from: state.workflowLinkFromNodeId,
            to: nodeId,
            transitionType: 'normal',
            condition: '通过',
            requiresConfirmation: false,
          });
        }
        state.selectedWorkflowEdgeKey = edgeKey;
        state.selectedWorkflowNodeId = null;
        state.workflowLinkFromNodeId = null;
        rerender();
        return;
      }
      state.selectedWorkflowNodeId = nodeId;
      state.selectedWorkflowEdgeKey = null;
      rerender();
    });

    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let dragging = false;
    el.addEventListener('mousedown', (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const node = graph.nodes.find((item) => item.id === (el as HTMLElement).dataset.workflowNodeId);
      if (!node) return;
      originX = node.x;
      originY = node.y;
      (el as HTMLElement).style.cursor = 'grabbing';
      const onMove = (moveEvent: MouseEvent) => {
        if (!dragging) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        node.x = Math.max(24, originX + dx);
        node.y = Math.max(24, originY + dy);
        (el as HTMLElement).style.left = `${node.x}px`;
        (el as HTMLElement).style.top = `${node.y}px`;
      };
      const onUp = () => {
        dragging = false;
        (el as HTMLElement).style.cursor = 'grab';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        rerender();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });

  document.querySelectorAll('[data-edge-key]').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedWorkflowEdgeKey = (el as HTMLElement).dataset.edgeKey;
      state.selectedWorkflowNodeId = null;
      rerender();
    });
  });

  document.getElementById('addWorkflowNodeBtn')?.addEventListener('click', () => {
    const existing = new Set(graph.nodes.map((node) => node.id));
    let idx = graph.nodes.length + 1;
    let nextId = `STAGE_${idx}`;
    while (existing.has(nextId)) {
      idx += 1;
      nextId = `STAGE_${idx}`;
    }
    graph.nodes.push({
      id: nextId,
      label: nextId,
      unifiedState: 'RUNNING',
      role: '',
      description: '',
      x: 72 + (graph.nodes.length % 4) * 240,
      y: 76 + Math.floor(graph.nodes.length / 4) * 168,
      heartbeatInterval: graph.defaults.intervalSeconds,
      heartbeatTimeout: graph.defaults.timeoutThresholdSeconds,
      isStart: false,
      isTerminal: false,
    });
    state.selectedWorkflowNodeId = nextId;
    state.selectedWorkflowEdgeKey = null;
    rerender();
  });

  document.getElementById('deleteWorkflowNodeBtn')?.addEventListener('click', () => {
    if (!selectedNode) return;
    graph.nodes = graph.nodes.filter((node) => node.id !== selectedNode.id);
    graph.edges = graph.edges.filter((edge) => edge.from !== selectedNode.id && edge.to !== selectedNode.id);
    if (graph.startNodeId === selectedNode.id) graph.startNodeId = graph.nodes[0]?.id || null;
    state.selectedWorkflowNodeId = graph.nodes[0]?.id || null;
    state.selectedWorkflowEdgeKey = null;
    rerender();
  });

  document.getElementById('startLinkModeBtn')?.addEventListener('click', () => {
    if (!selectedNode) return;
    state.workflowLinkFromNodeId = state.workflowLinkFromNodeId === selectedNode.id ? null : selectedNode.id;
    rerender();
  });

  document.getElementById('workflowNodeNameInput')?.addEventListener('change', (event) => {
    if (!selectedNode) return;
    const nextId = normalizeStateId((event.target as HTMLInputElement).value);
    if (nextId !== selectedNode.id && graph.nodes.some((node) => node.id === nextId)) {
      alert('阶段名称重复，请更换。');
      (event.target as HTMLInputElement).value = selectedNode.id;
      return;
    }
    const oldId = selectedNode.id;
    selectedNode.id = nextId;
    selectedNode.label = nextId;
    graph.edges.forEach((edge) => {
      if (edge.from === oldId) edge.from = nextId;
      if (edge.to === oldId) edge.to = nextId;
      edge.key = `${edge.from}->${edge.to}`;
    });
    if (graph.startNodeId === oldId) graph.startNodeId = nextId;
    graph.nodes.forEach((node) => {
      if (node !== selectedNode && node.id === nextId) node.id = normalizeStateId(`${nextId}_${Math.random().toString(36).slice(2,4)}`);
    });
    state.selectedWorkflowNodeId = nextId;
    rerender();
  });

  document.getElementById('workflowNodeUnifiedSelect')?.addEventListener('change', (event) => {
    if (!selectedNode) return;
    selectedNode.unifiedState = (event.target as HTMLSelectElement).value;
  });
  document.getElementById('workflowNodeRoleInput')?.addEventListener('input', (event) => {
    if (!selectedNode) return;
    selectedNode.role = (event.target as HTMLInputElement).value;
  });
  document.getElementById('workflowNodeDescInput')?.addEventListener('input', (event) => {
    if (!selectedNode) return;
    selectedNode.description = (event.target as HTMLTextAreaElement).value;
  });
  document.getElementById('workflowNodeHeartbeatInput')?.addEventListener('change', (event) => {
    if (!selectedNode) return;
    selectedNode.heartbeatInterval = Math.max(30, Number((event.target as HTMLInputElement).value || graph.defaults.intervalSeconds));
  });
  document.getElementById('workflowNodeTimeoutInput')?.addEventListener('change', (event) => {
    if (!selectedNode) return;
    selectedNode.heartbeatTimeout = Math.max(60, Number((event.target as HTMLInputElement).value || graph.defaults.timeoutThresholdSeconds));
  });
  document.getElementById('workflowNodeStartCk')?.addEventListener('change', (event) => {
    if (!selectedNode) return;
    graph.nodes.forEach((node) => { node.isStart = false; });
    selectedNode.isStart = Boolean((event.target as HTMLInputElement).checked);
    graph.startNodeId = (event.target as HTMLInputElement).checked ? selectedNode.id : (graph.nodes[0]?.id || null);
    rerender();
  });
  document.getElementById('workflowNodeTerminalCk')?.addEventListener('change', (event) => {
    if (!selectedNode) return;
    selectedNode.isTerminal = Boolean((event.target as HTMLInputElement).checked);
  });

  document.getElementById('edgeTypeSelect')?.addEventListener('change', (event) => {
    if (!selectedEdge) return;
    selectedEdge.transitionType = (event.target as HTMLSelectElement).value;
  });
  document.getElementById('edgeConditionSelect')?.addEventListener('change', (event) => {
    if (!selectedEdge) return;
    selectedEdge.condition = (event.target as HTMLSelectElement).value;
  });
  document.getElementById('edgeConfirmCk')?.addEventListener('change', (event) => {
    if (!selectedEdge) return;
    selectedEdge.requiresConfirmation = Boolean((event.target as HTMLInputElement).checked);
  });
  document.getElementById('deleteWorkflowEdgeBtn')?.addEventListener('click', () => {
    if (!selectedEdge) return;
    graph.edges = graph.edges.filter((edge) => edge.key !== selectedEdge.key);
    state.selectedWorkflowEdgeKey = null;
    rerender();
  });

  document.getElementById('saveWorkflowDraftBtn')?.addEventListener('click', async () => {
    const issues = validateWorkflowGraph(graph);
    if (issues.length) {
      alert(`流程图校验失败：\n- ${issues.join('\n- ')}`);
      return;
    }
    try {
      const doc = serializeWorkflowGraph(targetId, graph);
      const res = await putJSON('/api/config/team-state-machines', { doc, operator: 'dashboard-ui' });
      if (!res.ok) throw new Error(res.error || '保存失败');
      state.teamStateDoc = doc;
      state.workflowGraph = buildWorkflowGraph(targetId);
      alert(`流程草稿已保存\nbackup: ${safe(res.backup)}`);
      rerender();
    } catch (e) {
      alert(`保存失败: ${e.message}`);
    }
  });

  document.getElementById('queueWorkflowBtn')?.addEventListener('click', () => {
    const issues = validateWorkflowGraph(graph);
    if (issues.length) {
      alert(`流程图校验失败：\n- ${issues.join('\n- ')}`);
      return;
    }
    const doc = serializeWorkflowGraph(targetId, graph);
    queueWorkflowDoc(doc, targetId);
    rerender();
  });

  document.getElementById('publishWorkflowBtn')?.addEventListener('click', async () => {
    const issues = validateWorkflowGraph(graph);
    if (issues.length) {
      alert(`流程图校验失败：\n- ${issues.join('\n- ')}`);
      return;
    }
    const queuedDoc = serializeWorkflowGraph(targetId, graph);
    queuedDoc.metadata = queuedDoc.metadata || {};
    queuedDoc.metadata.last_published_at = new Date().toISOString();
    queueWorkflowDoc(queuedDoc, targetId);
    try {
      const changes = Object.values(state.pendingChanges);
      const res = await postJSON('/api/config/publish', { changes, restart_gateway: false, operator: 'dashboard-ui' });
      if (!res.ok) throw new Error(res.error || '发布失败');
      state.pendingChanges = {};
      await loadConfigDocs();
      state.workflowGraph = buildWorkflowGraph(targetId);
      alert(`发布成功\nbackup: ${safe(res.backup)}\nrestart_done: ${safe(res.restart_done)}`);
      rerender();
    } catch (e) {
      alert(`发布失败: ${e.message}`);
    }
  });
}

export function renderAdvancedConfig(): void {
  document.getElementById('mainTitle').textContent = '高级配置';
  const cp = document.getElementById('contextPanel');
  if (cp) cp.style.display = 'none';
  const mg = document.getElementById('mainGrid');
  if (mg) mg.classList.add('grid--full');

  const meta = syncEditableTargetFromSelection();
  const hasObject = Boolean(meta);
  const hasEditableTarget = Boolean(meta?.editable?.targetId);
  const targetId = state.selectedTargetId;
  const targetTeam = targetId ? getArchitectureIndex().teamById[targetId] : null;
  const leadConfig = targetId ? getTargetTeamLead(targetId) : null;
  const machineConfig = targetId ? getTargetStateMachine(targetId) : null;
  const relatedGroups = new Set(getRelevantConfigGroups(meta));
  const leadsText = state.teamLeadsDoc ? JSON.stringify(state.teamLeadsDoc, null, 2) : '{}';
  const stateText = state.teamStateDoc ? JSON.stringify(state.teamStateDoc, null, 2) : '{}';
  const pending = Object.values(state.pendingChanges);
  const pendingHtml = pending.length
    ? `<ul class="queue-list">${pending.map((x: any) => `<li>${safe(x.target)} · ${safe(x.desc || 'queued')}</li>`).join('')}</ul>`
    : '<div class="warn-text">当前没有发布队列。请先“加入发布队列”。</div>';
  const proposal = state.promptProposal
    ? `<pre class="mono" style="white-space:pre-wrap;background:#f7fbf9;border:1px solid #d7e3dc;border-radius:10px;padding:8px;">${safe(JSON.stringify(state.promptProposal, null, 2))}</pre>`
    : '<div class="warn-text">尚未生成提示词补丁提案。</div>';
  const targetSummary = targetTeam ? `${safe(targetTeam.team_name)}（${safe(targetTeam.team_id)}）` : '未命中可编辑团队';
  if (!state.advancedConfigMode) state.advancedConfigMode = 'workflow-designer';

  if (!hasObject) {
    document.getElementById('mainBody').innerHTML = `
      <div class="governance">
        <section class="editor-card" style="margin-bottom:12px;border-color:#dca45f;background:#fffaf2;">
          <h4>高级配置</h4>
          <div style="font-size:13px;color:#795428;line-height:1.7;">这是底层规则编辑区。当前未选中任何对象。请先从架构关系图选择团队/角色，再进入配置页面。</div>
          <div class="row-actions">
            <button class="btn primary" id="backToArchitectureBtn">返回架构关系图</button>
            <button class="btn" id="enterExpertWithoutTargetBtn">查看专家模式说明</button>
          </div>
        </section>
      </div>
    `;
    document.getElementById('backToArchitectureBtn')?.addEventListener('click', () => {
      state.view = 'architecture-map';
      callbacks.syncRouteState();
      callbacks.renderAll();
    });
    document.getElementById('enterExpertWithoutTargetBtn')?.addEventListener('click', () => {
      state.advancedConfigMode = 'expert';
      renderAdvancedConfig();
    });
    return;
  }

  const modeContent = !hasEditableTarget
    ? `
        <section class="editor-card">
          <h4>当前对象不支持直接编辑</h4>
          <div style="font-size:13px;color:var(--muted);line-height:1.7;">${safe(meta.editable?.reason || '当前对象没有对应的团队级配置入口。')}</div>
        </section>
      `
    : (state.advancedConfigMode === 'expert'
        ? renderAdvancedConfigExpertHtml(targetSummary, targetTeam, targetId, leadConfig, machineConfig, relatedGroups, leadsText, stateText, pendingHtml, proposal, pending.length)
        : renderWorkflowDesignerHtml(meta, ensureWorkflowGraph(targetId), targetSummary, pending.length));

  document.getElementById('mainBody').innerHTML = `
    <div class="governance">
      ${modeContent}
    </div>
  `;

  if (!hasEditableTarget) return;

  document.getElementById('workflowDesignerModeBtn')?.addEventListener('click', () => {
    state.advancedConfigMode = 'workflow-designer';
    callbacks.syncRouteState();
    renderAdvancedConfig();
  });
  document.getElementById('expertModeTabBtn')?.addEventListener('click', () => {
    state.advancedConfigMode = 'expert';
    callbacks.syncRouteState();
    renderAdvancedConfig();
  });

  if (state.advancedConfigMode === 'workflow-designer') {
    attachWorkflowDesignerInteractions(targetId);
    return;
  }

  document.getElementById('saveTeamLeadsBtn')?.addEventListener('click', async () => {
    try {
      const doc = JSON.parse((document.getElementById('teamLeadsEditor') as HTMLTextAreaElement).value);
      const res = await putJSON('/api/config/team-leads', { doc, operator: 'dashboard-ui' });
      if (!res.ok) throw new Error(res.error || '保存失败');
      state.teamLeadsDoc = doc;
      alert(`团队 Lead 配置已保存\nbackup: ${safe(res.backup)}`);
    } catch (e) {
      alert(`保存失败: ${e.message}`);
    }
  });

  document.getElementById('saveTeamStateBtn')?.addEventListener('click', async () => {
    try {
      const doc = JSON.parse((document.getElementById('teamStateEditor') as HTMLTextAreaElement).value);
      const res = await putJSON('/api/config/team-state-machines', { doc, operator: 'dashboard-ui' });
      if (!res.ok) throw new Error(res.error || '保存失败');
      state.teamStateDoc = doc;
      alert(`团队状态机已保存\nbackup: ${safe(res.backup)}`);
    } catch (e) {
      alert(`保存失败: ${e.message}`);
    }
  });

  document.getElementById('queueTeamLeadsBtn')?.addEventListener('click', () => {
    try {
      const doc = JSON.parse((document.getElementById('teamLeadsEditor') as HTMLTextAreaElement).value);
      state.pendingChanges['team-leads'] = { target: 'team-leads', doc, desc: '团队 Lead 配置' };
      renderAdvancedConfig();
    } catch (e) {
      alert(`JSON 解析失败: ${e.message}`);
    }
  });

  document.getElementById('queueTeamStateBtn')?.addEventListener('click', () => {
    try {
      const doc = JSON.parse((document.getElementById('teamStateEditor') as HTMLTextAreaElement).value);
      state.pendingChanges['team-state-machines'] = { target: 'team-state-machines', doc, desc: '团队状态机配置' };
      renderAdvancedConfig();
    } catch (e) {
      alert(`JSON 解析失败: ${e.message}`);
    }
  });

  document.getElementById('clearQueueBtn')?.addEventListener('click', () => {
    state.pendingChanges = {};
    renderAdvancedConfig();
  });

  document.getElementById('genPatchBtn')?.addEventListener('click', async () => {
    try {
      const prompt = (document.getElementById('promptInput') as HTMLTextAreaElement).value.trim();
      if (!prompt) {
        alert('请输入提示词');
        return;
      }
      const res = await postJSON('/api/config/patch-from-prompt', { prompt, target: 'team-state-machines' });
      if (!res.ok) throw new Error(res.error || '生成失败');
      state.promptProposal = res.proposal;
      renderAdvancedConfig();
    } catch (e) {
      alert(`生成失败: ${e.message}`);
    }
  });

  document.getElementById('publishBtn')?.addEventListener('click', async () => {
    try {
      const changes = Object.values(state.pendingChanges);
      if (!changes.length) {
        alert('发布队列为空');
        return;
      }
      const restartGateway = Boolean((document.getElementById('restartGatewayCk') as HTMLInputElement)?.checked);
      const res = await postJSON('/api/config/publish', { changes, restart_gateway: restartGateway, operator: 'dashboard-ui' });
      if (!res.ok) throw new Error(res.error || '发布失败');
      alert(`发布成功\nbackup: ${safe(res.backup)}\nrestart_done: ${safe(res.restart_done)}`);
      state.pendingChanges = {};
      await loadConfigDocs();
      await callbacks.loadAllData();
      callbacks.renderAll();
    } catch (e) {
      alert(`发布失败: ${e.message}`);
    }
  });
}
