export type GateIssue = { level: string; title: string; body: string };

type TaskRoute = {
  showHistory: boolean;
  diagnosticMode: boolean;
  selectedTaskId: string | null;
  currentFilter: string;
  currentPool: string;
};

export function safe(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export function statusBadge(status: string): [string, string] {
  if (status === 'completed') return ['已完成', 's-completed'];
  if (status === 'in_progress') return ['进行中', 's-in_progress'];
  if (status === 'pending') return ['待开始', 's-pending'];
  return [safe(status), 's-unknown'];
}

export function healthLabel(health: { status?: string } | null | undefined): [string, string] {
  const st = health && health.status ? health.status : 'unknown';
  if (st === 'healthy') return ['健康', 'healthy'];
  if (st === 'warning') return ['预警', 'warning'];
  if (st === 'stale') return ['滞后', 'stale'];
  return ['未知', 'unknown'];
}

export function runtimeClass(runtimeState: string): string {
  if (runtimeState === 'running') return 'running';
  if (runtimeState === 'stalled') return 'stalled';
  if (runtimeState === 'idle') return 'idle';
  return 'unknown';
}

export function parseTaskRoute(search: string): TaskRoute {
  const params = new URLSearchParams(search || '');
  const route: TaskRoute = {
    showHistory: params.get('include_history') === '1',
    diagnosticMode: params.get('diagnostic') === '1',
    selectedTaskId: null,
    currentFilter: 'in_progress',
    currentPool: 'running',
  };
  if (params.get('task_id')) {
    route.selectedTaskId = params.get('task_id');
    route.currentFilter = 'all';
    route.currentPool = params.get('pool') || 'all';
    return route;
  }
  if (params.get('pool')) {
    route.currentPool = params.get('pool') || 'all';
    if (route.currentPool === 'running') route.currentFilter = 'in_progress';
    else if (route.currentPool === 'completed') route.currentFilter = 'completed';
    else route.currentFilter = 'all';
  }
  return route;
}

export function buildTaskRouteUrl(locationHref: string, state: TaskRoute): string {
  const url = new URL(locationHref);
  if (state.showHistory) url.searchParams.set('include_history', '1');
  else url.searchParams.delete('include_history');
  if (state.diagnosticMode) url.searchParams.set('diagnostic', '1');
  else url.searchParams.delete('diagnostic');
  if (state.currentPool && state.currentPool !== 'running') url.searchParams.set('pool', state.currentPool);
  else url.searchParams.delete('pool');
  if (state.selectedTaskId) url.searchParams.set('task_id', state.selectedTaskId);
  else url.searchParams.delete('task_id');
  return url.toString();
}

export function activeStageCard(detail: any): any {
  const cards = Array.isArray(detail && detail.stage_cards) ? detail.stage_cards : [];
  return cards.find((item: any) => item.status !== 'completed') || cards[cards.length - 1] || null;
}

export function buildGateIssues(detail: any): GateIssue[] {
  const issues: GateIssue[] = [];
  if (detail && detail.business_bound && !detail.business_truth_source) {
    issues.push({
      level: 'danger',
      title: '缺少业务真相源',
      body: '该任务被标记为 business-bound，但缺少 business_truth_source，当前不应进入 completed。',
    });
  }
  if (detail && detail.business_bound && !detail.acceptance_result) {
    issues.push({
      level: 'warn',
      title: '缺少业务验收结果',
      body: '技术执行已推进，但 acceptance_result 为空。应停在 WAITING_INPUT 或 BLOCKED。',
    });
  }
  if (!detail || !detail.gate_result || detail.gate_result === 'REWORK') {
    issues.push({
      level: detail && detail.gate_result === 'REWORK' ? 'danger' : 'warn',
      title: 'Gate 尚未放行',
      body: '当前 gate_result 未明确放行，不应直接视为业务完成。',
    });
  }
  return issues;
}
