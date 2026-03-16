import { state, safe, objectTypeLabel } from './state';

type ArchitectureCallbacks = {
  syncRouteState: () => void;
  renderAll: () => void;
};

let callbacks: ArchitectureCallbacks = {
  syncRouteState: () => {},
  renderAll: () => {},
};

export function bindArchitectureCallbacks(next: ArchitectureCallbacks): void {
  callbacks = next;
}

export function getArchitectureIndex(): {
  teamById: Record<string, any>;
  memberById: Record<string, any>;
  standaloneById: Record<string, any>;
} {
  const arch = state.architecture || {};
  const teamById: Record<string, any> = {};
  const memberById: Record<string, any> = {};
  const standaloneById: Record<string, any> = {};
  (arch.teams || []).forEach((team) => {
    teamById[team.team_id] = team;
    (team.members || []).forEach((member) => {
      memberById[member.agent_id] = {
        ...member,
        team_id: team.team_id,
        team_name: team.team_name,
      };
    });
  });
  (arch.standalone_agents || []).forEach((agent) => {
    standaloneById[agent.agent_id] = agent;
  });
  return { teamById, memberById, standaloneById };
}

export function deriveEditableTarget(type: string, objectId: string): { targetType: string | null; targetId: string | null; reason: string } | null {
  const arch = state.architecture || {};
  const idx = getArchitectureIndex();
  if (type === 'team') {
    if (!idx.teamById[objectId]) return null;
    return {
      targetType: 'team',
      targetId: objectId,
      reason: '该团队具备独立团队级配置',
    };
  }
  if (type === 'member') {
    const member = idx.memberById[objectId];
    if (!member) return null;
    return {
      targetType: 'team',
      targetId: member.team_id,
      reason: '该成员无独立底层配置，编辑将进入所属团队配置',
    };
  }
  if (type === 'agent') {
    const collab = (arch.edges || []).filter((edge) => edge.type === 'standalone_collab' && edge.from === objectId);
    if (!collab.length) {
      return {
        targetType: null,
        targetId: null,
        reason: '当前无独立底层配置，只能查看关联治理/团队信息',
      };
    }
    const best = [...collab].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    return {
      targetType: 'team',
      targetId: best.to,
      reason: '该独立 Agent 无独立底层配置，编辑将进入最近关联团队配置',
    };
  }
  return null;
}

export function getSelectedObjectMeta(): {
  type: string;
  id: string;
  name: string;
  currentTeamId: string | null;
  currentTeamName: string | null;
  editable: { targetType: string | null; targetId: string | null; reason: string } | null;
} | null {
  if (!state.selectedObjectType || !state.selectedObjectId) return null;
  const idx = getArchitectureIndex();
  if (state.selectedObjectType === 'team') {
    const team = idx.teamById[state.selectedObjectId];
    if (!team) return null;
    return {
      type: 'team',
      id: team.team_id,
      name: team.team_name,
      currentTeamId: team.team_id,
      currentTeamName: team.team_name,
      editable: deriveEditableTarget('team', team.team_id),
    };
  }
  if (state.selectedObjectType === 'member') {
    const member = idx.memberById[state.selectedObjectId];
    if (!member) return null;
    return {
      type: 'member',
      id: member.agent_id,
      name: member.name,
      currentTeamId: member.team_id,
      currentTeamName: member.team_name,
      editable: deriveEditableTarget('member', member.agent_id),
    };
  }
  if (state.selectedObjectType === 'agent') {
    const agent = idx.standaloneById[state.selectedObjectId];
    if (!agent) return null;
    const editable = deriveEditableTarget('agent', agent.agent_id);
    const editableTeam = editable?.targetId ? idx.teamById[editable.targetId] : null;
    return {
      type: 'agent',
      id: agent.agent_id,
      name: agent.name,
      currentTeamId: editableTeam?.team_id || null,
      currentTeamName: editableTeam?.team_name || null,
      editable,
    };
  }
  return null;
}

