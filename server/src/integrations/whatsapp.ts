import { httpCall, need } from './http.js';
import type { JobResult } from './worker.js';

/** Meta WhatsApp Cloud API */
export async function sendWhatsapp(cfg: Record<string, string>, mode: 'test' | 'live', to: string, text: string): Promise<JobResult> {
  if (mode === 'test') return { ok: true, simulated: true, response: { to, text } };
  need(cfg, 'phoneNumberId', 'accessToken');
  const body = cfg.templateName
    ? {
        messaging_product: 'whatsapp', to: '90' + to, type: 'template',
        template: { name: cfg.templateName, language: { code: cfg.templateLang || 'tr' }, components: [{ type: 'body', parameters: [{ type: 'text', text }] }] },
      }
    : { messaging_product: 'whatsapp', to: '90' + to, type: 'text', text: { body: text } };
  const r = await httpCall(`https://graph.facebook.com/v19.0/${cfg.phoneNumberId}/messages`, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.accessToken },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, response: r.text.slice(0, 1000), fatal: r.status === 400 || r.status === 401 };
}
