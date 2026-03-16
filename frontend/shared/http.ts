export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
