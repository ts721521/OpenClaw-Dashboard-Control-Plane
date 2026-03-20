import { getJson, postJson } from '../shared/http';
import { safe } from '../shared/task_utils';
import { TaskDashboardState } from './state';
import { renderTaskDetailHtml } from './render';

const API = `${window.location.protocol}//${window.location.host}`;

export async function waitControlJob(jobId: string, timeoutMs = 60000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = await getJson<any>(`${API}/api/task/control-status?job_id=${encodeURIComponent(jobId)}`, 8000);
    if (!st.ok) throw new Error(st.error || '控制任务状态查询失败');
    if (st.state === 'finished' || st.state === 'failed') return st;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('控制操作超时，请稍后刷新查看最终状态');
}

export async function taskAction(taskId: string, action: 'stop' | 'restart', state: TaskDashboardState): Promise<void> {
  const opText = action === 'stop' ? '停止' : '重启';
  const ok = window.confirm(`确认${opText}任务 ${taskId} ?`);
  if (!ok) return;
  state.actionInProgress = true;
  try {
    const submit = await postJson<any>(`${API}/api/task/control`, {
      task_id: taskId,
      action,
      operator: 'dashboard-ui',
      operator_role: 'admin',
      reason: 'manual_click',
      async: true,
    }, 10000);
    if (!submit.ok) {
      alert(`操作失败: ${safe(submit.error || submit.message)}`);
      return;
    }
    const done = await waitControlJob(submit.job_id, 60000);
    const result = done?.result || {};
    if (!result.ok) {
      alert(`${opText}失败: ${safe(result.error || done.error || done.state)}`);
      return;
    }
    alert(`${opText}已执行（模式: ${safe(result.mode || 'unknown')}）`);
  } finally {
    state.actionInProgress = false;
  }
}

export async function deleteTask(taskId: string, state: TaskDashboardState): Promise<string | null> {
  const ok = window.confirm(`确认归档删除任务 ${taskId} ? 可在后端恢复。`);
  if (!ok) return null;
  state.actionInProgress = true;
  try {
    const res = await postJson<any>(`${API}/api/task/delete`, {
      task_id: taskId,
      operator: 'dashboard-ui',
      operator_role: 'admin',
      reason: 'manual_delete',
    }, 20000);
    if (!res.ok) {
      alert(`删除失败: ${safe(res.error || res.message)}`);
      return null;
    }
    return res.archive_path || null;
  } finally {
    state.actionInProgress = false;
  }
}

export async function claimTask(taskId: string): Promise<any> {
  const res = await postJson<any>(`${API}/api/tasks/${encodeURIComponent(taskId)}/claim`, {
    actor_id: 'dashboard-ui',
    actor_role: 'admin',
    actor_team: 'team-rd',
  }, 12000);
  if (!res.ok) throw new Error(res.error || '领取失败');
  return res;
}

export async function suggestDispatch(taskId: string): Promise<any> {
  const res = await postJson<any>(`${API}/api/tasks/${encodeURIComponent(taskId)}/dispatch-suggest`, {
    actor_id: 'dashboard-ui',
    actor_role: 'admin',
  }, 12000);
  if (!res.ok) throw new Error(res.error || '建议失败');
  return res;
}

export async function confirmDispatch(taskId: string, assignedTo: string | null): Promise<any> {
  const payload: Record<string, string | boolean | null> = {
    actor_id: 'dashboard-ui',
    actor_role: 'admin',
    confirm: true,
  };
  if (assignedTo) payload.assigned_to = assignedTo;
  const res = await postJson<any>(`${API}/api/tasks/${encodeURIComponent(taskId)}/dispatch-confirm`, payload, 12000);
  if (!res.ok) throw new Error(res.error || '确认失败');
  return res;
}

export async function applyRecommendedAction(taskId: string): Promise<any> {
  const res = await postJson<any>(`${API}/api/tasks/${encodeURIComponent(taskId)}/apply-recommended-action`, {
    actor_id: 'dashboard-ui',
    actor_role: 'admin',
  }, 12000);
  if (!res.ok) throw new Error(res.error || '应用建议失败');
  return res;
}

