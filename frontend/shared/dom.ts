export function $(selector: string, root: ParentNode = document): Element | null {
  return root.querySelector(selector);
}

export function $all(selector: string, root: ParentNode = document): Element[] {
  return Array.from(root.querySelectorAll(selector));
}

export function setText(el: Element | null, value: string): void {
  if (el) el.textContent = value;
}
