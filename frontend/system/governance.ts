import { state, safe } from './state';
import { fetchJSON, postJSON } from './actions';

type GovernanceCallbacks = {
  loadConfigDocs: () => Promise<void>;
  loadAllData: () => Promise<void>;
  renderAll: () => void;
  syncRouteState: () => void;
};

let callbacks: GovernanceCallbacks = {
  loadConfigDocs: async () => {},
  loadAllData: async () => {},
  renderAll: () => {},
  syncRouteState: () => {},
};

export function bindGovernanceCallbacks(next: GovernanceCallbacks): void {
  callbacks = next;
}

export async function loadGovernance(): Promise<void> {
  const [changeTaskRes, reviewTaskRes] = await Promise.all([
    fetchJSON('/api/change-tasks'),
    fetchJSON('/api/reviews'),
  ]);
  state.changeTasks = changeTaskRes.changes || [];
  state.reviewTasks = reviewTaskRes.reviews || [];
  if (state.selectedChangeId && !state.changeTasks.some((item) => item.change_id === state.selectedChangeId)) {
    state.selectedChangeId = null;
    callbacks.syncRouteState();
  }
  if (state.selectedReviewId && !state.reviewTasks.some((item) => item.review_id === state.selectedReviewId)) {
    state.selectedReviewId = null;
    state.reviewDetail = null;
    callbacks.syncRouteState();
  }
}