export async function renderDetail(taskId: string, state: TaskDashboardState): Promise<void> {
  const root = document.getElementById('detail');
  if (!root) return;
  root.innerHTML = '<div class="empty">加载中...</div>';
  const detail = await getJson<any>(`${API}/api/task/detail?task_id=${encodeURIComponent(taskId)}`, 12000);
  if (detail.error) {
    root.innerHTML = '<div class="empty">无历史数据</div>';
    return;
  }

  root.innerHTML = renderTaskDetailHtml(detail, state);

  const openBtn = document.getElementById('openChatBtn');
  const claimBtn = document.getElementById('claimTaskBtn');
  const suggestBtn = document.getElementById('suggestDispatchBtn');
  const confirmBtn = document.getElementById('confirmDispatchBtn');
  const stopBtn = document.getElementById('stopTaskBtn');
  const restartBtn = document.getElementById('restartTaskBtn');
  const delBtn = document.getElementById('deleteTaskBtn');
  const reclaimReviewBtn = document.getElementById('reclaimReviewBtn');
  const addArtifactBtn = document.getElementById('addArtifactBtn');
  const handoffStageBtn = document.getElementById('handoffStageBtn');
  const applyRecommendedActionBtn = document.getElementById('applyRecommendedActionBtn');

  claimBtn?.addEventListener('click', async () => {
    try {
      const res = await claimTask(taskId);
      alert(`领取成功: ${safe(res.claimed_by)}`);
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`领取失败: ${safe(error.message)}`);
    }
  });

  suggestBtn?.addEventListener('click', async () => {
    try {
      const res = await suggestDispatch(taskId);
      const sg = res?.suggestion || {};
      alert(`建议已生成: ${safe(sg.recommended_agent)} (${safe(sg.recommended_role)})`);
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`建议失败: ${safe(error.message)}`);
    }
  });

  confirmBtn?.addEventListener('click', async () => {
    try {
      const target = detail?.raw?.dispatch_suggestion?.recommended_agent || null;
      await confirmDispatch(taskId, target);
      alert(`已确认分发${target ? `: ${target}` : ''}`);
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`确认失败: ${safe(error.message)}`);
    }
  });

  openBtn?.addEventListener('click', async () => {
    try {
      const latest = await getJson<any>(`${API}/api/task/chat-link?task_id=${encodeURIComponent(taskId)}`, 10000);
      const url = latest?.url || detail?.session_link?.url;
      if (!url) {
        alert('没有可用会话链接');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const error = err as Error;
      alert(`打开会话失败: ${safe(error.message)}`);
    }
  });

  stopBtn?.addEventListener('click', async () => {
    try {
      await taskAction(taskId, 'stop', state);
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`停止失败: ${safe(error.message)}`);
    }
  });

  restartBtn?.addEventListener('click', async () => {
    try {
      await taskAction(taskId, 'restart', state);
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`重启失败: ${safe(error.message)}`);
    }
  });

  delBtn?.addEventListener('click', async () => {
    try {
      const archivePath = await deleteTask(taskId, state);
      if (!archivePath) return;
      state.selectedTaskId = null;
      await refreshAll(state);
      alert(`任务已归档删除\n${safe(archivePath)}`);
    } catch (err) {
      const error = err as Error;
      alert(`删除失败: ${safe(error.message)}`);
    }
  });

  applyRecommendedActionBtn?.addEventListener('click', async () => {
    try {
      const res = await applyRecommendedAction(taskId);
      alert(`已应用建议: ${safe(res.applied_action || detail?.next_recommended_action)}`);
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`应用建议失败: ${safe(error.message)}`);
    }
  });

  addArtifactBtn?.addEventListener('click', async () => {
    try {
      const res = await postJson<any>(`${API}/api/tasks/${encodeURIComponent(taskId)}/artifact`, {
        actor_id: 'dashboard-ui',
        actor_role: 'admin',
        artifact_type: (document.getElementById('artifactTypeInput') as HTMLInputElement | null)?.value?.trim(),
        path: (document.getElementById('artifactPathInput') as HTMLInputElement | null)?.value?.trim(),
        version: (document.getElementById('artifactVersionInput') as HTMLInputElement | null)?.value?.trim(),
        summary: (document.getElementById('artifactSummaryInput') as HTMLTextAreaElement | null)?.value?.trim(),
        producer: (document.getElementById('artifactProducerInput') as HTMLInputElement | null)?.value?.trim(),
      }, 12000);
      if (!res.ok) throw new Error(res.error || '添加失败');
      alert(`关键产物已添加: ${safe(res.artifact?.artifact_type)}`);
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`添加产物失败: ${safe(error.message)}`);
    }
  });

  handoffStageBtn?.addEventListener('click', async () => {
    try {
      const stageId = (document.getElementById('handoffStageIdInput') as HTMLInputElement | null)?.value?.trim();
      const res = await postJson<any>(`${API}/api/tasks/${encodeURIComponent(taskId)}/stage/${encodeURIComponent(stageId || '')}/handoff`, {
        actor_id: 'dashboard-ui',
        actor_role: 'admin',
        handoff_note: (document.getElementById('handoffNoteInput') as HTMLTextAreaElement | null)?.value?.trim(),
        artifact_summary: (document.getElementById('handoffArtifactSummaryInput') as HTMLTextAreaElement | null)?.value?.trim(),
        next_owner: (document.getElementById('handoffNextOwnerInput') as HTMLInputElement | null)?.value?.trim(),
      }, 12000);
      if (!res.ok) throw new Error(res.error || '交接失败');
      alert('阶段交接已提交');
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`阶段交接失败: ${safe(error.message)}`);
    }
  });

  reclaimReviewBtn?.addEventListener('click', async () => {
    try {
      const res = await postJson<any>(`${API}/api/reviews/${encodeURIComponent(taskId)}/reclaim`, {
        actor_id: 'luban',
        actor_role: 'admin',
        action: 'reclaim',
      }, 12000);
      if (!res.ok) throw new Error(res.error || '回收失败');
      alert('审查已回收到恢复队列');
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`回收失败: ${safe(error.message)}`);
    }
  });
}

