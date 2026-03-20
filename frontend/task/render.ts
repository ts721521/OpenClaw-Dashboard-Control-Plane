import {
  activeStageCard,
  buildGateIssues,
  healthLabel,
  runtimeClass,
  safe,
  statusBadge,
} from '../shared/task_utils';
import { TaskDashboardState } from './state';

export function renderControlAudit(list: any[]): string {
  if (!list || !list.length) return '<div class="empty">暂无控制记录</div>';
  return `<ul class="audit-list">${list.map((x) => `<li>${safe(x.ts)} · ${safe(x.action)} · mode=${safe(x.mode)} · op=${safe(x.operator)}${x.hard_error ? ` · err=${safe(x.hard_error)}` : ''}</li>`).join('')}</ul>`;
}

export function renderTaskList(list: any[], selectedTaskId: string | null): string {
  return list
    .map((t, idx) => {
      const [txt, cls] = statusBadge(t.status);
      const selected = t.task_id === selectedTaskId ? 'selected' : '';
      const typeLabel = t.task_type === 'review_task' ? '审查单' : safe(t.task_type || '-');
      return `
          <article class="task ${selected}" data-id="${t.task_id}" style="animation-delay: ${Math.min(idx * 35, 280)}ms">
            <div class="row">
              <h3>${safe(t.task_name)}</h3>
              <span class="badge ${cls}">${txt}</span>
            </div>
            <div class="mono">${safe(t.task_id)} · ${typeLabel}</div>
            <div class="bar"><div class="fill" style="width:${Math.max(0, Math.min(100, t.progress || 0))}%"></div></div>
            <div class="meta-grid">
              <div>进度：<strong>${t.progress || 0}%</strong></div>
              <div>阶段：<strong>${t.completed_stages || 0}/${t.total_stages || 0}</strong></div>
              <div>当前 Agent：<span class="mono">${safe(t.owner)}</span></div>
              <div>任务池：<span class="mono">${safe(t.task_pool || 'team_dispatch_pool')}</span></div>
            </div>
          </article>
        `;
    })
    .join('');
}

