import { all, one } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { badRequest } from '../utils/errors.js';
import { enqueue, isEnabled } from '../integrations/outbox.js';
import { audit } from './audit.js';

export type Channel = 'sms' | 'whatsapp';

export function fillTemplate(text: string, vars: Record<string, string | number | null | undefined>) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function availableChannels(tenantId: number): Channel[] {
  return (['sms', 'whatsapp'] as Channel[]).filter((c) => isEnabled(tenantId, c));
}

export function sendMessage(tenantId: number, channel: Channel, to: string, text: string, ref?: { type: string; id: number }) {
  if (!isEnabled(tenantId, channel)) throw badRequest((channel === 'sms' ? 'SMS' : 'WhatsApp') + ' entegrasyonu açık değil (Ayarlar > Entegrasyonlar)');
  const phone = to.replace(/\D/g, '').replace(/^0/, '').replace(/^90(?=\d{10}$)/, '');
  if (phone.length !== 10) throw badRequest('Telefon numarası geçersiz: ' + to);
  if (!text.trim()) throw badRequest('Mesaj boş');
  return enqueue(tenantId, channel, 'send', { to: phone, text: text.trim() }, ref);
}

/** Toplu mesaj: sadece ileti izni (sms_consent) olan müşterilere */
export function bulkMessage(user: AuthUser, input: { channel: Channel; customerIds: number[]; text: string }) {
  if (!input.customerIds?.length) throw badRequest('Müşteri seçilmedi');
  if (input.customerIds.length > 5000) throw badRequest('Tek seferde en fazla 5000 müşteri');
  const tenant = one<{ name: string }>('SELECT name FROM tenants WHERE id = ?', user.tenantId)!;
  const rows = all<{ id: number; name: string; phone: string | null; sms_consent: number; points: number }>(
    `SELECT id, name, phone, sms_consent, points FROM customers WHERE tenant_id = ? AND id IN (${input.customerIds.map((n) => Number(n) | 0).join(',')})`,
    user.tenantId,
  );
  let sent = 0;
  const skipped: string[] = [];
  for (const c of rows) {
    if (!c.phone || !c.sms_consent) {
      skipped.push(c.name);
      continue;
    }
    const text = fillTemplate(input.text, { ad: c.name.split(' ')[0], adsoyad: c.name, puan: (c.points / 100).toFixed(2), firma: tenant.name });
    sendMessage(user.tenantId, input.channel, c.phone, text, { type: 'customer', id: c.id });
    sent++;
  }
  audit(user, user.tenantId, 'message.bulk', 'customer', null, { channel: input.channel, sent, skipped: skipped.length });
  return { sent, skipped };
}
