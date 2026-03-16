import { buildTaskRouteUrl, parseTaskRoute } from '../shared/task_utils';

export type TaskDashboardState = {
  currentFilter: string;
  currentPool: string;
  selectedTaskId: string | null;
  actionInProgress: boolean;
  lastSince: string | null;
  showHistory: boolean;
  diagnosticMode: boolean;
};

export const state: TaskDashboardState = {
  currentFilter: 'in_progress',
  currentPool: 'running',
  selectedTaskId: null,
  actionInProgress: false,
  lastSince: null,
  showHistory: false,
  diagnosticMode: false,
};

export function applyRouteFromQuery(): void {
  const route = parseTaskRoute(window.location.search);
  state.showHistory = route.showHistory;
  state.diagnosticMode = route.diagnosticMode;
  state.selectedTaskId = route.selectedTaskId;
  state.currentFilter = route.currentFilter;
  state.currentPool = route.currentPool;
}

export function syncRouteState(): void {
  const nextUrl = buildTaskRouteUrl(window.location.href, {
    showHistory: state.showHistory,
    diagnosticMode: state.diagnosticMode,
    currentPool: state.currentPool,
    selectedTaskId: state.selectedTaskId,
    currentFilter: state.currentFilter,
  });
  window.history.replaceState({}, '', nextUrl);
}

export function activatePool(pool: string): void {
  document.querySelectorAll('.pool-tab[data-pool]').forEach((el) => {
    const element = el as HTMLElement;
    if (element.dataset.pool === pool) element.classList.add('active');
    else element.classList.remove('active');
  });
  syncRouteState();
}

export function buildTaskPath(): string {
  const params = new URLSearchParams();
  if (state.showHistory) params.set('include_history', '1');
  if (state.currentPool === 'running') params.set('status', 'in_progress');
  else if (state.currentPool === 'completed') params.set('status', 'completed');
  else if (state.currentPool && state.currentPool !== 'all') params.set('task_pool', state.currentPool);
  else if (state.currentFilter !== 'all') params.set('status', state.currentFilter);
  const query = params.toString();
  return query ? `/api/tasks?${query}` : '/api/tasks';
}
