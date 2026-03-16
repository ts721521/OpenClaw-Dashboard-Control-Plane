// @ts-nocheck
import { state, safe } from './state';
import { fetchJSON, postJSON } from './actions';
import { renderUpdatedAt } from './render';
import {
  bindArchitectureCallbacks,
  clearArchitectureSelection,
  getArchitectureIndex,
  getRelevantConfigGroups,
  getSelectedObjectMeta,
  getTargetTeamLead,
  getTargetStateMachine,
  renderArchitecture,
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

(window as any).__SYSTEM_DASHBOARD_BOOTSTRAP__ = true;
    function buildWorkflowGraph(targetId) {
      return buildWorkflowGraphModel(state.teamStateDoc, targetId);
    }

    function ensureWorkflowGraph(targetId) {
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

    function getSelectedWorkflowNode() {
      return state.workflowGraph?.nodes?.find((node) => node.id === state.selectedWorkflowNodeId) || null;
    }

    function getSelectedWorkflowEdge() {
      return state.workflowGraph?.edges?.find((edge) => edge.key === state.selectedWorkflowEdgeKey) || null;
    }

    function serializeWorkflowGraph(targetId, graph) {
      return serializeWorkflowGraphModel(state.teamStateDoc, targetId, graph);
    }

    function queueWorkflowDoc(doc, targetId) {
      state.pendingChanges['team-state-machines'] = {
        target: 'team-state-machines',
        doc,
        desc: `${targetId} 团队流程设计器`,
      };
    }
    async function putJSON(path, payload) {
      const res = await fetch(`${API}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }

    function fmtTime(v) {
      return new Date(v || Date.now()).toLocaleString('zh-CN');
    }


    function renderGovernance() {
      document.getElementById('mainTitle').textContent = '治理中心';
      const cp = document.getElementById('contextPanel');
      if (cp) cp.style.display = 'none';
      const mg = document.getElementById('mainGrid');
      if (mg) mg.classList.add('grid--full');

      const changes = state.changeTasks || [];
      const reviews = state.reviewTasks || [];
      const detail = state.reviewDetail;
      const governanceView = state.governanceView || 'change';
      const showChange = governanceView === 'change';
      const showReview = governanceView === 'review';
      const showRecovery = governanceView === 'recovery';
      const recoveryItems = reviews.filter((item) => item.review_pool === 'recovery_pool' || item.reclaim_eligible);

      document.getElementById('mainBody').innerHTML = `
        <div class="governance">
          <section class="editor-card" style="margin-bottom:12px;">
            <h4>治理中心</h4>
            <div style="font-size:13px;color:var(--muted);line-height:1.6;">这里处理日常治理动作：看变更、做审查、处理恢复。底层规则编辑已移到「高级配置」。</div>
          </section>

          <div class="row-actions" style="margin-bottom:8px;">
            <button class="btn ${showChange ? 'primary' : ''}" id="governanceChangeTab">变更</button>
            <button class="btn ${showReview ? 'primary' : ''}" id="governanceReviewTab">审查</button>
            <button class="btn ${showRecovery ? 'primary' : ''}" id="governanceRecoveryTab">恢复</button>
          </div>

          ${showChange ? `
          <section class="editor-card">
            <h4>变更</h4>
            <div class="mono" style="margin-bottom:8px;">workflow=${safe(state.runtimeVersions?.workflow_version || '-')} · routing=${safe(state.runtimeVersions?.routing_version || '-')}</div>
            <textarea id="changeTaskInput" placeholder="例如：统一 review gate 字段；调整共享状态机入口"></textarea>
            <input id="changeImpactTargetsInput" type="text" placeholder="影响范围，使用分号分隔，例如：task_dashboard;system_dashboard" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
            <input id="changeAtRiskTasksInput" type="text" placeholder="风险任务，使用分号分隔，可选" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
            <input id="changeRollbackInput" type="text" placeholder="回滚计划，可选" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
            <div class="row-actions">
              <button class="btn primary" id="createChangeTaskBtn">发起变更</button>
            </div>
            ${changes.length ? `
              <ul class="queue-list">
                ${changes.slice(0, 12).map(item => `
                  <li>
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
                      <button class="btn" data-open-change="${safe(item.change_id)}" style="text-align:left;justify-content:flex-start;flex:1;">
                        ${safe(item.title)} · ${safe(item.scope)} · ${safe(item.status)}
                      </button>
                      <span class="mono">${safe(item.change_id)}</span>
                    </div>
                    <div class="mono" style="margin-top:6px;">影响=${safe((item.impact_targets || []).join(', ') || '-')}</div>
                    <div class="mono" style="margin-top:6px;">风险任务=${safe((item.at_risk_tasks || []).join(', ') || '-')}</div>
                    <div class="row-actions" style="margin-top:6px;">
                      <a href="task_dashboard.html${(item.at_risk_tasks || []).length ? `?task_id=${encodeURIComponent(item.at_risk_tasks[0])}` : '?pool=governance_pool'}" class="inline-link" target="_blank" rel="noopener">查看关联任务</a>
                    </div>
                  </li>
                `).join('')}
              </ul>
            ` : '<div class="warn-text">暂无变更任务。</div>'}
          </section>

          <section class="editor-card" id="changeDetailSection">
            <h4>变更详情与发布审计</h4>
            <div id="changeDetailPanel" class="change-detail-inner">点击上方变更任务加载详情。</div>
          </section>
          ` : ''}

          ${showReview ? `
          <section class="editor-card">
            <h4>审查</h4>
            <div class="mono" style="margin-bottom:8px;">active=${reviews.filter(item => item.status !== 'completed').length} · recovery=${reviews.filter(item => item.review_pool === 'recovery_pool').length}</div>
            <input id="reviewTitleInput" type="text" placeholder="审查标题，例如：研发流程 gate 审查" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
            <input id="reviewIncidentInput" type="text" placeholder="incident key，例如：INC-GOV-002" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
            <textarea id="reviewSummaryInput" placeholder="审查材料摘要，例如：需要验证共享规则变更是否会漏掉下游 handoff。"></textarea>
            <div class="row-actions">
              <button class="btn primary" id="createReviewTaskBtn">发起审查</button>
            </div>
            ${reviews.length ? `
              <ul class="queue-list">
                ${reviews.slice(0, 8).map(item => `
                  <li>
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                      <button class="btn" data-open-review="${safe(item.review_id)}" style="text-align:left;justify-content:flex-start;flex:1;">
                        ${safe(item.title)} · ${safe(item.status)} · ${safe(item.review_pool)}
                      </button>
                      <span class="mono">${safe(item.review_id)}</span>
                    </div>
                    <div class="mono" style="margin-top:6px;">负责人=${safe(item.assigned_to || '-')} · incident=${safe(item.incident_key || '-')}</div>
                    <div class="mono" style="margin-top:6px;">chief=${safe(item.chief_status || '-')} · 缺失=${safe((item.packet_missing || []).join(', ') || '-')}</div>
                    <div class="mono" style="margin-top:6px;">席位=${safe(Object.entries(item.seat_status || {}).map(([k, v]) => `${k}:${v}`).join(' | ') || '-')}</div>
                    <div class="row-actions" style="margin-top:6px;">
                      <button class="btn" data-dispatch-review="${safe(item.review_id)}" data-reviewer="braintrust_architect">指派 architect</button>
                      <button class="btn" data-dispatch-review="${safe(item.review_id)}" data-reviewer="braintrust_critic">指派 critic</button>
                      <button class="btn" data-dispatch-review="${safe(item.review_id)}" data-reviewer="braintrust_innovator">指派 innovator</button>
                      <button class="btn warn" data-reclaim-review="${safe(item.review_id)}">恢复接管</button>
                    </div>
                    ${item.chief_decision ? `<div class="mono" style="margin-top:6px;">chief=${safe(item.chief_decision.decision)} -> ${safe(item.chief_decision.next_owner || '-')}</div>` : ''}
                  </li>
                `).join('')}
              </ul>
            ` : '<div class="warn-text">暂无审查任务。</div>'}
          </section>

          <section class="editor-card">
            <h4>审查详情</h4>
            ${detail ? `
              <div class="mono" style="margin-bottom:8px;">${safe(detail.review_id)} · ${safe(detail.status)} · ${safe(detail.review_pool)}</div>
              <div style="font-weight:700;margin-bottom:6px;">${safe(detail.title)}</div>
              <div style="font-size:13px;color:var(--muted);margin-bottom:10px;">${safe(detail.submission_bundle?.summary || '-')}</div>
              <div class="status-grid">
                <div class="status-card">
                  <div class="label">incident / 负责人</div>
                  <div class="value mono">${safe(detail.incident_key || detail.submission_bundle?.incident_key || '-')} · ${safe(detail.assigned_to || '-')}</div>
                </div>
                <div class="status-card">
                  <div class="label">chief / 可恢复</div>
                  <div class="value mono">${safe(detail.chief_status || '-')} · ${safe(detail.reclaim_eligible ? 'yes' : 'no')}</div>
                </div>
                <div class="status-card">
                  <div class="label">缺失 packet</div>
                  <div class="value mono">${safe((detail.packet_missing || []).join(', ') || '-')}</div>
                </div>
                <div class="status-card">
                  <div class="label">席位状态</div>
                  <div class="value mono">${safe(Object.entries(detail.seat_status || {}).map(([k, v]) => `${k}:${v}`).join(' | ') || '-')}</div>
                </div>
              </div>
              <div class="row-actions" style="margin-bottom:10px;">
                <a href="task_dashboard.html${(detail.target_task_id || detail.submission_bundle?.target_task_id) ? `?task_id=${encodeURIComponent(detail.target_task_id || detail.submission_bundle?.target_task_id)}` : '?pool=review_pool'}" class="btn" target="_blank" rel="noopener">在任务中心查看</a>
              </div>
              <details class="collapsible-section" open>
                <summary>Reviewer Packets</summary>
              <div style="margin-top:6px;">
              ${(detail.review_packets || []).length ? `
                <ul class="queue-list">
                  ${(detail.review_packets || []).map(packet => `
                    <li>
                      <div style="display:flex;justify-content:space-between;gap:8px;"><span>${safe(packet.reviewer_id)} · ${safe(packet.verdict || '-')}</span><span class="mono">${safe(packet.provider || '-')}</span></div>
                      <div class="mono" style="margin-top:6px;">findings=${safe((packet.findings || []).join('; ') || '-')}</div>
                    </li>
                  `).join('')}
                </ul>
              ` : '<div class="warn-text">暂无 reviewer packet。</div>'}
              </div>
              </details>
              <details class="collapsible-section">
                <summary>提交 reviewer packet</summary>
              <div style="margin-top:6px;">
              <input id="packetReviewerInput" type="text" value="${safe(detail.assigned_to || 'braintrust_architect')}" placeholder="reviewer id" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
              <input id="packetVerdictInput" type="text" value="approved" placeholder="packet verdict" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
              <textarea id="packetFindingsInput" placeholder="findings，使用分号分隔"></textarea>
              <div class="row-actions">
                <button class="btn" data-packet-preset="architect">用 architect 模板</button>
                <button class="btn" data-packet-preset="critic">用 critic 模板</button>
                <button class="btn" data-packet-preset="innovator">用 innovator 模板</button>
                <button class="btn primary" data-preset-submit="architect">architect 模板并提交</button>
                <button class="btn primary" data-preset-submit="critic">critic 模板并提交</button>
                <button class="btn primary" data-preset-submit="innovator">innovator 模板并提交</button>
              </div>
              <div class="row-actions">
                <button class="btn" id="submitPacketBtn">提交 reviewer packet</button>
              </div>
              </div>
              </details>
              <details class="collapsible-section">
                <summary>Chief Decision</summary>
              <div style="margin-top:6px;">
              ${detail.chief_decision ? `
                <div class="mono" style="margin-bottom:10px;">${safe(detail.chief_decision.decision)} -> ${safe(detail.chief_decision.next_owner || '-')} · ${safe(detail.chief_decision.next_action || '-')}</div>
              ` : '<div class="warn-text">尚未提交 chief decision。</div>'}
              <input id="chiefNextOwnerInput" type="text" value="${safe(detail.chief_decision?.next_owner || 'rd_lead')}" placeholder="next owner" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
              <input id="chiefNextActionInput" type="text" value="${safe(detail.chief_decision?.next_action || 'return_to_rd')}" placeholder="next action" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.85);font:inherit;margin-bottom:8px;" />
              <div class="row-actions">
                <button class="btn primary" data-chief-decision="approved">提交裁决：approved</button>
                <button class="btn warn" data-chief-decision="needs_rework">提交裁决：needs_rework</button>
              </div>
              </div>
              </details>
            ` : '<div class="warn-text">点击上面的审查任务查看详情并提交裁决。</div>'}
          </section>
          ` : ''}

          ${showRecovery ? `
          <section class="editor-card">
            <h4>恢复</h4>
            <div style="font-size:13px;color:var(--muted);margin-bottom:10px;line-height:1.6;">这里集中看停滞对象、可接管对象和恢复建议。恢复动作不会改底层规则，只处理当前卡住的治理对象。</div>
            <div class="row-actions" style="margin-bottom:10px;">
              <button class="btn primary" id="scanRecoveryViewBtn">扫描停滞对象</button>
            </div>
            ${state.recoveryScan ? `<div class="mono" style="margin-bottom:10px;">最近扫描：${safe((state.recoveryScan.stalled_reviews || []).length)} 个停滞对象</div>` : '<div class="warn-text">尚未执行扫描。点击上方按钮刷新恢复对象。</div>'}
            ${recoveryItems.length ? `
              <ul class="queue-list">
                ${recoveryItems.map(item => {
                  const missing = (item.packet_missing || []).join(', ') || '-';
                  const suggestion = item.packet_missing?.length
                    ? `建议：补齐 ${missing} 后再继续`
                    : item.chief_status === 'pending'
                      ? '建议：等待 chief 裁决或人工接管'
                      : '建议：由 LuBan 恢复接管并重新派发';
                  return `
                    <li>
                      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
                        <button class="btn" data-open-review="${safe(item.review_id)}" style="text-align:left;justify-content:flex-start;flex:1;">
                          ${safe(item.title)} · ${safe(item.status)} · ${safe(item.review_pool)}
                        </button>
                        <span class="mono">${safe(item.review_id)}</span>
                      </div>
                      <div class="mono" style="margin-top:6px;">缺失=${safe(missing)} · chief=${safe(item.chief_status || '-')} · 可接管=${safe(item.reclaim_eligible ? 'yes' : 'no')}</div>
                      <div style="margin-top:6px;font-size:13px;color:var(--muted);">${safe(suggestion)}</div>
                      <div class="row-actions" style="margin-top:6px;">
                        <button class="btn warn" data-reclaim-review="${safe(item.review_id)}">执行恢复接管</button>
                        <a href="task_dashboard.html${(item.target_task_id || item.submission_bundle?.target_task_id) ? `?task_id=${encodeURIComponent(item.target_task_id || item.submission_bundle?.target_task_id)}` : '?pool=recovery_pool'}" class="inline-link" target="_blank" rel="noopener">查看关联任务</a>
                      </div>
                    </li>
                  `;
                }).join('')}
              </ul>
            ` : '<div class="warn-text">当前没有需要恢复接管的治理对象。</div>'}
          </section>
          ` : ''}
        </div>
      `;

      document.getElementById('governanceChangeTab')?.addEventListener('click', () => {
        state.governanceView = 'change';
        syncRouteState();
        renderGovernance();
      });

      document.getElementById('governanceReviewTab')?.addEventListener('click', () => {
        state.governanceView = 'review';
        syncRouteState();
        renderGovernance();
      });

      document.getElementById('governanceRecoveryTab')?.addEventListener('click', () => {
        state.governanceView = 'recovery';
        syncRouteState();
        renderGovernance();
      });

      document.getElementById('createChangeTaskBtn')?.addEventListener('click', async () => {
        try {
          const desc = document.getElementById('changeTaskInput').value.trim();
          const impactTargets = (document.getElementById('changeImpactTargetsInput')?.value || '').split(';').map((item) => item.trim()).filter(Boolean);
          const atRiskTasks = (document.getElementById('changeAtRiskTasksInput')?.value || '').split(';').map((item) => item.trim()).filter(Boolean);
          const rollbackPlan = document.getElementById('changeRollbackInput')?.value?.trim() || '';
          if (!desc) {
            alert('请输入变更描述');
            return;
          }
          const res = await postJSON('/api/change-tasks', {
            title: desc,
            description: desc,
            scope: 'shared',
            impact_targets: impactTargets,
            at_risk_tasks: atRiskTasks,
            rollback_plan: rollbackPlan,
            actor_id: 'luban',
            actor_role: 'admin',
          });
          if (!res.ok) throw new Error(res.error || '创建失败');
          await loadConfigDocs();
          state.selectedChangeId = res.change_id || state.selectedChangeId;
          state.governanceView = 'change';
          syncRouteState();
          renderGovernance();
        } catch (e) {
          alert(`创建失败: ${e.message}`);
        }
      });

      document.querySelectorAll('[data-open-change]').forEach((el) => {
        el.addEventListener('click', async () => {
          const changeId = el.dataset.openChange;
          if (!changeId) return;
          state.selectedChangeId = changeId;
          state.governanceView = 'change';
          syncRouteState();
          await renderChangeDetail(changeId);
          renderGovernance();
        });
      });

      document.getElementById('createReviewTaskBtn')?.addEventListener('click', async () => {
        try {
          const title = document.getElementById('reviewTitleInput').value.trim();
          const incidentKey = document.getElementById('reviewIncidentInput').value.trim();
          const summary = document.getElementById('reviewSummaryInput').value.trim();
          if (!title || !incidentKey || !summary) {
            alert('请填写审查标题、incident key 和摘要');
            return;
          }
          const res = await postJSON('/api/reviews', {
            title,
            submission_bundle: {
              incident_key: incidentKey,
              summary,
              artifacts: [{ path: `/tmp/${incidentKey}.md` }],
            },
            actor_id: 'main',
            actor_role: 'admin',
          });
          if (!res.ok) throw new Error(res.error || '创建失败');
          await loadConfigDocs();
          renderGovernance();
        } catch (e) {
          alert(`创建失败: ${e.message}`);
        }
      });

      document.querySelectorAll('[data-dispatch-review]').forEach((el) => {
        el.addEventListener('click', async () => {
          try {
            const reviewId = el.dataset.dispatchReview;
            const reviewer = el.dataset.reviewer;
            const res = await postJSON(`/api/reviews/${encodeURIComponent(reviewId)}/dispatch`, {
              actor_id: reviewer,
              actor_role: 'agent',
            });
            if (!res.ok) throw new Error(res.error || '派发失败');
            await loadConfigDocs();
            if (state.selectedReviewId === reviewId) await loadReviewDetail(reviewId);
            renderGovernance();
          } catch (e) {
            alert(`派发失败: ${e.message}`);
          }
        });
      });

      document.querySelectorAll('[data-reclaim-review]').forEach((el) => {
        el.addEventListener('click', async () => {
          try {
            const reviewId = el.dataset.reclaimReview;
            const res = await postJSON(`/api/reviews/${encodeURIComponent(reviewId)}/reclaim`, {
              actor_id: 'luban',
              actor_role: 'admin',
              action: 'reclaim',
            });
            if (!res.ok) throw new Error(res.error || '恢复失败');
            await loadConfigDocs();
            if (state.selectedReviewId === reviewId) await loadReviewDetail(reviewId);
            renderGovernance();
          } catch (e) {
            alert(`恢复失败: ${e.message}`);
          }
        });
      });

      document.querySelectorAll('[data-open-review]').forEach((el) => {
        el.addEventListener('click', async () => {
          const reviewId = el.dataset.openReview;
          if (!reviewId) return;
          await loadReviewDetail(reviewId);
          renderGovernance();
        });
      });

      document.getElementById('scanRecoveryViewBtn')?.addEventListener('click', async () => {
        try {
          const res = await fetchJSON('/api/recovery/scan');
          state.recoveryScan = res;
          await loadConfigDocs();
          state.governanceView = 'recovery';
          syncRouteState();
          renderGovernance();
        } catch (e) {
          alert(`扫描失败: ${e.message}`);
        }
      });

      document.querySelectorAll('[data-chief-decision]').forEach((el) => {
        el.addEventListener('click', async () => {
          try {
            if (!state.selectedReviewId) {
              alert('请先选择审查单');
              return;
            }
            const nextOwner = document.getElementById('chiefNextOwnerInput')?.value?.trim();
            const nextAction = document.getElementById('chiefNextActionInput')?.value?.trim();
            if (!nextOwner || !nextAction) {
              alert('请填写 next owner 和 next action');
              return;
            }
            const res = await postJSON(`/api/reviews/${encodeURIComponent(state.selectedReviewId)}/chief-decision`, {
              actor_id: 'braintrust_chief',
              actor_role: 'admin',
              decision: el.dataset.chiefDecision,
              next_action: nextAction,
              next_owner: nextOwner,
            });
            if (!res.ok) throw new Error(res.error || '提交失败');
            await loadConfigDocs();
            await loadReviewDetail(state.selectedReviewId);
            renderGovernance();
          } catch (e) {
            alert(`提交失败: ${e.message}`);
          }
        });
      });

      document.getElementById('submitPacketBtn')?.addEventListener('click', async () => {
        try {
          if (!state.selectedReviewId) {
            alert('请先选择审查单');
            return;
          }
          const reviewerId = document.getElementById('packetReviewerInput')?.value?.trim();
          const verdict = document.getElementById('packetVerdictInput')?.value?.trim();
          const findingsText = document.getElementById('packetFindingsInput')?.value?.trim() || '';
          if (!reviewerId || !verdict) {
            alert('请填写 reviewer id 和 verdict');
            return;
          }
          const findings = findingsText ? findingsText.split(';').map((item) => item.trim()).filter(Boolean) : [];
          const res = await postJSON(`/api/reviews/${encodeURIComponent(state.selectedReviewId)}/packet`, {
            reviewer_id: reviewerId,
            provider: 'openai',
            verdict,
            findings,
          });
          if (!res.ok) throw new Error(res.error || '提交失败');
          await loadConfigDocs();
          await loadReviewDetail(state.selectedReviewId);
          renderGovernance();
        } catch (e) {
          alert(`提交失败: ${e.message}`);
        }
      });

      document.querySelectorAll('[data-packet-preset]').forEach((el) => {
        el.addEventListener('click', () => {
          const preset = el.dataset.packetPreset;
          const reviewerInput = document.getElementById('packetReviewerInput');
          const verdictInput = document.getElementById('packetVerdictInput');
          const findingsInput = document.getElementById('packetFindingsInput');
          if (!reviewerInput || !verdictInput || !findingsInput) return;
          if (preset === 'architect') {
            reviewerInput.value = 'braintrust_architect';
            verdictInput.value = 'approved';
            findingsInput.value = 'architecture validated;handoff constraints preserved';
          } else if (preset === 'critic') {
            reviewerInput.value = 'braintrust_critic';
            verdictInput.value = 'needs_rework';
            findingsInput.value = 'critical gap found;handoff risk remains';
          } else if (preset === 'innovator') {
            reviewerInput.value = 'braintrust_innovator';
            verdictInput.value = 'approved_with_conditions';
            findingsInput.value = 'innovation opportunity noted;apply after current handoff stabilizes';
          }
        });
      });

      document.querySelectorAll('[data-preset-submit]').forEach((el) => {
        el.addEventListener('click', async () => {
          if (!state.selectedReviewId) {
            alert('请先选择审查单');
            return;
          }
          const preset = el.dataset.presetSubmit;
          const reviewerInput = document.getElementById('packetReviewerInput');
          const verdictInput = document.getElementById('packetVerdictInput');
          const findingsInput = document.getElementById('packetFindingsInput');
          if (!reviewerInput || !verdictInput || !findingsInput) return;
          let reviewerId, verdict, findings;
          if (preset === 'architect') {
            reviewerId = 'braintrust_architect';
            verdict = 'approved';
            findings = 'architecture validated;handoff constraints preserved';
          } else if (preset === 'critic') {
            reviewerId = 'braintrust_critic';
            verdict = 'needs_rework';
            findings = 'critical gap found;handoff risk remains';
          } else if (preset === 'innovator') {
            reviewerId = 'braintrust_innovator';
            verdict = 'approved_with_conditions';
            findings = 'innovation opportunity noted;apply after current handoff stabilizes';
          } else return;
          reviewerInput.value = reviewerId;
          verdictInput.value = verdict;
          findingsInput.value = findings;
          try {
            const res = await postJSON(`/api/reviews/${encodeURIComponent(state.selectedReviewId)}/packet`, {
              reviewer_id: reviewerId,
              provider: 'openai',
              verdict,
              findings: findings ? findings.split(';').map((s) => s.trim()).filter(Boolean) : [],
            });
            if (!res.ok) throw new Error(res.error || '提交失败');
            await loadConfigDocs();
            await loadReviewDetail(state.selectedReviewId);
            renderGovernance();
          } catch (e) {
            alert(`提交失败: ${e.message}`);
          }
        });
      });

      if (state.selectedChangeId && document.getElementById('changeDetailPanel')) {
        renderChangeDetail(state.selectedChangeId);
      }
    }

    function workflowCanvasSize(graph) {
      const nodes = graph?.nodes || [];
      const maxX = Math.max(980, ...nodes.map((node) => node.x + 280));
      const maxY = Math.max(560, ...nodes.map((node) => node.y + 190));
      return { width: maxX, height: maxY };
    }

    function workflowEdgePath(graph, edge) {
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

    function renderWorkflowDesignerHtml(meta, graph, targetSummary, pendingCount) {
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

    function renderAdvancedConfigExpertHtml(targetSummary, targetTeam, targetId, leadConfig, machineConfig, relatedGroups, leadsText, stateText, pendingHtml, proposal, pendingCount) {
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

    function attachWorkflowDesignerInteractions(targetId) {
      const graph = ensureWorkflowGraph(targetId);
      if (!graph) return;

      const rerender = () => renderAdvancedConfig();
      const selectedNode = getSelectedWorkflowNode();
      const selectedEdge = getSelectedWorkflowEdge();

      document.querySelectorAll('[data-workflow-node-id]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const nodeId = el.dataset.workflowNodeId;
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
          const node = graph.nodes.find((item) => item.id === el.dataset.workflowNodeId);
          if (!node) return;
          originX = node.x;
          originY = node.y;
          el.style.cursor = 'grabbing';
          const onMove = (moveEvent) => {
            if (!dragging) return;
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            node.x = Math.max(24, originX + dx);
            node.y = Math.max(24, originY + dy);
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
          };
          const onUp = () => {
            dragging = false;
            el.style.cursor = 'grab';
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
          state.selectedWorkflowEdgeKey = el.dataset.edgeKey;
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
        const nextId = normalizeStateId(event.target.value);
        if (nextId !== selectedNode.id && graph.nodes.some((node) => node.id === nextId)) {
          alert('阶段名称重复，请更换。');
          event.target.value = selectedNode.id;
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
        selectedNode.unifiedState = event.target.value;
      });
      document.getElementById('workflowNodeRoleInput')?.addEventListener('input', (event) => {
        if (!selectedNode) return;
        selectedNode.role = event.target.value;
      });
      document.getElementById('workflowNodeDescInput')?.addEventListener('input', (event) => {
        if (!selectedNode) return;
        selectedNode.description = event.target.value;
      });
      document.getElementById('workflowNodeHeartbeatInput')?.addEventListener('change', (event) => {
        if (!selectedNode) return;
        selectedNode.heartbeatInterval = Math.max(30, Number(event.target.value || graph.defaults.intervalSeconds));
      });
      document.getElementById('workflowNodeTimeoutInput')?.addEventListener('change', (event) => {
        if (!selectedNode) return;
        selectedNode.heartbeatTimeout = Math.max(60, Number(event.target.value || graph.defaults.timeoutThresholdSeconds));
      });
      document.getElementById('workflowNodeStartCk')?.addEventListener('change', (event) => {
        if (!selectedNode) return;
        graph.nodes.forEach((node) => { node.isStart = false; });
        selectedNode.isStart = Boolean(event.target.checked);
        graph.startNodeId = event.target.checked ? selectedNode.id : (graph.nodes[0]?.id || null);
        rerender();
      });
      document.getElementById('workflowNodeTerminalCk')?.addEventListener('change', (event) => {
        if (!selectedNode) return;
        selectedNode.isTerminal = Boolean(event.target.checked);
      });

      document.getElementById('edgeTypeSelect')?.addEventListener('change', (event) => {
        if (!selectedEdge) return;
        selectedEdge.transitionType = event.target.value;
      });
      document.getElementById('edgeConditionSelect')?.addEventListener('change', (event) => {
        if (!selectedEdge) return;
        selectedEdge.condition = event.target.value;
      });
      document.getElementById('edgeConfirmCk')?.addEventListener('change', (event) => {
        if (!selectedEdge) return;
        selectedEdge.requiresConfirmation = Boolean(event.target.checked);
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

    function renderAdvancedConfig() {
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
        ? `<ul class="queue-list">${pending.map(x => `<li>${safe(x.target)} · ${safe(x.desc || 'queued')}</li>`).join('')}</ul>`
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
          syncRouteState();
          renderAll();
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
        syncRouteState();
        renderAdvancedConfig();
      });
      document.getElementById('expertModeTabBtn')?.addEventListener('click', () => {
        state.advancedConfigMode = 'expert';
        syncRouteState();
        renderAdvancedConfig();
      });

      if (state.advancedConfigMode === 'workflow-designer') {
        attachWorkflowDesignerInteractions(targetId);
        return;
      }

      document.getElementById('saveTeamLeadsBtn')?.addEventListener('click', async () => {
        try {
          const doc = JSON.parse(document.getElementById('teamLeadsEditor').value);
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
          const doc = JSON.parse(document.getElementById('teamStateEditor').value);
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
          const doc = JSON.parse(document.getElementById('teamLeadsEditor').value);
          state.pendingChanges['team-leads'] = { target: 'team-leads', doc, desc: '团队 Lead 配置' };
          renderAdvancedConfig();
        } catch (e) {
          alert(`JSON 解析失败: ${e.message}`);
        }
      });

      document.getElementById('queueTeamStateBtn')?.addEventListener('click', () => {
        try {
          const doc = JSON.parse(document.getElementById('teamStateEditor').value);
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
          const prompt = document.getElementById('promptInput').value.trim();
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
          const restartGateway = Boolean(document.getElementById('restartGatewayCk')?.checked);
          const res = await postJSON('/api/config/publish', { changes, restart_gateway: restartGateway, operator: 'dashboard-ui' });
          if (!res.ok) throw new Error(res.error || '发布失败');
          alert(`发布成功\nbackup: ${safe(res.backup)}\nrestart_done: ${safe(res.restart_done)}`);
          state.pendingChanges = {};
          await loadConfigDocs();
          await loadAllData();
          renderAll();
        } catch (e) {
          alert(`发布失败: ${e.message}`);
        }
      });
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

    async function loadConfigDocs() {
      const [teamLeadsRes, teamStateRes, runtimeVersionRes, changeTaskRes, reviewTaskRes] = await Promise.all([
        fetchJSON('/api/config/team-leads'),
        fetchJSON('/api/config/team-state-machines'),
        fetchJSON('/api/runtime-versions'),
        fetchJSON('/api/change-tasks'),
        fetchJSON('/api/reviews'),
      ]);
      state.teamLeadsDoc = teamLeadsRes.doc || null;
      state.teamStateDoc = teamStateRes.doc || null;
      state.runtimeVersions = runtimeVersionRes || {};
      state.changeTasks = changeTaskRes.changes || [];
      state.reviewTasks = reviewTaskRes.reviews || [];
      if (state.selectedChangeId && !state.changeTasks.some((item) => item.change_id === state.selectedChangeId)) {
        state.selectedChangeId = null;
        syncRouteState();
      }
      if (state.selectedReviewId && !state.reviewTasks.some((item) => item.review_id === state.selectedReviewId)) {
        state.selectedReviewId = null;
        state.reviewDetail = null;
        syncRouteState();
      }
    }

    async function loadReviewDetail(reviewId) {
      if (!reviewId) {
        state.selectedReviewId = null;
        state.reviewDetail = null;
        syncRouteState();
        return;
      }
      const res = await fetchJSON(`/api/reviews/${encodeURIComponent(reviewId)}`);
      state.selectedReviewId = reviewId;
      state.reviewDetail = res && !res.error ? res : null;
      state.view = 'governance';
      state.governanceView = 'review';
      syncRouteState();
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

    async function renderChangeDetail(changeId) {
      const panel = document.getElementById('changeDetailPanel');
      if (!panel) return;
      panel.innerHTML = '<div class="warn-text">加载中…</div>';
      try {
        const c = await fetchJSON(`/api/change-tasks/${encodeURIComponent(changeId)}`);
        state.selectedChangeId = changeId;
        state.view = 'governance';
        state.governanceView = 'change';
        syncRouteState();
        const auditList = c.publish_audit || [];
        const impactTargets = Array.isArray(c.impact_targets) ? c.impact_targets : (c.impact_targets ? [c.impact_targets] : []);
        const atRisk = Array.isArray(c.at_risk_tasks) ? c.at_risk_tasks : (c.at_risk_tasks ? [c.at_risk_tasks] : []);
        panel.innerHTML = `
          <div class="mono" style="margin-bottom:8px;">${safe(c.change_id)} · ${safe(c.scope)} · ${safe(c.status)}</div>
          <div style="font-weight:700;margin-bottom:6px;">${safe(c.title)}</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:10px;">${safe(c.description || '-')}</div>
          <div class="row-actions" style="margin-bottom:10px;">
            <a href="task_dashboard.html${atRisk.length ? `?task_id=${encodeURIComponent(atRisk[0])}` : '?pool=governance_pool'}" class="btn" target="_blank" rel="noopener">在任务中心查看</a>
          </div>
          <div class="collapsible-section" style="margin-top:10px;">
            <strong>影响范围</strong>
            <div class="mono">impact_targets: ${safe(impactTargets.join(', ') || '-')}</div>
            <div class="mono">at_risk_tasks: ${safe(atRisk.join(', ') || '-')}</div>
          </div>
          <div class="collapsible-section" style="margin-top:8px;">
            <strong>回滚计划</strong>
            <div class="mono">${safe(c.rollback_plan || '-')}</div>
          </div>
          <div class="collapsible-section" style="margin-top:8px;">
            <strong>审批</strong>
            <div class="mono">${c.approval ? `已审批 · ${safe(c.approval.approved_by)} · ${safe(c.approval.approved_at)}` : '未审批'}</div>
          </div>
          <div style="margin-top:12px;">
            <strong>发布审计</strong>
            ${auditList.length ? `<ul>${auditList.map((a) => `<li class="mono">${safe(a.published_at)} · ${safe(a.published_by)} · workflow=${safe(a.versions?.workflow_version)} · routing=${safe(a.versions?.routing_version)}${a.p0_override ? ' · P0 override' : ''}</li>`).join('')}</ul>` : '<div class="warn-text">暂无发布记录</div>'}
          </div>
          <div class="row-actions" style="margin-top:12px;">
            <button class="btn" data-approve-change="${safe(changeId)}">审批变更</button>
            <button class="btn primary" data-publish-change="${safe(changeId)}">发布变更</button>
          </div>
        `;
        panel.querySelectorAll('[data-approve-change]').forEach((el) => {
          el.addEventListener('click', async () => {
            try {
              const res = await postJSON(`/api/change-tasks/${encodeURIComponent(changeId)}/approve`, { actor_id: 'braintrust_chief', actor_role: 'admin' });
              if (!res.ok) throw new Error(res.error || '审批失败');
              await renderChangeDetail(changeId);
              await loadConfigDocs();
              renderGovernance();
            } catch (e) {
              alert(`审批失败: ${e.message}`);
            }
          });
        });
        panel.querySelectorAll('[data-publish-change]').forEach((el) => {
          el.addEventListener('click', async () => {
            try {
              const res = await postJSON(`/api/change-tasks/${encodeURIComponent(changeId)}/publish`, { actor_id: 'luban', actor_role: 'admin' });
              if (!res.ok) throw new Error(res.error || '发布失败');
              await loadConfigDocs();
              await loadAllData();
              await renderChangeDetail(changeId);
              renderGovernance();
            } catch (e) {
              alert(`发布失败: ${e.message}`);
            }
          });
        });
      } catch (e) {
        panel.innerHTML = `<div class="danger-text">加载失败: ${safe(e.message)}</div>`;
      }
    }

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
