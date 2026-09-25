/**
 * Yeni nesil yazarkasa POS (ÖKC) köprüsü. Cihaz üreticilerinin (GMP3 uyumlu) mağaza bilgisayarına kurulan
 * yerel servisine satış bilgisini JSON olarak gönderir; cihaz mali fişi keser ve sonucu döner.
 */
import { all, one } from '../db/index.js';
import { httpCall } from './http.js';
import type { JobResult } from './worker.js';

const OKC_PAY: Record<string, string> = { cash: 'NAKIT', card: 'KREDI_KARTI', transfer: 'HAVALE', credit: 'ACIK_HESAP', giftcard: 'HEDIYE_CEKI', points: 'PUAN', deposit: 'KAPORA' };

export function buildOkcPayload(tenantId: number, saleId: number) {
  const s = one<Record<string, any>>('SELECT s.*, st.code store_code FROM sales s JOIN stores st ON st.id = s.store_id WHERE s.id = ? AND s.tenant_id = ?', saleId, tenantId);
  if (!s || s.status !== 'completed') return null;
  const items = all<Record<string, any>>(
    'SELECT si.*, p.name, p.code, v.barcode FROM sale_items si JOIN variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id WHERE si.sale_id = ?',
    saleId,
  );
  const pays = all<Record<string, any>>('SELECT * FROM sale_payments WHERE sale_id = ?', saleId);
  return {
    storeCode: s.store_code,
    receiptNo: s.receipt_no,
    type: s.total < 0 ? 'IADE' : 'SATIS',
    date: s.created_at,
    items: items.map((it) => ({
      barcode: it.barcode, name: `${it.code} ${it.name}`.slice(0, 40), qty: Math.abs(it.qty), unitPrice: it.unit_price / 100,
      discount: Math.abs(it.discount) / 100, total: Math.abs(it.line_total) / 100, vatRate: it.vat_rate,
    })),
    payments: pays.map((p) => ({ type: OKC_PAY[p.method] ?? 'DIGER', amount: Math.abs(p.amount) / 100, installments: p.installments })),
    total: Math.abs(s.total) / 100,
  };
}

export async function sendToOkc(tenantId: number, cfg: Record<string, string>, mode: 'test' | 'live', saleId: number): Promise<JobResult> {
  const payload = buildOkcPayload(tenantId, saleId);
  if (!payload) return { ok: false, fatal: true, response: 'Satış bulunamadı' };
  if (mode === 'test') return { ok: true, simulated: true, response: payload };
  if (!cfg.bridgeUrl) return { ok: false, fatal: true, response: 'Köprü adresi girilmemiş' };
  const url = cfg.bridgeUrl.replace('{magaza}', payload.storeCode).replace(/\/+$/, '') + '/sale';
  const r = await httpCall(url, {
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'X-Api-Key': cfg.apiKey } : {}) },
    body: JSON.stringify({ terminalId: cfg.terminalId, ...payload }),
    timeoutMs: 60000,
  });
  return { ok: r.ok, response: { status: r.status, body: r.text.slice(0, 2000) } };
}