export function syncEditableTargetFromSelection(): { type: string } | null {
  const meta = getSelectedObjectMeta();
  if (!meta) {
    state.selectedTargetType = null;
    state.selectedTargetId = null;
    return null;
  }
  state.selectedTargetType = meta.editable?.targetType || null;
  state.selectedTargetId = meta.editable?.targetId || null;
  return meta;
}

export function selectArchitectureObject(type: string | null, objectId: string | null): void {
  state.selectedObjectType = type || null;
  state.selectedObjectId = objectId || null;
  syncEditableTargetFromSelection();
  callbacks.syncRouteState();
}

export function clearArchitectureSelection(): void {
  state.selectedObjectType = null;
  state.selectedObjectId = null;
  state.selectedTargetType = null;
  state.selectedTargetId = null;
  callbacks.syncRouteState();
}

export function getRelevantConfigGroups(meta: any): string[] {
  if (!meta || !meta.editable?.targetId) return [];
  return ['team-leads', 'team-state-machines', 'patch-from-prompt', 'publish-queue'];
}

export function getTargetTeamLead(targetId: string): any | null {
  return state.teamLeadsDoc?.team_leads?.[targetId] || null;
}

export function getTargetStateMachine(targetId: string): any | null {
  return state.teamStateDoc?.team_state_machines?.[targetId] || null;
}

