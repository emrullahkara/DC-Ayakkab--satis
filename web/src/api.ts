/** Sunucu ile konuşan tek nokta. Hatalar Türkçe mesajla fırlatılır. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('dc_token');
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Sunucu hatası', data?.details);
  return data as T;
}

export const api = {
  get: <T = any>(url: string, params?: Record<string, unknown>) => {
    const q = params
      ? '?' + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
      : '';
    return call<T>('GET', url + (q === '?' ? '' : q));
  },
  post: <T = any>(url: string, body?: unknown) => call<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => call<T>('PUT', url, body ?? {}),
  del: <T = any>(url: string) => call<T>('DELETE', url),
};
