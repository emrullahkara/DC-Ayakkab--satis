/**
 * Pazaryeri entegrasyonu: barkod bazlı stok/fiyat gönderimi ve sipariş çekme.
 * Trendyol / Hepsiburada / N11 API'lerinin resmi uçları kullanılır; test modunda simüle edilir.
 */
import { one, run, tx, all } from '../db/index.js';
import { httpCall, basicAuth, need } from './http.js';
import type { JobResult } from './worker.js';
import { getSettings } from '../services/settings.js';
import { changeStock } from '../services/stock.js';
import { nextSeq } from '../utils/seq.js';

function variantInfo(tenantId: number, variantId: number) {
  return one<{ barcode: string; price: number; qty: number; code: string; name: string }>(
    `SELECT v.barcode, COALESCE(v.sale_price, p.sale_price) price, p.code, p.name,
            COALESCE((SELECT SUM(qty) FROM stock WHERE variant_id = v.id AND store_id = ?),0) qty
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.tenant_id = ?`,
    getSettings(tenantId).marketplace.storeId ?? -1, variantId, tenantId,
  );
}

export async function marketplaceStock(m: string, tenantId: number, cfg: Record<string, string>, mode: 'test' | 'live', variantId: number): Promise<JobResult> {
  const v = variantInfo(tenantId, variantId);
  if (!v) return { ok: false, fatal: true, response: 'Ürün bulunamadı' };
  const markup = Number(cfg.priceMarkup || 0);
  const price = Math.round((v.price * (100 + markup)) / 100) / 100;
  const qty = Math.max(0, v.qty);
  const payload = { barcode: v.barcode, quantity: qty, salePrice: price, listPrice: price };
  if (mode === 'test') return { ok: true, simulated: true, response: { marketplace: m, ...payload } };
  if (m === 'trendyol') {
    need(cfg, 'sellerId', 'apiKey', 'apiSecret');
    const r = await httpCall(`https://api.trendyol.com/sapigw/suppliers/${cfg.sellerId}/products/price-and-inventory`, {
      headers: { 'Content-Type': 'application/json', Authorization: basicAuth(cfg.apiKey, cfg.apiSecret), 'User-Agent': `${cfg.sellerId} - DCAyakkabi` },
      body: JSON.stringify({ items: [payload] }),
    });
    return { ok: r.ok, response: r.text.slice(0, 1000) };
  }
  if (m === 'hepsiburada') {
    need(cfg, 'merchantId', 'username', 'password');
    const r = await httpCall(`https://listing-external.hepsiburada.com/listings/merchantid/${cfg.merchantId}/inventory-uploads`, {
      headers: { 'Content-Type': 'application/json', Authorization: basicAuth(cfg.username, cfg.password) },
      body: JSON.stringify([{ hepsiburadaSku: v.barcode, merchantSku: v.barcode, availableStock: qty, price }]),
    });
    return { ok: r.ok, response: r.text.slice(0, 1000) };
  }
  if (m === 'n11') {
    need(cfg, 'appKey', 'appSecret', 'endpoint');
    const r = await httpCall(cfg.endpoint, {
      headers: { 'Content-Type': 'application/json', appkey: cfg.appKey, appsecret: cfg.appSecret },
      body: JSON.stringify({ stockCode: v.barcode, quantity: qty, price }),
    });
    return { ok: r.ok, response: r.text.slice(0, 1000) };
  }
  return { ok: false, fatal: true, response: 'Bilinmeyen pazaryeri' };
}

interface MpOrder {
  orderNo: string;
  lines: { barcode: string; qty: number; price: number }[];
  customerName?: string;
  raw?: unknown;
}

