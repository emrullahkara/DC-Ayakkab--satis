import { httpCall, need } from './http.js';
import type { JobResult } from './worker.js';

export async function sendSms(cfg: Record<string, string>, mode: 'test' | 'live', to: string, text: string): Promise<JobResult> {
  if (mode === 'test') return { ok: true, simulated: true, response: { to, text } };
  const provider = cfg.provider || 'netgsm';
  if (provider === 'netgsm') {
    need(cfg, 'usercode', 'password', 'header');
    const url = new URL('https://api.netgsm.com.tr/sms/send/get');
    url.searchParams.set('usercode', cfg.usercode);
    url.searchParams.set('password', cfg.password);
    url.searchParams.set('gsmno', '90' + to);
    url.searchParams.set('message', text);
    url.searchParams.set('msgheader', cfg.header);
    url.searchParams.set('dil', 'TR');
    const r2 = await httpCall(url.toString(), { method: 'GET' });
    const code = r2.text.trim().split(' ')[0];
    const ok = r2.ok && ['00', '01', '02'].includes(code);
    return { ok, response: r2.text.slice(0, 500), fatal: !ok && ['20', '30', '40', '70'].includes(code) };
  }
  need(cfg, 'endpoint');
  const url = cfg.endpoint.replace('{tel}', encodeURIComponent(to)).replace('{mesaj}', encodeURIComponent(text));
  const r = await httpCall(url, {
    method: cfg.endpoint.includes('{mesaj}') ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.password ? { Authorization: 'Bearer ' + cfg.password } : {}) },
    body: cfg.endpoint.includes('{mesaj}') ? undefined : JSON.stringify({ to, text, from: cfg.header, user: cfg.usercode }),
  });
  return { ok: r.ok, response: r.text.slice(0, 500) };
}