export async function loadTasks(state: TaskDashboardState): Promise<void> {
  let list: any[] = [];
  let updatedAt: number | string = Date.now();

  if (state.currentPool === 'review_pool' || state.currentPool === 'recovery_pool') {
    const poolData = await getJson<any>(`${API}/api/task-pools`, 12000);
    list = (poolData.pools || {})[state.currentPool] || [];
    updatedAt = poolData.updated_at || Date.now();
  } else {
    const path = buildTaskPath(state);
    const data = await getJson<any>(`${API}${path}`, 12000);
    list = data.tasks || [];
    if (data.next_since) state.lastSince = data.next_since;
    updatedAt = data.updated_at || Date.now();
  }

  const updatedEl = document.getElementById('updatedAt');
  if (updatedEl) updatedEl.textContent = new Date(updatedAt).toLocaleString('zh-CN');

  const root = document.getElementById('taskList');
  if (!root) return;
  if (!list.length) {
    root.innerHTML = '<div class="empty">当前过滤条件下无任务。</div>';
    const detailRoot = document.getElementById('detail');
    if (detailRoot) detailRoot.innerHTML = '<div class="empty">无历史数据</div>';
    state.selectedTaskId = null;
    syncRouteState(state);
    return;
  }

  root.innerHTML = renderTaskList(list, state.selectedTaskId);

  root.querySelectorAll('.task').forEach((el) => {
    el.addEventListener('click', async () => {
      const element = el as HTMLElement;
      state.selectedTaskId = element.dataset.id || null;
      syncRouteState(state);
      try {
        if (state.selectedTaskId) {
          await renderDetail(state.selectedTaskId, state);
        }
        await loadTasks(state);
      } catch (err) {
        const error = err as Error;
        const detailRoot = document.getElementById('detail');
        if (detailRoot) detailRoot.innerHTML = `<div class="empty">详情加载失败: ${safe(error.message)}</div>`;
      }
    });
  });

  if (state.selectedTaskId && list.some((t) => t.task_id === state.selectedTaskId)) {
    await renderDetail(state.selectedTaskId, state);
  } else if (!state.selectedTaskId) {
    state.selectedTaskId = list[0].task_id;
    syncRouteState(state);
    await renderDetail(state.selectedTaskId, state);
    await loadTasks(state);
  }
}

export async function refreshAll(state: TaskDashboardState): Promise<void> {
  await loadTasks(state);
}

function buildTaskPath(state: TaskDashboardState): string {
  const params = new URLSearchParams();
  if (state.showHistory) params.set('include_history', '1');
  if (state.currentPool === 'running') params.set('status', 'in_progress');
  else if (state.currentPool === 'completed') params.set('status', 'completed');
  else if (state.currentPool && state.currentPool !== 'all') params.set('task_pool', state.currentPool);
  else if (state.currentFilter !== 'all') params.set('status', state.currentFilter);
  const query = params.toString();
  return query ? `/api/tasks?${query}` : '/api/tasks';
}

function syncRouteState(state: TaskDashboardState): void {
  const params = new URLSearchParams();
  if (state.showHistory) params.set('include_history', '1');
  if (state.diagnosticMode) params.set('diagnostic', '1');
  if (state.currentPool && state.currentPool !== 'running') params.set('pool', state.currentPool);
  if (state.selectedTaskId) params.set('task_id', state.selectedTaskId);
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', nextUrl);
}
