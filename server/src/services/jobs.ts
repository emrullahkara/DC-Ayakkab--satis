import { all, one, run } from '../db/index.js';
import { today } from '../utils/dates.js';
import { getSettings } from './settings.js';
import { availableChannels, fillTemplate, sendMessage } from './messages.js';

/** Günde bir çalışır: doğum günü mesajları */
export function dailyJobs() {
  const t = today();
  const tenants = all<{ id: number; name: string }>('SELECT id, name FROM tenants WHERE active = 1');
  for (const tenant of tenants) {
    const key = 'job:birthday:' + t;
    if (one('SELECT 1 FROM sequences WHERE tenant_id = ? AND key = ?', tenant.id, key)) continue;
    run('INSERT INTO sequences (tenant_id, key, value) VALUES (?,?,1)', tenant.id, key);
    run("DELETE FROM sequences WHERE tenant_id = ? AND key LIKE 'job:birthday:%' AND key <> ?", tenant.id, key);
    const s = getSettings(tenant.id);
    if (!s.messages.birthdayEnabled) continue;
    const ch = availableChannels(tenant.id)[0];
    if (!ch) continue;
    const rows = all<{ id: number; name: string; phone: string }>(
      `SELECT id, name, phone FROM customers WHERE tenant_id = ? AND active = 1 AND sms_consent = 1 AND phone IS NOT NULL
         AND birth_date IS NOT NULL AND strftime('%m-%d', birth_date) = strftime('%m-%d', ?)`,
      tenant.id, t,
    );
    for (const c of rows) {
      try {
        sendMessage(tenant.id, ch, c.phone, fillTemplate(s.messages.birthdayText, { ad: c.name.split(' ')[0], adsoyad: c.name, firma: tenant.name }), { type: 'customer', id: c.id });
      } catch (e) {
        console.error('doğum günü mesajı', c.id, (e as Error).message);
      }
    }
  }
}
