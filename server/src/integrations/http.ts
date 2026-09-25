/** Dış servis çağrıları için küçük yardımcı: zaman aşımı, JSON/XML gövde, hata metni */
export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
  json?: unknown;
}

export async function httpCall(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<HttpResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetch(url, { method: opts.method ?? 'POST', headers: opts.headers, body: opts.body, signal: ctrl.signal });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      /* JSON değil */
    }
    return { status: res.status, ok: res.ok, text: text.slice(0, 20000), json };
  } catch (e) {
    return { status: 0, ok: false, text: 'Bağlantı hatası: ' + (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export function basicAuth(user: string, pass: string) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export function need(cfg: Record<string, string>, ...keys: string[]) {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) throw new Error('Eksik ayar: ' + missing.join(', '));
}