function markerDefs(svg: SVGElement): void {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrow-main" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 z" fill="#84af99"></path>
    </marker>
    <marker id="arrow-warn" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 z" fill="#b27a37"></path>
    </marker>
    <marker id="arrow-danger" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 z" fill="#b9513f"></path>
    </marker>
  `;
  svg.appendChild(defs);
}

function createStage(width: number, height: number): { inner: HTMLElement; svg: SVGElement } {
  const body = document.getElementById('mainBody');
  if (body) {
    body.innerHTML = `
      <div class="stage-scroll">
        <div class="stage-inner" id="stageInner" style="width:${width}px;height:${height}px;">
          <svg id="edges" viewBox="0 0 ${width} ${height}"></svg>
        </div>
      </div>
    `;
  }
  const inner = document.getElementById('stageInner') as HTMLElement;
  const svg = document.getElementById('edges') as SVGElement;
  markerDefs(svg);
  return { inner, svg };
}

function addNode(inner: HTMLElement, cfg: any): { el: HTMLElement; x: number; y: number; w: number; h: number } {
  const el = document.createElement('div');
  el.className = `node ${cfg.kind || ''} ${cfg.state || ''}`.trim();
  el.style.left = `${cfg.x}px`;
  el.style.top = `${cfg.y}px`;
  el.style.width = `${cfg.w || 190}px`;
  el.style.minHeight = `${cfg.h || 78}px`;
  el.innerHTML = `
    <div class="title">${safe(cfg.title)}</div>
    <div class="sub">${safe(cfg.sub)}</div>
    ${cfg.badge ? `<span class="badge">${safe(cfg.badge)}</span>` : ''}
  `;
  inner.appendChild(el);
  return { el, x: cfg.x, y: cfg.y, w: cfg.w || 190, h: cfg.h || 78 };
}

function drawCurve(svg: SVGElement, from: any, to: any, opts: any = {}): void {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', opts.stroke || '#84af99');
  path.setAttribute('stroke-width', opts.width || '2');
  if (opts.dashed) path.setAttribute('stroke-dasharray', '6 4');
  path.setAttribute('marker-end', `url(#${opts.marker || 'arrow-main'})`);
  svg.appendChild(path);
}

function drawDown(svg: SVGElement, from: any, to: any, opts: any = {}): void {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;
  const midY = y1 + Math.max(16, (y2 - y1) * 0.45);
  const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', opts.stroke || '#84af99');
  path.setAttribute('stroke-width', opts.width || '1.8');
  if (opts.dashed) path.setAttribute('stroke-dasharray', '6 4');
  path.setAttribute('marker-end', `url(#${opts.marker || 'arrow-main'})`);
  svg.appendChild(path);
}

function statusStyle(status: string): { cls: string; label: string } {
  if (status === 'completed') return { cls: 'done', label: '已完成' };
  if (status === 'in_progress') return { cls: 'active', label: '进行中' };
  return { cls: 'pending', label: '待开始' };
}

export function renderFlowMap(): void {
  const detail = state.flowDetail;
  if (!detail || !Array.isArray(detail.steps) || !detail.steps.length) {
    const body = document.getElementById('mainBody');
    if (body) body.innerHTML = '<div class="placeholder">当前流程暂无可渲染步骤。</div>';
    return;
  }

  const steps = detail.steps;
  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(steps.length))));
  const rows = Math.ceil(steps.length / cols);

  const teamFlow = (detail.metadata && Array.isArray(detail.metadata.team_flow)) ? detail.metadata.team_flow : [];
  const laneHeight = teamFlow.length > 0 ? 150 : 20;

  const width = Math.max(980, cols * 270 + 120, teamFlow.length * 210 + 120);
  const height = Math.max(540, rows * 180 + 120 + laneHeight);

  const { inner, svg } = createStage(width, height);
  const nodes: any[] = [];
  const mapByStageName: Record<string, any> = {};

  steps.forEach((step, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const st = statusStyle(step.status);
    const node = addNode(inner, {
      x: 54 + col * 250,
      y: 48 + row * 170,
      w: 216,
      h: 96,
      kind: 'flow',
      state: st.cls,
      title: `${safe(step.step)}. ${safe(step.name)}`,
      sub: `team=${safe(step.team)} · role=${safe(step.owner_role || '-')}`,
      badge: `${st.label} · ${safe(step.owner_agent || '-')}`,
    });
    nodes.push(node);
    mapByStageName[String(step.name || '')] = node;
  });

  for (let i = 0; i < nodes.length - 1; i += 1) {
    const n1 = nodes[i];
    const n2 = nodes[i + 1];
    const sameRow = Math.abs(n1.y - n2.y) < 8;
    if (sameRow) {
      drawCurve(svg, n1, n2, { stroke: '#84af99', marker: 'arrow-main' });
    } else {
      drawDown(svg, n1, n2, { stroke: '#84af99', marker: 'arrow-main' });
    }
  }

  const reworkEdges = detail.rework_edges || [];
  reworkEdges.forEach((e) => {
    const from = mapByStageName[String(e.from || '')];
    const to = mapByStageName[String(e.to || '')];
    if (!from || !to) return;
    drawCurve(svg, from, to, {
      stroke: e.type === 'rework' ? '#b9513f' : '#b27a37',
      marker: e.type === 'rework' ? 'arrow-danger' : 'arrow-warn',
      dashed: true,
      width: '2.1',
    });
  });

  if (teamFlow.length > 0) {
    const laneY = height - 122;
    const laneNodes: any[] = [];
    teamFlow.forEach((team, i) => {
      laneNodes.push(
        addNode(inner, {
          x: 54 + i * 206,
          y: laneY,
          w: 178,
          h: 72,
          kind: 'team-lane',
          title: team,
          sub: 'team_flow',
          badge: i === 0 ? '入口团队' : (i === teamFlow.length - 1 ? '出口团队' : '流转团队'),
        })
      );
    });

    for (let i = 0; i < laneNodes.length - 1; i += 1) {
      drawCurve(svg, laneNodes[i], laneNodes[i + 1], { stroke: '#b27a37', marker: 'arrow-warn', dashed: true });
    }
  }
}