export function renderTaskDetailHtml(detail: any, state: TaskDashboardState): string {
  const [stText, stClass] = statusBadge(detail.status);
  const [hText, hClass] = healthLabel(detail.agent_health);
  const rtClass = runtimeClass(detail.runtime_state);
  const stages = (detail.stages || [])
    .map((s: any) => {
      const c = s.status === 'completed' ? 'done' : s.status === 'in_progress' ? 'active' : '';
      const [sText, sClass] = statusBadge(s.status);
      return `
          <div class="stage ${c}">
            <div class="index">${safe(s.stage_id)}</div>
            <div>
              <div><strong>${safe(s.name)}</strong></div>
              <div style="font-size:12px;color:var(--muted);">${safe(s.description)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">责任: <span class="mono">${safe(s.owner_role)} / ${safe(s.owner_agent)}</span></div>
            </div>
            <span class="badge ${sClass}">${sText}</span>
          </div>
        `;
    })
    .join('');

  const flow = (detail.team_flow || [])
    .map((t: string) => `<a class="team-link" href="task_dashboard.html?team=${encodeURIComponent(t)}">${safe(t)}</a>`)
    .join('');

  const todos = (detail.todo_items || []).map((item: string) => `<li>${safe(item)}</li>`).join('');
  const chat = detail.session_link || {};
  const conflict = detail?.data_quality?.file_conflict || {};
  const dispatchLock = detail.dispatch_lock || {};
  const legacyReadonly = Boolean(detail?.data_quality?.is_legacy);
  const reviewPackets = detail?.raw?.review?.packets || [];
  const chiefDecision = detail?.raw?.review?.chief_decision || {};
  const artifacts = Array.isArray(detail.artifact_index) ? detail.artifact_index : [];
  const stageCard = activeStageCard(detail);
  const gateIssues = buildGateIssues(detail);
  const closureAction = safe(detail.next_recommended_action || '-');
  const closureOwner = safe(detail.next_recommended_owner || '-');
  const closureHtml = `
        <div class="box">
          <h3>闭环状态</h3>
          <div class="k2">
            <div><div class="v mono">${safe(detail.closure_state || '-')}</div><div class="l">当前闭环状态</div></div>
            <div><div class="v mono">${closureAction}</div><div class="l">下一步建议</div></div>
            <div><div class="v mono">${closureOwner}</div><div class="l">建议接手人</div></div>
            <div><div class="v">${detail.requires_manual_confirm ? '需要人工确认' : '可直接执行'}</div><div class="l">执行方式</div></div>
          </div>
          <div style="margin-top:10px;font-size:13px;color:var(--muted);">为什么停住：${safe(detail.closure_reason || '当前没有闭环阻断。')}</div>
          ${detail.recovery_reason ? `<div style="margin-top:6px;font-size:12px;color:var(--muted);">恢复原因: ${safe(detail.recovery_reason)} · 优先级: <span class="mono">${safe(detail.recovery_priority || '-')}</span></div>` : ''}
          <div class="detail-actions">
            ${detail.next_recommended_action ? `<button class="btn primary" id="applyRecommendedActionBtn" ${detail.requires_manual_confirm ? 'disabled' : ''}>一键应用建议</button>` : ''}
          </div>
        </div>
      `;
  const gateHtml = gateIssues.length
    ? `<div class="gate-panel">${gateIssues
        .map(
          (item) => `<div class="gate-item ${item.level}"><strong>${safe(item.title)}</strong><div style="margin-top:4px;color:var(--muted);">${safe(item.body)}</div></div>`
        )
        .join('')}</div>`
    : '<div class="gate-panel"><div class="gate-item"><strong>Gate 状态稳定</strong><div style="margin-top:4px;color:var(--muted);">当前业务绑定、验收和 gate_result 没有发现阻断项。</div></div></div>';
  const disabledAttr = legacyReadonly ? 'disabled' : '';
  const legacyWarn = detail?.data_quality?.is_legacy
    ? '<div style="margin-top:8px;font-size:12px;color:var(--warn);">该任务创建于 cutover 之前，默认按历史只读对待。</div>'
    : '';
  const conflictWarn = conflict?.has_conflict
    ? `<div style="margin-top:8px;font-size:12px;color:var(--danger);">检测到同一 task_id 存在多个任务文件且状态不一致（${safe(conflict.count)} 个），当前展示按最新 updated_at 选取。</div>`
    : '';

  const coreHtml = `
        ${closureHtml}
        <div class="box">
          <h3>${safe(detail.task_name)}</h3>
          <div class="mono">${safe(detail.task_id)} · ${safe(detail.task_type)}</div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="badge ${stClass}">${stText}</span>
            <span class="runtime-pill"><span class="pulse ${rtClass}"></span>运行态: ${safe(detail.runtime_state)} / ${safe(detail.runtime_hint)}</span>
            <span class="runtime-pill">实时数据: ${safe(chat.live_freshness || '-')}</span>
          </div>
          <div class="k2">
            <div><div class="v">${detail.total_stages || 0}</div><div class="l">总阶段数</div></div>
            <div><div class="v">${detail.completed_stages || 0}</div><div class="l">已完成</div></div>
            <div><div class="v">${detail.remaining_stages || 0}</div><div class="l">剩余</div></div>
            <div><div class="v">${detail.progress || 0}%</div><div class="l">总体进度</div></div>
          </div>
          <div style="margin-top:10px;font-size:12px;color:var(--muted);">
            任务池: <span class="mono">${safe(detail.task_pool)}</span> · 母任务: <span class="mono">${safe(detail.parent_task_id || '-')}</span> · 租约: <span class="mono">${safe(dispatchLock.owner || '-')} / ${safe(dispatchLock.state || 'none')}</span>
          </div>
          <div class="detail-actions">
            <button class="btn" id="claimTaskBtn" ${disabledAttr}>领取任务</button>
            <button class="btn" id="suggestDispatchBtn" ${disabledAttr}>自动分发建议</button>
            <button class="btn" id="confirmDispatchBtn" ${disabledAttr}>确认自动分发</button>
            <button class="btn" id="openChatBtn">打开 Claw 会话</button>
            <button class="btn warn" id="stopTaskBtn" ${disabledAttr}>停止任务</button>
            <button class="btn primary" id="restartTaskBtn" ${disabledAttr}>重启任务</button>
            <button class="btn danger" id="deleteTaskBtn" ${disabledAttr}>删除任务</button>
          </div>
          <div style="margin-top:10px;font-size:12px;color:var(--muted);">会话匹配: confidence=${safe(chat.confidence)} · ${safe(chat.reason)} · ${safe(chat.session_key)}</div>
          <div style="margin-top:8px;font-size:12px;color:var(--muted);">
            business_truth_source: <span class="mono">${safe(detail.business_truth_source || '-')}</span> ·
            acceptance_result: <span class="mono">${safe(detail.acceptance_result || '-')}</span> ·
            gate_result: <span class="mono">${safe(detail.gate_result || '-')}</span>
          </div>
          ${gateHtml}
          ${legacyWarn}
          ${conflictWarn}
          <div style="margin-top:10px;font-size:13px;color:var(--muted);">${safe(detail.description)}</div>
        </div>

        <div class="box">
          <h3>总体计划与阶段进展</h3>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">当前阶段：<strong>${safe(detail.current_stage)}</strong> · 下一阶段：<strong>${safe(detail.next_stage)}</strong></div>
          ${stages || '<div class="empty">无阶段数据</div>'}
        </div>

        <div class="box">
          <h3>任务具体要做什么</h3>
          ${todos ? `<ul class="todo-list">${todos}</ul>` : '<div class="empty">暂无明确待办</div>'}
        </div>

        <div class="box">
          <h3>执行与健康</h3>
          <div class="k2">
            <div><div class="v mono">${safe(detail.owner)}</div><div class="l">当前 Agent</div></div>
            <div><div class="v mono">${safe(detail.next_agent)}</div><div class="l">下一接手 Agent</div></div>
            <div><div class="v"><span class="health"><span class="dot ${hClass}"></span>${hText}</span></div><div class="l">运行健康</div></div>
            <div><div class="v">${detail.agent_health?.is_stalled ? '是' : '否'}</div><div class="l">是否停滞</div></div>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:8px;">最后心跳：${safe(detail.agent_health?.last_heartbeat)} · sessions=${safe(detail.agent_health?.sessions_count)}</div>
        </div>

        <div class="box">
          <h3>团队流转（点击查看团队）</h3>
          <div class="team-flow">${flow || '<span class="empty">暂无团队流转记录</span>'}</div>
        </div>

        <div class="box">
          <h3>控制审计</h3>
          ${renderControlAudit(detail.control_audit)}
        </div>

        <div class="box">
          <h3>关键产物索引</h3>
          ${artifacts.length ? `<ul class="audit-list">${artifacts
            .map(
              (item: any) => `<li><span class="mono">${safe(item.artifact_type || '-')}</span> · <span class="mono">${safe(item.version || '-')}</span> · ${safe(item.summary || '-')} · <span class="mono">${safe(item.path || '-')}</span></li>`
            )
            .join('')}</ul>` : '<div class="empty">暂无关键产物索引</div>'}
        </div>

        <div class="box">
          <h3>阶段交接与产物操作</h3>
          <div class="k2">
            <div><div class="v mono">${safe(stageCard?.stage_id || '-')}</div><div class="l">当前阶段卡</div></div>
            <div><div class="v mono">${safe(stageCard?.name || '-')}</div><div class="l">阶段名称</div></div>
            <div><div class="v mono">${safe(stageCard?.owner_agent || stageCard?.owner_role || '-')}</div><div class="l">当前责任人</div></div>
            <div><div class="v mono">${safe(stageCard?.status || '-')}</div><div class="l">阶段状态</div></div>
          </div>
          <div class="field-note">这组操作直接调用控制平面 API。历史任务保持只读，新任务可在这里补关键产物和阶段交接。</div>
          <div class="op-grid" style="margin-top:10px;">
            <input id="artifactTypeInput" type="text" placeholder="artifact type，例如 PRD" value="${safe(stageCard?.name || 'PRD')}" ${disabledAttr} />
            <input id="artifactVersionInput" type="text" placeholder="version，例如 v1" value="v1" ${disabledAttr} />
            <input id="artifactPathInput" type="text" placeholder="path，例如 /docs/prd.md" ${disabledAttr} />
            <input id="artifactProducerInput" type="text" placeholder="producer，例如 rd_lead" value="${safe(detail.owner || 'dashboard-ui')}" ${disabledAttr} />
            <textarea id="artifactSummaryInput" placeholder="artifact summary" ${disabledAttr}></textarea>
          </div>
          <div class="detail-actions">
            <button class="btn" id="addArtifactBtn" ${disabledAttr}>添加关键产物</button>
          </div>
          <div class="op-grid" style="margin-top:14px;">
            <input id="handoffStageIdInput" type="number" min="1" step="1" value="${safe(stageCard?.stage_id || 1)}" ${disabledAttr} />
            <input id="handoffNextOwnerInput" type="text" placeholder="next owner，例如 rd_tester" value="${safe(stageCard?.next_owner || detail.next_agent || '')}" ${disabledAttr} />
            <textarea id="handoffNoteInput" placeholder="handoff note" ${disabledAttr}></textarea>
            <textarea id="handoffArtifactSummaryInput" placeholder="artifact summary for handoff" ${disabledAttr}></textarea>
          </div>
          <div class="detail-actions">
            <button class="btn primary" id="handoffStageBtn" ${disabledAttr}>提交阶段交接</button>
          </div>
        </div>

        ${detail.raw?.review?.review_id ? `
        <div class="box">
          <h3>关联审查</h3>
          <a href="task_dashboard.html?task_id=${encodeURIComponent(detail.raw.review.review_id)}" class="btn" target="_blank" rel="noopener">在任务中心查看审查</a>
          <div class="mono" style="margin-top:8px;">${safe(detail.raw.review.review_id)}</div>
        </div>
        ` : ''}
        ${state.diagnosticMode ? `
        <details class="box" open>
          <summary><strong>诊断元数据</strong></summary>
          <div class="mono" style="margin-top:8px;">routing: ${safe(JSON.stringify(detail.raw?.routing || null))}</div>
          <div class="mono">review: ${safe(JSON.stringify(detail.raw?.review || null))}</div>
          <div class="mono">learning: ${safe(JSON.stringify(detail.raw?.learning || null))}</div>
        </details>
        ` : `
        <div class="box">
          <h3>诊断入口</h3>
          <a class="btn" href="task_dashboard.html?task_id=${encodeURIComponent(detail.task_id)}&pool=${encodeURIComponent(state.currentPool)}${state.showHistory ? '&include_history=1' : ''}&diagnostic=1">开启诊断模式查看原始元数据</a>
        </div>
        `}
      `;

  if (detail.task_type === 'review_task') {
    return `
          ${closureHtml}
          <div class="box">
            <h3>${safe(detail.task_name)}</h3>
            <div class="mono">${safe(detail.task_id)} · 审查任务</div>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <span class="badge ${stClass}">${stText}</span>
              <span class="runtime-pill"><span class="pulse ${rtClass}"></span>运行态: ${safe(detail.runtime_state)} / ${safe(detail.runtime_hint)}</span>
              <span class="runtime-pill">任务池: ${safe(detail.task_pool)}</span>
            </div>
            <div style="margin-top:10px;font-size:13px;color:var(--muted);">${safe(detail.description)}</div>
            <div class="detail-actions">
              <button class="btn warn" id="reclaimReviewBtn">回收审查</button>
            </div>
          </div>
          <div class="box">
            <h3>Chief 决议</h3>
            <div class="mono">${safe(JSON.stringify(chiefDecision || null))}</div>
          </div>
          <div class="box">
            <h3>Reviewer Packets</h3>
            ${reviewPackets.length ? `<ul class="audit-list">${reviewPackets
      .map((p: any) => `<li>${safe(p.reviewer_id)} · ${safe(p.verdict)} · ${safe((p.findings || []).join(' / '))}</li>`)
      .join('')}</ul>` : '<div class="empty">暂无 reviewer packet</div>'}
          </div>
          <div class="box">
            <h3>恢复审计</h3>
            ${renderControlAudit(detail.control_audit)}
          </div>
        `;
  }

  return coreHtml;
}
