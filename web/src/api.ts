export class ApiErr extends Error {
  constructor(public status: number, public code: string, public field?: string, public params?: Record<string, unknown>, public body?: any) {
    super(code);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-requested-with': '8star-prep' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiErr(0, 'network_error');
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && json?.error === 'unauthenticated') onUnauthorized();
    throw new ApiErr(res.status, json?.error ?? 'server_error', json?.field, json?.params, json);
  }
  return json as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const del = <T = any>(p: string) => api<T>('DELETE', p);
