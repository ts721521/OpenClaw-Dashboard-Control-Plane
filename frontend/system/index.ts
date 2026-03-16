// @ts-nocheck
import { state, safe } from './state';
import { fetchJSON, postJSON } from './actions';
import { renderUpdatedAt } from './render';
import {
  bindArchitectureCallbacks,
  clearArchitectureSelection,
  getSelectedObjectMeta,
  renderArchitecture,
  syncEditableTargetFromSelection,
} from './architecture';
import {
  bindGovernanceCallbacks,
  loadGovernance,
  loadReviewDetail,
  renderChangeDetail,
  renderGovernance,
} from './governance';
import {
  bindAdvancedConfigCallbacks,
  loadConfigDocs,
  renderAdvancedConfig,
} from './advanced_config';

(window as any).__SYSTEM_DASHBOARD_BOOTSTRAP__ = true;

    function fmtTime(v) {
      return new Date(v || Date.now()).toLocaleString('zh-CN');
    }

    function renderMainPanel() {
      const title = document.getElementById('mainTitle');
      const contextPanel = document.getElementById('contextPanel');
      const contextTitle = document.getElementById('contextTitle');
      const contextMeta = document.getElementById('contextMeta');
      const mainGrid = document.getElementById('mainGrid');
      if (state.view === 'architecture-map') {
        if (contextPanel) contextPanel.style.display = '';
        if (contextTitle) contextTitle.textContent = '对象详情';
        if (contextMeta) contextMeta.textContent = '先从架构关系图选择团队或角色';
        if (mainGrid) mainGrid.classList.remove('grid--full');
        title.textContent = '系统架构关系图';
        renderArchitecture();
      } else if (state.view === 'governance') {
        renderGovernance();
      } else if (state.view === 'advanced-config') {
        renderAdvancedConfig();
      }
    }

    function flowTypeLabel(t) {
      return t === 'team' ? '团队流程' : '任务流程';
    }

    function renderFlowList() {
      const root = document.getElementById('flowList');
      const list = state.flows || [];
      if (!list.length) {
        root.innerHTML = '<div class="placeholder" style="margin:0;">暂无流程列表数据。</div>';
        return;
      }

      root.innerHTML = list.map((f) => `
        <article class="flow-item ${state.selectedFlowId === f.flow_id ? 'active' : ''}" data-id="${f.flow_id}">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
            <div class="t">${safe(f.flow_name)}</div>
            <span class="chip">${flowTypeLabel(f.flow_type)}</span>
          </div>
          <div class="d">${safe(f.description)}</div>
          <div class="m">stages=${safe(f.stages)} · teams=${safe((f.teams_involved || []).join(','))}</div>
        </article>
      `).join('');

      root.querySelectorAll('.flow-item').forEach((el) => {
        el.addEventListener('click', async () => {
          const fid = el.dataset.id;
          if (!fid || fid === state.selectedFlowId) return;
          state.selectedFlowId = fid;
          await loadFlowDetail();
          renderAll();
        });
      });
    }

    function renderFlowContext() {
      const root = document.getElementById('flowContext');
      const detail = state.flowDetail;
      const arch = state.architecture || {};

      const business = (arch.edges || []).filter((e) => e.type === 'business_flow');
      const collab = (arch.edges || []).filter((e) => e.type === 'standalone_collab');
      const tableRows = business.length
        ? business.map((e) => `<tr><td class="mono">${safe(e.from)}</td><td class="mono">${safe(e.to)}</td><td>${safe(e.count)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="mono">暂无跨团队关系</td></tr>';
      const collabRows = collab.length
        ? collab.map((e) => `<tr><td class="mono">${safe(e.from)}</td><td class="mono">${safe(e.to)}</td><td>${safe(e.count)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="mono">暂无独立 Agent 协作关系</td></tr>';

      if (!detail) {
        root.innerHTML = '<div class="card"><h4>当前流程</h4><div class="mono">未选中</div></div>';
        return;
      }

      root.innerHTML = `
        <section class="card">
          <h4>当前流程</h4>
          <div style="font-weight:800;font-size:13px;line-height:1.35;">${safe(detail.flow_name)}</div>
          <div class="mono" style="margin-top:6px;">${safe(detail.flow_id)} · ${safe(detail.flow_type)}</div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <span class="chip">steps ${safe((detail.steps || []).length)}</span>
            <span class="chip">owner ${safe(detail.metadata?.owner || '-')}</span>
            <span class="chip">progress ${safe(detail.metadata?.progress ?? '-')}%</span>
          </div>
        </section>

        <section class="card">
          <h4>团队流转链路</h4>
          <div class="mono">${safe((detail.metadata?.team_flow || []).join(' -> ') || '无团队流转')}</div>
        </section>

        <section class="card">
          <h4>系统架构跨团队关系</h4>
          <table class="link-table">
            <thead><tr><th>来源团队</th><th>目标团队</th><th>次数</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </section>

        <section class="card">
          <h4>独立 Agent 与团队关系</h4>
          <table class="link-table">
            <thead><tr><th>独立Agent</th><th>团队</th><th>次数</th></tr></thead>
            <tbody>${collabRows}</tbody>
          </table>
        </section>
      `;
    }

    function renderSidebarStats() {
      const teams = state.architecture?.teams || [];
      const flows = state.flows || [];
      const side = document.getElementById('sideStats');
      side.innerHTML = `
        <div class="side-stat"><div class="n">${teams.length}</div><div class="l">团队总数</div></div>
        <div class="side-stat"><div class="n">${flows.length}</div><div class="l">流程总数</div></div>
        <div class="side-stat"><div class="n" style="font-size:13px;line-height:1.3;color:#32463b;">${fmtTime(state.updatedAt)}</div><div class="l">实时更新时间</div></div>
        <div class="side-stat"><div class="n" style="font-size:13px;line-height:1.3;color:#32463b;">${safe(state.runtimeVersions?.workflow_version || '-')} / ${safe(state.runtimeVersions?.routing_version || '-')}</div><div class="l">规则版本</div></div>
      `;
    }

    function renderTabs() {
      document.querySelectorAll('.tab[data-view]').forEach((tab) => {
        if (tab.dataset.view === state.view) tab.classList.add('active');
        else tab.classList.remove('active');
      });
    }

    function renderAll() {
      renderTabs();
      renderSidebarStats();
      renderMainPanel();
      renderUpdatedAt(document.getElementById('updatedAt'), state.updatedAt);
    }

    async function loadFlowDetail() {
      if (!state.selectedFlowId) {
        state.flowDetail = null;
        return;
      }
      const detail = await fetchJSON(`/api/flow/detail?flow_id=${encodeURIComponent(state.selectedFlowId)}`);
      state.flowDetail = detail.error ? null : detail;
    }

    function applyRouteFromQuery() {
      const params = new URLSearchParams(window.location.search);
      const subview = params.get('subview');
      const governance = params.get('governance');
      const reviewId = params.get('review_id');
      const changeId = params.get('change_id');
      const objectType = params.get('object_type');
      const objectId = params.get('object_id');
      const targetType = params.get('target_type');
      const targetId = params.get('target_id');
      const mode = params.get('mode');
      state.selectedObjectType = objectType || null;
      state.selectedObjectId = objectId || null;
      state.selectedTargetType = targetType || null;
      state.selectedTargetId = targetId || null;
      state.advancedConfigMode = mode || 'workflow-designer';
      if (subview === 'advanced-config') {
        state.view = 'advanced-config';
        return;
      }
      if (subview === 'architecture') {
        state.view = 'architecture-map';
        return;
      }
      if (subview === 'governance' && !governance) {
        state.view = 'governance';
        state.governanceView = 'change';
        return;
      }
      if (governance === 'review') {
        state.view = 'governance';
        state.governanceView = 'review';
        if (reviewId) state.selectedReviewId = reviewId;
      } else if (governance === 'change') {
        state.view = 'governance';
        state.governanceView = 'change';
        if (changeId) state.selectedChangeId = changeId;
      } else if (governance === 'recovery') {
        state.view = 'governance';
        state.governanceView = 'recovery';
      }
    }

    function syncRouteState() {
      const url = new URL(window.location.href);
      if (state.view === 'architecture-map') {
        url.searchParams.set('subview', 'architecture');
        url.searchParams.delete('governance');
        url.searchParams.delete('review_id');
        url.searchParams.delete('change_id');
        if (state.selectedObjectType && state.selectedObjectId) {
          url.searchParams.set('object_type', state.selectedObjectType);
          url.searchParams.set('object_id', state.selectedObjectId);
        } else {
          url.searchParams.delete('object_type');
          url.searchParams.delete('object_id');
        }
        url.searchParams.delete('target_type');
        url.searchParams.delete('target_id');
      } else if (state.view === 'advanced-config') {
        url.searchParams.set('subview', 'advanced-config');
        url.searchParams.set('mode', state.advancedConfigMode || 'workflow-designer');
        url.searchParams.delete('governance');
        url.searchParams.delete('review_id');
        url.searchParams.delete('change_id');
        if (state.selectedObjectType && state.selectedObjectId) {
          url.searchParams.set('object_type', state.selectedObjectType);
          url.searchParams.set('object_id', state.selectedObjectId);
        } else {
          url.searchParams.delete('object_type');
          url.searchParams.delete('object_id');
        }
        if (state.selectedTargetType && state.selectedTargetId) {
          url.searchParams.set('target_type', state.selectedTargetType);
          url.searchParams.set('target_id', state.selectedTargetId);
        } else {
          url.searchParams.delete('target_type');
          url.searchParams.delete('target_id');
        }
      } else if (state.view === 'governance' && state.governanceView === 'review') {
        url.searchParams.set('subview', 'governance');
        url.searchParams.set('governance', 'review');
        if (state.selectedReviewId) url.searchParams.set('review_id', state.selectedReviewId);
        else url.searchParams.delete('review_id');
        url.searchParams.delete('change_id');
        url.searchParams.delete('object_type');
        url.searchParams.delete('object_id');
        url.searchParams.delete('target_type');
        url.searchParams.delete('target_id');
        url.searchParams.delete('mode');
      } else if (state.view === 'governance' && state.governanceView === 'change') {
        url.searchParams.set('subview', 'governance');
        url.searchParams.set('governance', 'change');
        if (state.selectedChangeId) url.searchParams.set('change_id', state.selectedChangeId);
        else url.searchParams.delete('change_id');
        url.searchParams.delete('review_id');
        url.searchParams.delete('object_type');
        url.searchParams.delete('object_id');
        url.searchParams.delete('target_type');
        url.searchParams.delete('target_id');
        url.searchParams.delete('mode');
      } else if (state.view === 'governance' && state.governanceView === 'recovery') {
        url.searchParams.set('subview', 'governance');
        url.searchParams.set('governance', 'recovery');
        url.searchParams.delete('review_id');
        url.searchParams.delete('change_id');
        url.searchParams.delete('object_type');
        url.searchParams.delete('object_id');
        url.searchParams.delete('target_type');
        url.searchParams.delete('target_id');
        url.searchParams.delete('mode');
      } else {
        url.searchParams.set('subview', 'architecture');
        url.searchParams.delete('governance');
        url.searchParams.delete('review_id');
        url.searchParams.delete('change_id');
        url.searchParams.delete('object_type');
        url.searchParams.delete('object_id');
        url.searchParams.delete('target_type');
        url.searchParams.delete('target_id');
        url.searchParams.delete('mode');
      }
      window.history.replaceState({}, '', url);
    }

    bindArchitectureCallbacks({ syncRouteState, renderAll });

    async function loadAllData() {
      const [archRes, flowRes] = await Promise.all([
        fetchJSON('/api/architecture'),
        fetchJSON('/api/flows'),
      ]);

      state.architecture = archRes;
      state.flows = flowRes.flows || [];
      state.updatedAt = archRes.updated_at || flowRes.updated_at || Date.now();

      if (!state.selectedFlowId || !state.flows.some((f) => f.flow_id === state.selectedFlowId)) {
        state.selectedFlowId = state.flows.length ? state.flows[0].flow_id : null;
      }

      if (state.selectedObjectType && state.selectedObjectId) {
        const meta = getSelectedObjectMeta();
        if (!meta) clearArchitectureSelection();
        else syncEditableTargetFromSelection();
      }

      await Promise.all([loadFlowDetail(), loadConfigDocs()]);
    }

    bindGovernanceCallbacks({ loadConfigDocs, loadAllData, renderAll, syncRouteState });
    bindAdvancedConfigCallbacks({ loadGovernance, loadAllData, renderAll, syncRouteState });

    async function refresh() {
      await loadAllData();
      renderAll();
    }

    document.getElementById('refreshBtn').addEventListener('click', async () => {
      try {
        await refresh();
      } catch (err) {
        alert(`刷新失败: ${err.message}`);
      }
    });

    document.querySelectorAll('.tab[data-view]').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.view = tab.dataset.view;
        if (state.view === 'governance' && !state.governanceView) state.governanceView = 'change';
        syncRouteState();
        renderAll();
      });
    });

    window.addEventListener('resize', () => {
      if (state.architecture) renderMainPanel();
    });

    (async () => {
      try {
        applyRouteFromQuery();
        await refresh();
        applyRouteFromQuery();
        if (state.selectedReviewId) await loadReviewDetail(state.selectedReviewId);
        if (state.selectedChangeId) await renderChangeDetail(state.selectedChangeId);
        applyRouteFromQuery();
        syncRouteState();
        renderAll();
        setInterval(async () => {
          try { await refresh(); } catch (_) {}
        }, 20000);
      } catch (err) {
        console.error(err);
        document.getElementById('mainBody').innerHTML = `<div class="placeholder">页面加载失败：${safe(err.message)}</div>`;
      }
    })();
