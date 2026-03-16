export function renderUpdatedAt(el: HTMLElement | null, updatedAt: number | string | null): void {
  if (!el || !updatedAt) return;
  el.textContent = new Date(updatedAt).toLocaleString('zh-CN');
}