export function renderGovernance(): void {
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
        ` : '<div class="warn-text">尚未选中审查任务。</div>'}
      </section>
      ` : ''}

      ${showRecovery ? `
      <section class="editor-card">
        <h4>恢复</h4>
        <div class="row-actions">
          <button class="btn" id="refreshRecoveryBtn">刷新恢复对象</button>
        </div>
        ${state.recoveryScan ? `<div class="mono" style="margin-bottom:10px;">最近扫描：${safe((state.recoveryScan.stalled_reviews || []).length)} 个停滞对象</div>` : '<div class="warn-text">尚未执行扫描。点击上方按钮刷新恢复对象。</div>'}
        ${recoveryItems.length ? `
          <ul class="queue-list">
            ${recoveryItems.map(item => {
              const missing = (item.packet_missing || []).length ? item.packet_missing.join(', ') : '-';
              const suggestion = item.chief_status === 'blocked'
                ? '建议：需要重新提交审查材料'
                : item.chief_status === 'pending'
                  ? '建议：等待 chief 裁决或人工接管'
                  : item.reclaim_eligible ? '建议：立即接管并推进' : '建议：保持观察';
              return `
                <li>
                  <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                    <button class="btn" data-open-review="${safe(item.review_id)}" style="text-align:left;justify-content:flex-start;flex:1;">
                      ${safe(item.title)} · ${safe(item.status)} · ${safe(item.review_pool)}
                    </button>
                    <span class="mono">${safe(item.review_id)}</span>
                  </div>
                  <div class="mono" style="margin-top:6px;">缺失=${safe(missing)} · chief=${safe(item.chief_status || '-')} · 可接管=${safe(item.reclaim_eligible ? 'yes' : 'no')}</div>
                  <div class="mono" style="margin-top:6px;">${suggestion}</div>
                  <div class="row-actions" style="margin-top:6px;">
                    <button class="btn warn" data-reclaim-review="${safe(item.review_id)}">执行恢复接管</button>
                    <a href="task_dashboard.html${(item.target_task_id || item.submission_bundle?.target_task_id) ? `?task_id=${encodeURIComponent(item.target_task_id || item.submission_bundle?.target_task_id)}` : '?pool=recovery_pool'}" class="inline-link" target="_blank" rel="noopener">查看关联任务</a>
                  </div>
                </li>
              `;
            }).join('')}
          </ul>
        ` : '<div class="warn-text">暂无恢复对象。</div>'}
      </section>
      ` : ''}
    </div>
  `;

  document.getElementById('governanceChangeTab')?.addEventListener('click', () => {
    state.governanceView = 'change';
    callbacks.syncRouteState();
    renderGovernance();
  });
  document.getElementById('governanceReviewTab')?.addEventListener('click', () => {
    state.governanceView = 'review';
    callbacks.syncRouteState();
    renderGovernance();
  });
  document.getElementById('governanceRecoveryTab')?.addEventListener('click', () => {
    state.governanceView = 'recovery';
    callbacks.syncRouteState();
    renderGovernance();
  });

  document.getElementById('createChangeTaskBtn')?.addEventListener('click', async () => {
    try {
      const desc = (document.getElementById('changeTaskInput') as HTMLTextAreaElement).value.trim();
      if (!desc) {
        alert('请填写变更说明');
        return;
      }
      const impactTargets = (document.getElementById('changeImpactTargetsInput') as HTMLInputElement)?.value || '';
      const atRiskTasks = (document.getElementById('changeAtRiskTasksInput') as HTMLInputElement)?.value || '';
      const rollbackPlan = (document.getElementById('changeRollbackInput') as HTMLInputElement)?.value || '';
      const res = await postJSON('/api/change-tasks', {
        title: desc,
        impact_targets: impactTargets.split(';').map((item) => item.trim()).filter(Boolean),
        at_risk_tasks: atRiskTasks.split(';').map((item) => item.trim()).filter(Boolean),
        rollback_plan: rollbackPlan.trim(),
        actor_id: 'luban',
        actor_role: 'admin',
      });
      if (!res.ok) throw new Error(res.error || '创建失败');
      state.selectedChangeId = res.change_id || state.selectedChangeId;
      state.governanceView = 'change';
      callbacks.syncRouteState();
      await callbacks.loadConfigDocs();
      await renderChangeDetail(state.selectedChangeId);
      renderGovernance();
    } catch (e) {
      alert(`创建失败: ${e.message}`);
    }
  });

  document.querySelectorAll('[data-open-change]').forEach((el) => {
    el.addEventListener('click', async () => {
      const changeId = (el as HTMLElement).dataset.openChange;
      if (!changeId) return;
      state.selectedChangeId = changeId;
      state.governanceView = 'change';
      callbacks.syncRouteState();
      await renderChangeDetail(changeId);
      renderGovernance();
    });
  });

  document.getElementById('createReviewTaskBtn')?.addEventListener('click', async () => {
    try {
      const title = (document.getElementById('reviewTitleInput') as HTMLInputElement).value.trim();
      const incidentKey = (document.getElementById('reviewIncidentInput') as HTMLInputElement).value.trim();
      const summary = (document.getElementById('reviewSummaryInput') as HTMLTextAreaElement).value.trim();
      if (!title || !summary) {
        alert('请填写审查标题和摘要');
        return;
      }
      const res = await postJSON('/api/reviews', {
        title,
        incident_key: incidentKey,
        summary,
        actor_id: 'braintrust_chief',
        actor_role: 'admin',
      });
      if (!res.ok) throw new Error(res.error || '创建失败');
      state.selectedReviewId = res.review_id || state.selectedReviewId;
      state.governanceView = 'review';
      callbacks.syncRouteState();
      await callbacks.loadConfigDocs();
      await loadReviewDetail(state.selectedReviewId);
      renderGovernance();
    } catch (e) {
      alert(`创建失败: ${e.message}`);
    }
  });

  document.querySelectorAll('[data-dispatch-review]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        const reviewId = (el as HTMLElement).dataset.dispatchReview;
        const reviewer = (el as HTMLElement).dataset.reviewer;
        if (!reviewId || !reviewer) return;
        const res = await postJSON(`/api/reviews/${encodeURIComponent(reviewId)}/dispatch`, {
          actor_id: reviewer,
          actor_role: 'reviewer',
        });
        if (!res.ok) throw new Error(res.error || '派发失败');
        await callbacks.loadConfigDocs();
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
        const reviewId = (el as HTMLElement).dataset.reclaimReview;
        if (!reviewId) return;
        const res = await postJSON(`/api/reviews/${encodeURIComponent(reviewId)}/reclaim`, {
          actor_id: 'braintrust_chief',
          actor_role: 'admin',
        });
        if (!res.ok) throw new Error(res.error || '恢复失败');
        await callbacks.loadConfigDocs();
        if (state.selectedReviewId === reviewId) await loadReviewDetail(reviewId);
        renderGovernance();
      } catch (e) {
        alert(`恢复失败: ${e.message}`);
      }
    });
  });

  document.querySelectorAll('[data-open-review]').forEach((el) => {
    el.addEventListener('click', async () => {
      const reviewId = (el as HTMLElement).dataset.openReview;
      if (!reviewId) return;
      await loadReviewDetail(reviewId);
      renderGovernance();
    });
  });

  document.getElementById('refreshRecoveryBtn')?.addEventListener('click', async () => {
    try {
      const res = await fetchJSON('/api/recovery/scan');
      state.recoveryScan = res;
      state.governanceView = 'recovery';
      callbacks.syncRouteState();
      renderGovernance();
    } catch (e) {
      alert(`刷新失败: ${e.message}`);
    }
  });

  document.querySelectorAll('[data-chief-decision]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        if (!state.selectedReviewId) {
          alert('请先选择一个审查任务');
          return;
        }
        const nextOwner = (document.getElementById('chiefNextOwnerInput') as HTMLInputElement)?.value?.trim();
        const nextAction = (document.getElementById('chiefNextActionInput') as HTMLInputElement)?.value?.trim();
        const res = await postJSON(`/api/reviews/${encodeURIComponent(state.selectedReviewId)}/chief-decision`, {
          actor_id: 'braintrust_chief',
          actor_role: 'admin',
          decision: (el as HTMLElement).dataset.chiefDecision,
          next_owner: nextOwner,
          next_action: nextAction,
        });
        if (!res.ok) throw new Error(res.error || '提交失败');
        await callbacks.loadConfigDocs();
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
        alert('请先选择一个审查任务');
        return;
      }
      const reviewerId = (document.getElementById('packetReviewerInput') as HTMLInputElement)?.value?.trim();
      const verdict = (document.getElementById('packetVerdictInput') as HTMLInputElement)?.value?.trim();
      const findings = (document.getElementById('packetFindingsInput') as HTMLTextAreaElement)?.value?.trim();
      if (!reviewerId || !verdict) {
        alert('请填写 reviewer id 和 verdict');
        return;
      }
      const res = await postJSON(`/api/reviews/${encodeURIComponent(state.selectedReviewId)}/packet`, {
        reviewer_id: reviewerId,
        verdict,
        findings: findings ? findings.split(';').map((item) => item.trim()).filter(Boolean) : [],
      });
      if (!res.ok) throw new Error(res.error || '提交失败');
      await callbacks.loadConfigDocs();
      await loadReviewDetail(state.selectedReviewId);
      renderGovernance();
    } catch (e) {
      alert(`提交失败: ${e.message}`);
    }
  });

  document.querySelectorAll('[data-packet-preset]').forEach((el) => {
    el.addEventListener('click', () => {
      const reviewerInput = document.getElementById('packetReviewerInput') as HTMLInputElement;
      const verdictInput = document.getElementById('packetVerdictInput') as HTMLInputElement;
      const findingsInput = document.getElementById('packetFindingsInput') as HTMLTextAreaElement;
      if (!reviewerInput || !verdictInput || !findingsInput) return;
      if ((el as HTMLElement).dataset.packetPreset === 'architect') {
        reviewerInput.value = 'braintrust_architect';
        verdictInput.value = 'approved';
        findingsInput.value = '确保 review gate 能够落到控制平面；验证配置发布口是否唯一';
      } else if ((el as HTMLElement).dataset.packetPreset === 'critic') {
        reviewerInput.value = 'braintrust_critic';
        verdictInput.value = 'needs_rework';
        findingsInput.value = '缺少明确业务真相源；handoff gate 未明确';
      } else {
        reviewerInput.value = 'braintrust_innovator';
        verdictInput.value = 'approved';
        findingsInput.value = '建议新增治理可视化检查；可补充回滚策略';
      }
    });
  });

  document.querySelectorAll('[data-preset-submit]').forEach((el) => {
    el.addEventListener('click', async () => {
      const reviewerInput = document.getElementById('packetReviewerInput') as HTMLInputElement;
      const verdictInput = document.getElementById('packetVerdictInput') as HTMLInputElement;
      const findingsInput = document.getElementById('packetFindingsInput') as HTMLTextAreaElement;
      if (!reviewerInput || !verdictInput || !findingsInput) return;
      let reviewerId;
      let verdict;
      let findings;
      if ((el as HTMLElement).dataset.presetSubmit === 'architect') {
        reviewerId = 'braintrust_architect';
        verdict = 'approved';
        findings = '确保 review gate 能够落到控制平面；验证配置发布口是否唯一';
      } else if ((el as HTMLElement).dataset.presetSubmit === 'critic') {
        reviewerId = 'braintrust_critic';
        verdict = 'needs_rework';
        findings = '缺少明确业务真相源；handoff gate 未明确';
      } else {
        reviewerId = 'braintrust_innovator';
        verdict = 'approved';
        findings = '建议新增治理可视化检查；可补充回滚策略';
      }
      reviewerInput.value = reviewerId;
      verdictInput.value = verdict;
      findingsInput.value = findings;
      if (!state.selectedReviewId) {
        alert('请先选择一个审查任务');
        return;
      }
      const res = await postJSON(`/api/reviews/${encodeURIComponent(state.selectedReviewId)}/packet`, {
        reviewer_id: reviewerId,
        verdict,
        findings: findings.split(';').map((item) => item.trim()).filter(Boolean),
      });
      if (!res.ok) {
        alert(`提交失败: ${res.error || '未知错误'}`);
        return;
      }
      await callbacks.loadConfigDocs();
      await loadReviewDetail(state.selectedReviewId);
      renderGovernance();
    });
  });

  if (state.selectedChangeId && document.getElementById('changeDetailPanel')) {
    renderChangeDetail(state.selectedChangeId);
  }
}

export async function loadReviewDetail(reviewId: string): Promise<void> {
  if (!reviewId) {
    state.selectedReviewId = null;
    state.reviewDetail = null;
    callbacks.syncRouteState();
    return;
  }
  const res = await fetchJSON(`/api/reviews/${encodeURIComponent(reviewId)}`);
  state.selectedReviewId = reviewId;
  state.reviewDetail = res && !res.error ? res : null;
  state.view = 'governance';
  state.governanceView = 'review';
  callbacks.syncRouteState();
}

export async function renderChangeDetail(changeId: string): Promise<void> {
  const panel = document.getElementById('changeDetailPanel');
  if (!panel) return;
  if (!changeId) {
    panel.innerHTML = '<div class="warn-text">未选中变更任务。</div>';
    return;
  }
  panel.innerHTML = '<div class="placeholder">加载中...</div>';
  try {
    const c = await fetchJSON(`/api/change-tasks/${encodeURIComponent(changeId)}`);
    state.selectedChangeId = changeId;
    state.view = 'governance';
    state.governanceView = 'change';
    callbacks.syncRouteState();
    const atRisk = c.at_risk_tasks || [];
    panel.innerHTML = `
      <div class="mono" style="margin-bottom:8px;">${safe(c.change_id)} · ${safe(c.scope)} · ${safe(c.status)}</div>
      <div style="font-weight:700;margin-bottom:6px;">${safe(c.title)}</div>
      <div class="mono" style="margin-bottom:10px;">impact=${safe((c.impact_targets || []).join(', ') || '-')}</div>
      <div class="mono" style="margin-bottom:10px;">风险任务=${safe(atRisk.join(', ') || '-')}</div>
      <div class="mono" style="margin-bottom:10px;">回滚计划=${safe(c.rollback_plan || '-')}</div>
      <div class="mono" style="margin-bottom:10px;">审批=${safe(c.approval?.status || '-')} · 发布=${safe(c.publish_audit?.status || '-')}</div>
      <div class="row-actions" style="margin-bottom:10px;">
        <a href="task_dashboard.html${atRisk.length ? `?task_id=${encodeURIComponent(atRisk[0])}` : '?pool=governance_pool'}" class="btn" target="_blank" rel="noopener">在任务中心查看</a>
      </div>
      <div class="row-actions" style="margin-bottom:12px;">
        <button class="btn" data-approve-change="${safe(changeId)}">审批变更</button>
        <button class="btn primary" data-publish-change="${safe(changeId)}">发布变更</button>
      </div>
      <details class="collapsible-section" open>
        <summary>发布审计</summary>
        <div class="mono" style="margin-top:6px;">${safe(c.publish_audit?.status || '-')} · ${safe(c.publish_audit?.published_at || '-')} · ${safe(c.publish_audit?.published_by || '-')}</div>
        <div class="mono" style="margin-top:6px;">backup=${safe(c.publish_audit?.backup || '-')} · restart=${safe(c.publish_audit?.restart_done ? 'yes' : 'no')}</div>
      </details>
    `;
    panel.querySelectorAll('[data-approve-change]').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          const res = await postJSON(`/api/change-tasks/${encodeURIComponent(changeId)}/approve`, { actor_id: 'braintrust_chief', actor_role: 'admin' });
          if (!res.ok) throw new Error(res.error || '审批失败');
          await renderChangeDetail(changeId);
          await callbacks.loadConfigDocs();
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
          await callbacks.loadConfigDocs();
          await callbacks.loadAllData();
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