function renderArchitectureMap(): void {
  const arch = state.architecture;
  if (!arch) {
    const body = document.getElementById('mainBody');
    if (body) body.innerHTML = '<div class="placeholder">架构数据加载失败。</div>';
    return;
  }

  const teams = arch.teams || [];
  const standalone = arch.standalone_agents || [];
  const columns = Math.max(teams.length, 1);
  const teamGap = 230;
  const startX = 46;
  const topY = 40;
  const memberGapY = 88;

  const maxVisiblePerTeam = 6;
  const maxMemberRows = Math.max(1, ...teams.map((t) => Math.min(maxVisiblePerTeam, (t.members || []).length + (((t.members || []).length > maxVisiblePerTeam) ? 1 : 0))));

  const width = Math.max(1080, startX * 2 + columns * teamGap + 120);
  const height = Math.max(620, 140 + maxMemberRows * memberGapY + (standalone.length ? 140 : 30));

  const { inner, svg } = createStage(width, height);
  const teamNodes: Record<string, any> = {};
  const standaloneNodes: Record<string, any> = {};

  const makeSelectable = (node: any, type: string, objectId: string) => {
    node.el.classList.add('clickable');
    node.el.dataset.objectType = type;
    node.el.dataset.objectId = objectId;
    if (state.selectedObjectType === type && state.selectedObjectId === objectId) {
      node.el.classList.add('selected');
    }
    node.el.addEventListener('click', () => {
      selectArchitectureObject(type, objectId);
      callbacks.renderAll();
    });
  };

  teams.forEach((team, idx) => {
    const x = startX + idx * teamGap;
    const teamNode = addNode(inner, {
      x,
      y: topY,
      w: 198,
      h: 76,
      kind: 'team',
      title: team.team_name,
      sub: team.team_id,
      badge: `成员 ${team.members ? team.members.length : 0}`,
    });
    teamNodes[team.team_id] = teamNode;
    makeSelectable(teamNode, 'team', team.team_id);

    const members = team.members || [];
    const visible = members.slice(0, maxVisiblePerTeam);
    const overflow = members.length - visible.length;

    visible.forEach((m, i) => {
      const mNode = addNode(inner, {
        x,
        y: topY + 102 + i * memberGapY,
        w: 198,
        h: 74,
        title: m.name,
        sub: `${m.agent_id} · ${safe(m.health?.status || '-')}`,
        badge: m.model || m.primary_model || 'unknown',
      });
      makeSelectable(mNode, 'member', m.agent_id);
      drawDown(svg, teamNode, mNode, { stroke: '#8bad9a' });
    });

    if (overflow > 0) {
      const extraNode = addNode(inner, {
        x,
        y: topY + 102 + visible.length * memberGapY,
        w: 198,
        h: 64,
        title: `+${overflow} 个成员未展开`,
        sub: team.team_id,
        badge: '聚合显示',
      });
      drawDown(svg, teamNode, extraNode, { stroke: '#8bad9a', dashed: true });
    }
  });

  const businessEdges = (arch.edges || []).filter((e) => e.type === 'business_flow');
  businessEdges.forEach((edge) => {
    const from = teamNodes[edge.from];
    const to = teamNodes[edge.to];
    if (!from || !to) return;
    drawCurve(svg, from, to, { stroke: '#b27a37', marker: 'arrow-warn', dashed: true, width: '2.1' });
  });

  if (standalone.length) {
    const rowY = height - 98;
    const maxStandalone = 8;
    const visible = standalone.slice(0, maxStandalone);
    visible.forEach((a, i) => {
      const node = addNode(inner, {
        x: startX + i * 124,
        y: rowY,
        w: 118,
        h: 64,
        title: a.name,
        sub: a.agent_id,
        badge: '独立',
      });
      standaloneNodes[a.agent_id] = node;
      makeSelectable(node, 'agent', a.agent_id);
    });

    if (standalone.length > maxStandalone) {
      addNode(inner, {
        x: startX + maxStandalone * 124,
        y: rowY,
        w: 124,
        h: 64,
        title: `+${standalone.length - maxStandalone}`,
        sub: 'standalone',
        badge: '更多独立Agent',
      });
    }
  }

  const collabEdges = (arch.edges || []).filter((e) => e.type === 'standalone_collab');
  collabEdges.forEach((edge) => {
    const from = standaloneNodes[edge.from];
    const to = teamNodes[edge.to];
    if (!from || !to) return;
    drawCurve(svg, from, to, { stroke: '#2e6f9a', marker: 'arrow-main', dashed: true, width: '2' });
  });

  renderArchitectureContext();
}

