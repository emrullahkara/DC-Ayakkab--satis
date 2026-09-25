/**
 * Outbox işleyici: kuyruktaki işleri ilgili sağlayıcıya gönderir.
 * "test" modunda dış istek atılmaz; iş "simulated" olarak işaretlenir ve payload'ı görülebilir.
 * Hata olursa artan bekleme ile (1, 2, 4, ... dakika, en fazla 10 deneme) tekrar denenir.
 */
import { all, getDb, one, run } from '../db/index.js';
import { getIntegration } from './outbox.js';
import { buildInvoice, sendInvoice, cancelInvoice } from './einvoice.js';
import { sendToOkc } from './okc.js';
import { sendSms } from './sms.js';
import { sendWhatsapp } from './whatsapp.js';
import { marketplaceStock, marketplacePullOrders } from './marketplace.js';

interface Job {
  id: number;
  tenant_id: number;
  provider: string;
  action: string;
  payload: string;
  attempts: number;
  ref_type: string | null;
  ref_id: number | null;
}

export interface JobResult {
  ok: boolean;
  response?: unknown;
  /** Dış sisteme gerçekten gitmedi (test modu) */
  simulated?: boolean;
  /** true ise tekrar denenmez */
  fatal?: boolean;
}

export type Handler = (tenantId: number, cfg: Record<string, string>, mode: 'test' | 'live', payload: Record<string, unknown>) => Promise<JobResult>;

const handlers: Record<string, Handler> = {
  'einvoice:send_invoice': async (t, cfg, mode, p) => {
    const inv = buildInvoice(t, Number(p.saleId), cfg);
    if (!inv) return { ok: false, fatal: true, response: 'Satış bulunamadı veya iptal edilmiş' };
    if (mode === 'test') {
      run("UPDATE sales SET einvoice_status = 'simulated', einvoice_no = ? WHERE id = ?", inv.invoiceNo, p.saleId);
      return { ok: true, simulated: true, response: { invoiceNo: inv.invoiceNo, xml: inv.xml.slice(0, 4000) } };
    }
    const r = await sendInvoice(cfg, inv);
    run("UPDATE sales SET einvoice_status = ?, einvoice_no = ? WHERE id = ?", r.ok ? 'sent' : 'error', r.ok ? inv.invoiceNo : null, p.saleId);
    return r;
  },
  'einvoice:cancel_invoice': async (t, cfg, mode, p) => {
    const s = one<{ einvoice_no: string | null }>('SELECT einvoice_no FROM sales WHERE id = ? AND tenant_id = ?', p.saleId, t);
    if (!s?.einvoice_no) return { ok: true, response: 'Fatura numarası yok' };
    if (mode === 'test') return { ok: true, simulated: true, response: { cancelled: s.einvoice_no } };
    return cancelInvoice(cfg, s.einvoice_no);
  },
  'okc:send_sale': async (t, cfg, mode, p) => {
    const r = await sendToOkc(t, cfg, mode, Number(p.saleId));
    run('UPDATE sales SET okc_status = ? WHERE id = ?', r.ok ? (r.simulated ? 'simulated' : 'sent') : 'error', p.saleId);
    return r;
  },
  'sms:send': (t, cfg, mode, p) => sendSms(cfg, mode, String(p.to), String(p.text)),
  'whatsapp:send': (t, cfg, mode, p) => sendWhatsapp(cfg, mode, String(p.to), String(p.text)),
};
for (const m of ['trendyol', 'hepsiburada', 'n11']) {
  handlers[`marketplace_${m}:stock_update`] = (t, cfg, mode, p) => marketplaceStock(m, t, cfg, mode, Number(p.variantId));
  handlers[`marketplace_${m}:pull_orders`] = (t, cfg, mode) => marketplacePullOrders(m, t, cfg, mode);
}

export async function processJob(job: Job): Promise<JobResult> {
  const key = `${job.provider}:${job.action}`;
  const h = handlers[key];
  if (!h) return { ok: false, fatal: true, response: 'Bilinmeyen iş: ' + key };
  const integ = getIntegration(job.tenant_id, job.provider);
  if (!integ?.enabled) return { ok: false, fatal: true, response: 'Entegrasyon kapalı' };
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(job.payload);
  } catch {
    return { ok: false, fatal: true, response: 'Bozuk payload' };
  }
  try {
    return await h(job.tenant_id, integ.config, integ.mode, payload);
  } catch (e) {
    return { ok: false, response: (e as Error).message };
  }
}

let running = false;

/** Bekleyen işleri sırayla işler. Aynı anda tek çalışır. */
export async function runOutboxOnce(limit = 50): Promise<number> {
  if (running) return 0;
  running = true;
  let done = 0;
  try {
    const jobs = all<Job>(
      "SELECT * FROM outbox WHERE status = 'pending' AND next_try_at <= datetime('now','localtime') ORDER BY id LIMIT ?",
      limit,
    );
    for (const job of jobs) {
      const r = await processJob(job);
      const attempts = job.attempts + 1;
      const resp = typeof r.response === 'string' ? r.response : JSON.stringify(r.response ?? null);
      if (r.ok) {
        run("UPDATE outbox SET status = ?, attempts = ?, response = ?, updated_at = datetime('now','localtime') WHERE id = ?", r.simulated ? 'simulated' : 'done', attempts, resp, job.id);
      } else if (r.fatal || attempts >= 10) {
        run("UPDATE outbox SET status = 'error', attempts = ?, response = ?, updated_at = datetime('now','localtime') WHERE id = ?", attempts, resp, job.id);
      } else {
        const minutes = Math.min(60, 2 ** (attempts - 1));
        run(
          "UPDATE outbox SET attempts = ?, response = ?, next_try_at = datetime('now','localtime', ?), updated_at = datetime('now','localtime') WHERE id = ?",
          attempts, resp, `+${minutes} minutes`, job.id,
        );
      }
      done++;
    }
  } finally {
    running = false;
  }
  return done;
}

/** Hatalı işi tekrar kuyruğa alır */
export function retryJob(tenantId: number, id: number) {
  const r = run(
    "UPDATE outbox SET status = 'pending', attempts = 0, next_try_at = datetime('now','localtime') WHERE id = ? AND tenant_id = ? AND status IN ('error','simulated')",
    id, tenantId,
  );
  return r.changes > 0;
}

/** Pazaryeri sipariş çekme işlerini periyodik olarak kuyruğa ekler */
export function scheduleMarketplacePolls() {
  const rows = all<{ tenant_id: number; provider: string }>(
    "SELECT tenant_id, provider FROM integration_settings WHERE enabled = 1 AND provider LIKE 'marketplace_%'",
  );
  const db = getDb();
  for (const r of rows) {
    const pending = db
      .prepare("SELECT 1 FROM outbox WHERE tenant_id = ? AND provider = ? AND action = 'pull_orders' AND status = 'pending'")
      .get(r.tenant_id, r.provider);
    if (!pending) run('INSERT INTO outbox (tenant_id, provider, action, payload) VALUES (?,?,?,?)', r.tenant_id, r.provider, 'pull_orders', '{}');
  }
}
