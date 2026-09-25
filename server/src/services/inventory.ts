import { all, getDb, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore, hasPerm, inList } from '../auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { nextSeq, docNo } from '../utils/seq.js';
import { changeStock, stockQty, type MovementType } from './stock.js';
import { audit } from './audit.js';

function variantOf(tenantId: number, variantId: number) {
  const v = one<{ id: number; cost_price: number }>(
    'SELECT v.id, p.cost_price FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.tenant_id = ?',
    variantId, tenantId,
  );
  if (!v) throw notFound('Ürün bulunamadı (#' + variantId + ')');
  return v;
}

// ---------------------------------------------------------------- Stok listesi

export function stockList(
  user: AuthUser,
  f: { storeIds: number[]; q?: string; brandId?: number; categoryId?: number; onlyPositive?: boolean; low?: boolean; limit?: number },
) {
  const where = ['v.tenant_id = ?', 'v.active = 1', 'p.active = 1'];
  const params: unknown[] = [user.tenantId];
  if (f.q) {
    where.push('(p.code LIKE ? OR p.name LIKE ? OR v.barcode = ? OR v.color LIKE ?)');
    params.push(`%${f.q}%`, `%${f.q}%`, f.q, `%${f.q}%`);
  }
  if (f.brandId) (where.push('p.brand_id = ?'), params.push(f.brandId));
  if (f.categoryId) (where.push('p.category_id = ?'), params.push(f.categoryId));
  const stores = inList(f.storeIds);
  const having: string[] = [];
  if (f.onlyPositive) having.push('total > 0');
  if (f.low) having.push('total <= p.min_stock');
  const rows = all<{ id: number; total: number; cost_price?: number }>(
    `SELECT v.id, v.color, v.size, v.barcode, p.id AS product_id, p.code, p.name, p.min_stock, p.cost_price,
            COALESCE(v.sale_price, p.sale_price) AS price, b.name AS brand, c.name AS category,
            COALESCE((SELECT SUM(qty) FROM stock WHERE variant_id = v.id AND store_id IN (${stores})),0) AS total
       FROM variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')} ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
      ORDER BY p.code, v.color, CAST(v.size AS REAL), v.size LIMIT ?`,
    ...params, Math.min(f.limit ?? 500, 5000),
  );
  if (!rows.length) return [];
  const per = all<{ variant_id: number; store_id: number; qty: number }>(
    `SELECT variant_id, store_id, qty FROM stock WHERE store_id IN (${stores}) AND variant_id IN (${rows.map((r) => r.id).join(',')})`,
  );
  const map = new Map<number, Record<number, number>>();
  for (const p of per) {
    const m = map.get(p.variant_id) ?? {};
    m[p.store_id] = p.qty;
    map.set(p.variant_id, m);
  }
  const canCost = hasPerm(user, 'costs.view');
  return rows.map((r) => {
    if (!canCost) delete r.cost_price;
    return { ...r, stores: map.get(r.id) ?? {} };
  });
}

export function movements(
  user: AuthUser,
  f: { storeIds: number[]; from: string; toExclusive: string; variantId?: number; productId?: number; type?: string; limit?: number },
) {
  const where = ['m.tenant_id = ?', `m.store_id IN (${inList(f.storeIds)})`, 'm.created_at >= ?', 'm.created_at < ?'];
  const params: unknown[] = [user.tenantId, f.from, f.toExclusive];
  if (f.variantId) (where.push('m.variant_id = ?'), params.push(f.variantId));
  if (f.productId) (where.push('v.product_id = ?'), params.push(f.productId));
  if (f.type) (where.push('m.type = ?'), params.push(f.type));
  return all(
    `SELECT m.*, v.color, v.size, v.barcode, p.code, p.name, s.name AS store_name, u.name AS user_name
       FROM stock_movements m JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
       JOIN stores s ON s.id = m.store_id LEFT JOIN users u ON u.id = m.user_id
      WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`,
    ...params, Math.min(f.limit ?? 500, 5000),
  );
}

