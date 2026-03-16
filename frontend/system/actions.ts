import { getJson, postJson } from '../shared/http';

const API = `${window.location.protocol}//${window.location.host}`;

export async function fetchJSON(path: string): Promise<any> {
  return getJson<any>(`${API}${path}`);
}

export async function postJSON(path: string, payload: unknown): Promise<any> {
  return postJson<any>(`${API}${path}`, payload);
}