function renderArchitectureContext(): void {
  const contextPanel = document.getElementById('contextPanel');
  const flowList = document.getElementById('flowList');
  const flowContext = document.getElementById('flowContext');
  const contextTitle = document.getElementById('contextTitle');
  const contextMeta = document.getElementById('contextMeta');
  if (!contextPanel || !flowList || !flowContext || !contextTitle || !contextMeta) return;
  contextPanel.style.display = '';
  flowList.style.display = 'block';
  flowList.innerHTML = '<div class="object-list-note">点击架构关系图中的团队、成员或独立 Agent，先看对象详情，再决定是否进入治理或配置。</div>';
  contextTitle.textContent = '对象详情';
  contextMeta.textContent = '从架构关系图选择对象后，这里会说明你点的是谁、实际会改谁、会影响什么。';

  const meta = getSelectedObjectMeta();
  if (!meta) {
    flowContext.innerHTML = `
      <section class="card">
        <h4>未选中对象</h4>
        <div style="font-size:13px;color:var(--muted);line-height:1.6;">请先从左侧架构关系图选择一个团队、成员或独立 Agent。系统会先展示对象详情，再决定是否进入治理或高级配置。</div>
      </section>
    `;
    return;
  }

  const targetTeam = meta.editable?.targetId ? getArchitectureIndex().teamById[meta.editable.targetId] : null;
  const categories = getRelevantConfigGroups(meta);
  const categoryLabels: Record<string, string> = {
    'team-leads': '团队负责人',
    'team-state-machines': '团队流程状态机',
    'patch-from-prompt': '治理提示词补丁',
    'publish-queue': '发布队列',
  };
  flowContext.innerHTML = `
    <section class="card">
      <h4>${safe(meta.name)}</h4>
      <div class="object-kv">
        <div class="k">对象类型</div><div>${objectTypeLabel(meta.type)}</div>
        <div class="k">对象 ID</div><div class="mono">${safe(meta.id)}</div>
        <div class="k">当前归属</div><div>${safe(meta.currentTeamName || meta.currentTeamId || '未归属')}</div>
        <div class="k">当前可编辑对象</div><div>${targetTeam ? `${safe(targetTeam.team_name)}（${safe(targetTeam.team_id)}）` : '当前无独立底层配置'}</div>
        <div class="k">影响配置</div><div>${categories.length ? categories.map((key) => categoryLabels[key]).join('、') : '当前仅支持查看说明'}</div>
      </div>
    </section>
    <section class="card">
      <h4>编辑落点说明</h4>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;">${safe(meta.editable?.reason || '当前对象没有可编辑的底层配置。')}</div>
    </section>
    <section class="card">
      <h4>操作入口</h4>
      <div class="row-actions">
        <button class="btn" id="openGovernanceFromObjectBtn">查看治理状态</button>
        ${meta.editable?.targetId ? '<button class="btn primary" id="openAdvancedFromObjectBtn">进入配置</button>' : ''}
      </div>
    </section>
  `;

  document.getElementById('openGovernanceFromObjectBtn')?.addEventListener('click', () => {
    state.view = 'governance';
    state.governanceView = 'change';
    callbacks.syncRouteState();
    callbacks.renderAll();
  });
  document.getElementById('openAdvancedFromObjectBtn')?.addEventListener('click', () => {
    state.view = 'advanced-config';
    state.advancedConfigMode = 'workflow-designer';
    callbacks.syncRouteState();
    callbacks.renderAll();
  });
}

export function renderArchitecture(): void {
  renderArchitectureMap();
}