/** Elle stok düzeltme / fire / açılış stoğu */
export function adjustStock(
  user: AuthUser,
  input: { storeId: number; type: 'damage' | 'manual' | 'opening'; note?: string; items: { variantId: number; qty: number }[] },
) {
  const storeId = assertStore(user, input.storeId);
  if (!['damage', 'manual', 'opening'].includes(input.type)) throw badRequest('Geçersiz hareket türü');
  if (!input.items?.length) throw badRequest('Ürün seçilmedi');
  if (input.type !== 'opening' && !input.note?.trim()) throw badRequest('Açıklama zorunludur (örn. defolu, kayıp)');
  return tx(() => {
    for (const it of input.items) {
      const v = variantOf(user.tenantId, it.variantId);
      if (!Number.isInteger(it.qty) || it.qty === 0) throw badRequest('Adet geçersiz');
      const qty = input.type === 'damage' ? -Math.abs(it.qty) : it.qty;
      changeStock({
        tenantId: user.tenantId, storeId, variantId: v.id, qty, type: input.type as MovementType, userId: user.id,
        unitCost: v.cost_price, note: input.note ?? null, allowNegative: false,
      });
    }
    audit(user, user.tenantId, 'stock.' + input.type, 'store', storeId, { items: input.items.length, note: input.note });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- Transfer

export interface TransferInput {
  fromStoreId: number;
  toStoreId: number;
  items: { variantId: number; qty: number }[];
  note?: string;
  request?: boolean; // true: karşı mağazadan ürün talebi (stok henüz düşmez)
}

export function createTransfer(user: AuthUser, input: TransferInput) {
  const from = Number(input.fromStoreId);
  const to = Number(input.toStoreId);
  if (from === to) throw badRequest('Gönderen ve alan mağaza aynı olamaz');
  if (!input.items?.length) throw badRequest('Ürün seçilmedi');
  // Talep oluştururken alan mağazaya, gönderirken gönderen mağazaya yetki gerekir
  if (input.request) assertStore(user, to);
  else assertStore(user, from);
  const storesOk = all('SELECT id FROM stores WHERE tenant_id = ? AND id IN (?, ?) AND active = 1', user.tenantId, from, to);
  if (storesOk.length !== 2) throw badRequest('Mağaza bulunamadı');
  return tx(() => {
    const no = docNo('TR', nextSeq(user.tenantId, 'transfer'));
    const r = run(
      `INSERT INTO transfers (tenant_id, transfer_no, from_store_id, to_store_id, status, note, created_by, sent_at)
       VALUES (?,?,?,?,?,?,?, CASE WHEN ? = 'sent' THEN datetime('now','localtime') END)`,
      user.tenantId, no, from, to, input.request ? 'requested' : 'sent', input.note ?? null, user.id, input.request ? 'requested' : 'sent',
    );
    const id = Number(r.lastInsertRowid);
    const merged = new Map<number, number>();
    for (const it of input.items) {
      if (!Number.isInteger(it.qty) || it.qty <= 0) throw badRequest('Adet geçersiz');
      variantOf(user.tenantId, it.variantId);
      merged.set(it.variantId, (merged.get(it.variantId) ?? 0) + it.qty);
    }
    for (const [variantId, qty] of merged) {
      run('INSERT INTO transfer_items (transfer_id, variant_id, qty) VALUES (?,?,?)', id, variantId, qty);
      if (!input.request) {
        changeStock({
          tenantId: user.tenantId, storeId: from, variantId, qty: -qty, type: 'transfer_out', userId: user.id,
          refType: 'transfer', refId: id, allowNegative: false,
        });
      }
    }
    audit(user, user.tenantId, input.request ? 'transfer.request' : 'transfer.send', 'transfer', id, { no });
    return getTransfer(user, id);
  });
}

function loadTransfer(user: AuthUser, id: number) {
  const t = one<{ id: number; from_store_id: number; to_store_id: number; status: string; transfer_no: string }>(
    'SELECT * FROM transfers WHERE id = ? AND tenant_id = ?', id, user.tenantId,
  );
  if (!t) throw notFound('Transfer bulunamadı');
  return t;
}

/** Talep edilen transferi gönderen mağaza onaylayıp yola çıkarır (adetler değiştirilebilir). */
export function sendRequestedTransfer(user: AuthUser, id: number, items?: { variantId: number; qty: number }[]) {
  return tx(() => {
    const t = loadTransfer(user, id);
    assertStore(user, t.from_store_id);
    if (t.status !== 'requested') throw badRequest('Bu transfer talep durumunda değil');
    if (items) {
      run('DELETE FROM transfer_items WHERE transfer_id = ?', id);
      for (const it of items) if (it.qty > 0) run('INSERT INTO transfer_items (transfer_id, variant_id, qty) VALUES (?,?,?)', id, variantOf(user.tenantId, it.variantId).id, it.qty);
    }
    const rows = all<{ variant_id: number; qty: number }>('SELECT variant_id, qty FROM transfer_items WHERE transfer_id = ?', id);
    if (!rows.length) throw badRequest('Gönderilecek ürün yok');
    for (const r of rows) {
      changeStock({
        tenantId: user.tenantId, storeId: t.from_store_id, variantId: r.variant_id, qty: -r.qty, type: 'transfer_out',
        userId: user.id, refType: 'transfer', refId: id, allowNegative: false,
      });
    }
    run("UPDATE transfers SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?", id);
    audit(user, user.tenantId, 'transfer.send', 'transfer', id);
    return getTransfer(user, id);
  });
}

/** Alan mağaza ürünleri teslim alır. Eksik gelen adetler kayda geçer. */
export function receiveTransfer(user: AuthUser, id: number, received?: { variantId: number; qty: number }[]) {
  return tx(() => {
    const t = loadTransfer(user, id);
    assertStore(user, t.to_store_id);
    if (t.status !== 'sent') throw badRequest('Bu transfer teslim alınamaz (durum: ' + t.status + ')');
    const rows = all<{ id: number; variant_id: number; qty: number }>('SELECT * FROM transfer_items WHERE transfer_id = ?', id);
    const missing: { variantId: number; qty: number }[] = [];
    for (const r of rows) {
      const got = received ? Math.max(0, Math.min(r.qty, received.find((x) => x.variantId === r.variant_id)?.qty ?? 0)) : r.qty;
      run('UPDATE transfer_items SET qty_received = ? WHERE id = ?', got, r.id);
      if (got > 0) {
        changeStock({
          tenantId: user.tenantId, storeId: t.to_store_id, variantId: r.variant_id, qty: got, type: 'transfer_in',
          userId: user.id, refType: 'transfer', refId: id,
        });
      }
      if (got < r.qty) missing.push({ variantId: r.variant_id, qty: r.qty - got });
    }
    run(
      `UPDATE transfers SET status = 'received', received_by = ?, received_at = datetime('now','localtime'),
              note = CASE WHEN ? > 0 THEN COALESCE(note || ' | ', '') || 'Eksik teslim: ' || ? || ' çift' ELSE note END WHERE id = ?`,
      user.id, missing.length, missing.reduce((a, m) => a + m.qty, 0), id,
    );
    audit(user, user.tenantId, 'transfer.receive', 'transfer', id, { missing });
    return getTransfer(user, id);
  });
}

export function cancelTransfer(user: AuthUser, id: number) {
  return tx(() => {
    const t = loadTransfer(user, id);
    if (!user.storeIds.includes(t.from_store_id) && !user.storeIds.includes(t.to_store_id)) throw forbidden();
    if (!['requested', 'sent'].includes(t.status)) throw badRequest('Bu transfer iptal edilemez');
    if (t.status === 'sent') {
      assertStore(user, t.from_store_id);
      const rows = all<{ variant_id: number; qty: number }>('SELECT variant_id, qty FROM transfer_items WHERE transfer_id = ?', id);
      for (const r of rows) {
        changeStock({
          tenantId: user.tenantId, storeId: t.from_store_id, variantId: r.variant_id, qty: r.qty, type: 'transfer_in',
          userId: user.id, refType: 'transfer', refId: id, note: 'Transfer iptali',
        });
      }
    }
    run("UPDATE transfers SET status = 'cancelled' WHERE id = ?", id);
    audit(user, user.tenantId, 'transfer.cancel', 'transfer', id);
    return getTransfer(user, id);
  });
}

export function getTransfer(user: AuthUser, id: number) {
  const t = one<Record<string, unknown> & { from_store_id: number; to_store_id: number }>(
    `SELECT t.*, fs.name AS from_store, ts.name AS to_store, u.name AS created_by_name, ur.name AS received_by_name
       FROM transfers t JOIN stores fs ON fs.id = t.from_store_id JOIN stores ts ON ts.id = t.to_store_id
       LEFT JOIN users u ON u.id = t.created_by LEFT JOIN users ur ON ur.id = t.received_by
      WHERE t.id = ? AND t.tenant_id = ?`,
    id, user.tenantId,
  );
  if (!t) throw notFound('Transfer bulunamadı');
  if (!user.storeIds.includes(t.from_store_id) && !user.storeIds.includes(t.to_store_id)) throw forbidden();
  const items = all(
    `SELECT ti.*, v.color, v.size, v.barcode, p.code, p.name,
            COALESCE((SELECT qty FROM stock WHERE store_id = ? AND variant_id = ti.variant_id),0) AS from_qty
       FROM transfer_items ti JOIN variants v ON v.id = ti.variant_id JOIN products p ON p.id = v.product_id
      WHERE ti.transfer_id = ? ORDER BY p.code, v.color, v.size`,
    t.from_store_id, id,
  );
  return { ...t, items };
}

export function listTransfers(user: AuthUser, f: { status?: string; storeId?: number; direction?: 'in' | 'out' }) {
  const stores = inList(f.storeId ? [assertStore(user, f.storeId)] : user.storeIds);
  const cond =
    f.direction === 'in' ? `t.to_store_id IN (${stores})` : f.direction === 'out' ? `t.from_store_id IN (${stores})` : `(t.from_store_id IN (${stores}) OR t.to_store_id IN (${stores}))`;
  return all(
    `SELECT t.*, fs.name AS from_store, ts.name AS to_store, u.name AS created_by_name,
            (SELECT SUM(qty) FROM transfer_items WHERE transfer_id = t.id) AS total_qty
       FROM transfers t JOIN stores fs ON fs.id = t.from_store_id JOIN stores ts ON ts.id = t.to_store_id
       LEFT JOIN users u ON u.id = t.created_by
      WHERE t.tenant_id = ? AND ${cond} ${f.status ? 'AND t.status = ?' : ''}
      ORDER BY t.id DESC LIMIT 300`,
    user.tenantId, ...(f.status ? [f.status] : []),
  );
}

// ---------------------------------------------------------------- Sayım

export function createCount(user: AuthUser, input: { storeId: number; name?: string; scope?: 'partial' | 'full' }) {
  const storeId = assertStore(user, input.storeId);
  const open = one('SELECT id FROM stock_counts WHERE store_id = ? AND status = ?', storeId, 'open');
  if (open) throw badRequest('Bu mağazada zaten açık bir sayım var');
  const r = run(
    'INSERT INTO stock_counts (tenant_id, store_id, name, scope, created_by) VALUES (?,?,?,?,?)',
    user.tenantId, storeId, input.name?.trim() || 'Sayım ' + new Date().toLocaleDateString('tr-TR'), input.scope === 'full' ? 'full' : 'partial', user.id,
  );
  audit(user, user.tenantId, 'count.create', 'stock_count', r.lastInsertRowid);
  return getCount(user, Number(r.lastInsertRowid));
}

function loadCount(user: AuthUser, id: number) {
  const c = one<{ id: number; store_id: number; status: string; scope: string }>(
    'SELECT * FROM stock_counts WHERE id = ? AND tenant_id = ?', id, user.tenantId,
  );
  if (!c) throw notFound('Sayım bulunamadı');
  assertStore(user, c.store_id);
  return c;
}

/** Sayıma ürün ekler. mode=add: okutulan adet eklenir; mode=set: adet doğrudan yazılır. */
export function countScan(user: AuthUser, id: number, input: { barcode?: string; variantId?: number; qty?: number; mode?: 'add' | 'set' }) {
  const c = loadCount(user, id);
  if (c.status !== 'open') throw badRequest('Sayım kapalı');
  let variantId = input.variantId;
  if (input.barcode) {
    const v = one<{ id: number }>('SELECT id FROM variants WHERE tenant_id = ? AND barcode = ?', user.tenantId, input.barcode.trim());
    if (!v) throw notFound('Barkod bulunamadı: ' + input.barcode);
    variantId = v.id;
  }
  if (!variantId) throw badRequest('Ürün belirtilmedi');
  variantOf(user.tenantId, variantId);
  const qty = Math.round(input.qty ?? 1);
  if (input.mode === 'set') {
    if (qty < 0) throw badRequest('Adet eksi olamaz');
    run(
      'INSERT INTO stock_count_items (count_id, variant_id, counted_qty) VALUES (?,?,?) ON CONFLICT DO UPDATE SET counted_qty = excluded.counted_qty',
      id, variantId, qty,
    );
  } else {
    run(
      'INSERT INTO stock_count_items (count_id, variant_id, counted_qty) VALUES (?,?,?) ON CONFLICT DO UPDATE SET counted_qty = MAX(0, counted_qty + excluded.counted_qty)',
      id, variantId, qty,
    );
  }
  const row = one(
    `SELECT ci.*, v.color, v.size, v.barcode, p.code, p.name FROM stock_count_items ci JOIN variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id WHERE ci.count_id = ? AND ci.variant_id = ?`,
    id, variantId,
  );
  return row;
}

export function getCount(user: AuthUser, id: number) {
  const c = loadCount(user, id);
  const header = one<{ result: string | null }>(
    `SELECT sc.*, s.name AS store_name, u.name AS created_by_name FROM stock_counts sc JOIN stores s ON s.id = sc.store_id
       LEFT JOIN users u ON u.id = sc.created_by WHERE sc.id = ?`,
    id,
  );
  const items = all<{ variant_id: number; counted_qty: number; system_qty: number | null }>(
    `SELECT ci.*, v.color, v.size, v.barcode, p.code, p.name, p.cost_price,
            COALESCE((SELECT qty FROM stock WHERE store_id = ? AND variant_id = ci.variant_id),0) AS current_qty
       FROM stock_count_items ci JOIN variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id
      WHERE ci.count_id = ? ORDER BY p.code, v.color, v.size`,
    c.store_id, id,
  );
  return { ...(header as Record<string, unknown>), result: header?.result ? JSON.parse(header.result) : null, items, preview: c.status === 'open' ? countPreview(c) : null };
}

function countPreview(c: { id: number; store_id: number; scope: string }) {
  const diffs = all<{ variant_id: number; system: number; counted: number; cost: number; code: string; name: string; color: string; size: string }>(
    `SELECT v.id AS variant_id, COALESCE(st.qty,0) AS system, COALESCE(ci.counted_qty, 0) AS counted, p.cost_price AS cost,
            p.code, p.name, v.color, v.size
       FROM variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN stock st ON st.variant_id = v.id AND st.store_id = ?
       LEFT JOIN stock_count_items ci ON ci.variant_id = v.id AND ci.count_id = ?
      WHERE v.tenant_id = (SELECT tenant_id FROM stores WHERE id = ?)
        AND (ci.variant_id IS NOT NULL ${c.scope === 'full' ? 'OR COALESCE(st.qty,0) <> 0' : ''})`,
    c.store_id, c.id, c.store_id,
  ).filter((d) => d.system !== d.counted);
  const plus = diffs.filter((d) => d.counted > d.system).reduce((a, d) => a + d.counted - d.system, 0);
  const minus = diffs.filter((d) => d.counted < d.system).reduce((a, d) => a + d.system - d.counted, 0);
  const value = diffs.reduce((a, d) => a + (d.counted - d.system) * d.cost, 0);
  return { diffs, plus, minus, value };
}

/** Sayımı uygular: farklar stok hareketi olarak işlenir. Tam sayımda okutulmayan ürünler sıfırlanır. */
export function applyCount(user: AuthUser, id: number) {
  return tx(() => {
    const c = loadCount(user, id);
    if (c.status !== 'open') throw badRequest('Sayım zaten kapatılmış');
    const p = countPreview(c);
    const db = getDb();
    for (const d of p.diffs) {
      db.prepare('INSERT INTO stock_count_items (count_id, variant_id, counted_qty, system_qty) VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET system_qty = excluded.system_qty')
        .run(id, d.variant_id, d.counted, d.system);
      changeStock({
        tenantId: user.tenantId, storeId: c.store_id, variantId: d.variant_id, qty: d.counted - d.system, type: 'count',
        userId: user.id, refType: 'count', refId: id, unitCost: d.cost,
      });
    }
    const result = { lines: p.diffs.length, plus: p.plus, minus: p.minus, value: p.value };
    run(
      "UPDATE stock_counts SET status = 'applied', applied_by = ?, applied_at = datetime('now','localtime'), result = ? WHERE id = ?",
      user.id, JSON.stringify(result), id,
    );
    audit(user, user.tenantId, 'count.apply', 'stock_count', id, result);
    return getCount(user, id);
  });
}

export function cancelCount(user: AuthUser, id: number) {
  const c = loadCount(user, id);
  if (c.status !== 'open') throw badRequest('Sayım açık değil');
  run("UPDATE stock_counts SET status = 'cancelled' WHERE id = ?", id);
  return { ok: true };
}

export function listCounts(user: AuthUser) {
  return all(
    `SELECT sc.*, s.name AS store_name, u.name AS created_by_name,
            (SELECT COUNT(*) FROM stock_count_items WHERE count_id = sc.id) AS lines,
            (SELECT COALESCE(SUM(counted_qty),0) FROM stock_count_items WHERE count_id = sc.id) AS counted_total
       FROM stock_counts sc JOIN stores s ON s.id = sc.store_id LEFT JOIN users u ON u.id = sc.created_by
      WHERE sc.tenant_id = ? AND sc.store_id IN (${inList(user.storeIds)}) ORDER BY sc.id DESC LIMIT 200`,
    user.tenantId,
  );
}

export { stockQty };