/** Pazaryeri siparişini sisteme satış olarak işler (stoktan düşer). Aynı sipariş ikinci kez işlenmez. */
export function importMarketplaceOrder(tenantId: number, m: string, o: MpOrder): 'imported' | 'exists' | 'skipped' {
  const provider = 'marketplace_' + m;
  if (one('SELECT 1 FROM marketplace_orders WHERE tenant_id = ? AND provider = ? AND order_no = ?', tenantId, provider, o.orderNo)) return 'exists';
  const storeId = getSettings(tenantId).marketplace.storeId;
  if (!storeId) return 'skipped';
  return tx(() => {
    const owner = one<{ id: number }>("SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' ORDER BY id LIMIT 1", tenantId);
    const store = one<{ code: string }>('SELECT code FROM stores WHERE id = ?', storeId);
    if (!owner || !store) return 'skipped';
    const receiptNo = `${store.code}-PZ-${String(nextSeq(tenantId, 'receipt:' + storeId)).padStart(6, '0')}`;
    let subtotal = 0, cost = 0, vat = 0, count = 0;
    const lines: { vid: number; qty: number; price: number; vat: number; cost: number }[] = [];
    for (const l of o.lines) {
      const v = one<{ id: number; vat_rate: number; cost_price: number }>(
        'SELECT v.id, p.vat_rate, p.cost_price FROM variants v JOIN products p ON p.id = v.product_id WHERE v.tenant_id = ? AND v.barcode = ?',
        tenantId, l.barcode,
      );
      if (!v) continue;
      const price = Math.round(l.price * 100);
      lines.push({ vid: v.id, qty: l.qty, price, vat: v.vat_rate, cost: v.cost_price });
      subtotal += price * l.qty;
      cost += v.cost_price * l.qty;
      vat += Math.round((price * l.qty * v.vat_rate) / (100 + v.vat_rate));
      count += l.qty;
    }
    if (!lines.length) {
      run('INSERT INTO marketplace_orders (tenant_id, provider, order_no, status, payload) VALUES (?,?,?,?,?)', tenantId, provider, o.orderNo, 'unmatched', JSON.stringify(o.raw ?? o));
      return 'skipped';
    }
    const r = run(
      `INSERT INTO sales (tenant_id, store_id, receipt_no, type, user_id, salesperson_id, subtotal, discount_total, total, vat_total, cost_total, item_count, note)
       VALUES (?,?,?,'sale',?,?,?,0,?,?,?,?,?)`,
      tenantId, storeId, receiptNo, owner.id, owner.id, subtotal, subtotal, vat, cost, count, `${m} siparişi ${o.orderNo}${o.customerName ? ' - ' + o.customerName : ''}`,
    );
    const saleId = Number(r.lastInsertRowid);
    for (const l of lines) {
      run('INSERT INTO sale_items (sale_id, variant_id, qty, unit_price, discount, line_total, vat_rate, unit_cost) VALUES (?,?,?,?,0,?,?,?)', saleId, l.vid, l.qty, l.price, l.price * l.qty, l.vat, l.cost);
      changeStock({ tenantId, storeId, variantId: l.vid, qty: -l.qty, type: 'marketplace', refType: 'sale', refId: saleId, unitCost: l.cost, note: `${m} ${o.orderNo}` });
    }
    run("INSERT INTO sale_payments (sale_id, method, amount, ref) VALUES (?,'transfer',?,?)", saleId, subtotal, m + ' ' + o.orderNo);
    run('INSERT INTO marketplace_orders (tenant_id, provider, order_no, sale_id, status, payload) VALUES (?,?,?,?,?,?)', tenantId, provider, o.orderNo, saleId, 'imported', JSON.stringify(o.raw ?? o));
    return 'imported';
  });
}

export async function marketplacePullOrders(m: string, tenantId: number, cfg: Record<string, string>, mode: 'test' | 'live'): Promise<JobResult> {
  if (mode === 'test') return { ok: true, simulated: true, response: 'Test modunda sipariş çekilmez' };
  let orders: MpOrder[] = [];
  if (m === 'trendyol') {
    need(cfg, 'sellerId', 'apiKey', 'apiSecret');
    const since = Date.now() - 2 * 86400000;
    const r = await httpCall(`https://api.trendyol.com/sapigw/suppliers/${cfg.sellerId}/orders?status=Created&startDate=${since}&size=200`, {
      method: 'GET', headers: { Authorization: basicAuth(cfg.apiKey, cfg.apiSecret), 'User-Agent': `${cfg.sellerId} - DCAyakkabi` },
    });
    if (!r.ok) return { ok: false, response: r.text.slice(0, 1000) };
    const content = ((r.json as { content?: any[] })?.content ?? []);
    orders = content.map((o) => ({
      orderNo: String(o.orderNumber), customerName: `${o.customerFirstName ?? ''} ${o.customerLastName ?? ''}`.trim(),
      lines: (o.lines ?? []).map((l: any) => ({ barcode: String(l.barcode), qty: Number(l.quantity), price: Number(l.price) })), raw: o,
    }));
  } else if (m === 'hepsiburada') {
    need(cfg, 'merchantId', 'username', 'password');
    const r = await httpCall(`https://oms-external.hepsiburada.com/orders/merchantid/${cfg.merchantId}?offset=0&limit=100`, {
      method: 'GET', headers: { Authorization: basicAuth(cfg.username, cfg.password) },
    });
    if (!r.ok) return { ok: false, response: r.text.slice(0, 1000) };
    const items = ((r.json as { items?: any[] })?.items ?? []);
    const grouped = new Map<string, MpOrder>();
    for (const it of items) {
      const no = String(it.orderNumber ?? it.orderId);
      const o: MpOrder = grouped.get(no) ?? { orderNo: no, lines: [], customerName: it.customerName, raw: [] as unknown[] };
      o.lines.push({ barcode: String(it.merchantSku ?? it.sku), qty: Number(it.quantity ?? 1), price: Number(it.totalPrice?.amount ?? it.price?.amount ?? 0) / Number(it.quantity ?? 1) });
      (o.raw as any[]).push(it);
      grouped.set(no, o);
    }
    orders = [...grouped.values()];
  } else {
    return { ok: true, response: 'N11 sipariş çekme için endpoint desteği yapılandırılmalı' };
  }
  const stats = { imported: 0, exists: 0, skipped: 0 };
  for (const o of orders) stats[importMarketplaceOrder(tenantId, m, o)]++;
  return { ok: true, response: stats };
}

export function listMarketplaceOrders(tenantId: number) {
  return all(
    `SELECT mo.id, mo.provider, mo.order_no, mo.status, mo.created_at, s.receipt_no, s.total FROM marketplace_orders mo
       LEFT JOIN sales s ON s.id = mo.sale_id WHERE mo.tenant_id = ? ORDER BY mo.id DESC LIMIT 200`,
    tenantId,
  );
}
