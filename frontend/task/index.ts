import { applyRouteFromQuery, activatePool, state, syncRouteState } from './state';
import { loadTasks, refreshAll } from './actions';

(window as any).__TASK_DASHBOARD_BOOTSTRAP__ = true;

function bindPoolTabs(): void {
  document.querySelectorAll('.pool-tab[data-pool]').forEach((el) => {
    el.addEventListener('click', async () => {
      const element = el as HTMLElement;
      state.currentPool = element.dataset.pool || 'all';
      if (state.currentPool === 'running') state.currentFilter = 'in_progress';
      else if (state.currentPool === 'completed') state.currentFilter = 'completed';
      else state.currentFilter = 'all';
      state.selectedTaskId = null;
      activatePool(state.currentPool);
      await loadTasks(state);
    });
  });
}

function bindRefresh(): void {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn?.addEventListener('click', async () => {
    try {
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`刷新失败: ${error.message}`);
    }
  });
}

function bindHistoryToggle(): void {
  const toggle = document.getElementById('historyToggle') as HTMLInputElement | null;
  toggle?.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    state.showHistory = Boolean(target?.checked);
    state.selectedTaskId = null;
    syncRouteState();
    try {
      await refreshAll(state);
    } catch (err) {
      const error = err as Error;
      alert(`切换失败: ${error.message}`);
    }
  });
}

async function init(): Promise<void> {
  try {
    applyRouteFromQuery();
    activatePool(state.currentPool);
    const toggle = document.getElementById('historyToggle') as HTMLInputElement | null;
    if (toggle) toggle.checked = state.showHistory;
    bindPoolTabs();
    bindRefresh();
    bindHistoryToggle();
    await refreshAll(state);
    syncRouteState();
    setInterval(async () => {
      if (state.actionInProgress) return;
      try {
        await refreshAll(state);
      } catch {
        // ignore refresh errors in background
      }
    }, 20000);
  } catch (err) {
    console.error(err);
    const error = err as Error;
    alert(`加载失败: ${error.message}`);
  }
}

void init();
