import { all, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore, inList } from '../auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { nextSeq, docNo } from '../utils/seq.js';
import { addDays, today } from '../utils/dates.js';
import { changeStock } from './stock.js';
import { audit } from './audit.js';
import { recordCash } from './register.js';

// ---------------------------------------------------------------- Tedarikçiler

export interface SupplierInput {
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  tax_no?: string;
  tax_office?: string;
  address?: string;
  iban?: string;
  payment_term_days?: number;
  notes?: string;
  active?: boolean;
}

export function supplierBalance(id: number) {
  return one<{ b: number }>('SELECT COALESCE(SUM(amount),0) b FROM supplier_ledger WHERE supplier_id = ?', id)!.b;
}

export function saveSupplier(user: AuthUser, input: SupplierInput, id?: number) {
  if (!input.name?.trim()) throw badRequest('Tedarikçi adı zorunludur');
  const f = {
    name: input.name.trim(),
    contact_name: input.contact_name || null,
    phone: input.phone || null,
    email: input.email || null,
    tax_no: input.tax_no || null,
    tax_office: input.tax_office || null,
    address: input.address || null,
    iban: input.iban?.replace(/\s/g, '').toUpperCase() || null,
    payment_term_days: Math.max(0, Math.round(Number(input.payment_term_days ?? 0))),
    notes: input.notes || null,
    active: input.active === false ? 0 : 1,
  };
  const keys = Object.keys(f) as (keyof typeof f)[];
  if (id) {
    if (!one('SELECT 1 FROM suppliers WHERE id = ? AND tenant_id = ?', id, user.tenantId)) throw notFound('Tedarikçi bulunamadı');
    run(`UPDATE suppliers SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), id);
    audit(user, user.tenantId, 'supplier.update', 'supplier', id);
    return getSupplier(user, id);
  }
  const r = run(`INSERT INTO suppliers (tenant_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`, user.tenantId, ...keys.map((k) => f[k]));
  audit(user, user.tenantId, 'supplier.create', 'supplier', r.lastInsertRowid);
  return getSupplier(user, Number(r.lastInsertRowid));
}

export function listSuppliers(tenantId: number) {
  return all(
    `SELECT s.*, COALESCE((SELECT SUM(amount) FROM supplier_ledger WHERE supplier_id = s.id),0) AS balance,
            (SELECT MIN(due_date) FROM supplier_ledger WHERE supplier_id = s.id AND type = 'invoice' AND due_date IS NOT NULL) AS first_due,
            (SELECT COUNT(*) FROM products WHERE supplier_id = s.id) AS product_count
       FROM suppliers s WHERE s.tenant_id = ? ORDER BY s.active DESC, s.name`,
    tenantId,
  );
}

export function getSupplier(user: AuthUser, id: number) {
  const s = one<Record<string, unknown>>('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?', id, user.tenantId);
  if (!s) throw notFound('Tedarikçi bulunamadı');
  const ledger = all(
    `SELECT sl.*, u.name AS user_name FROM supplier_ledger sl LEFT JOIN users u ON u.id = sl.user_id
      WHERE sl.supplier_id = ? ORDER BY sl.id DESC LIMIT 300`,
    id,
  );
  const orders = all(
    `SELECT po.id, po.order_no, po.status, po.total, po.created_at, po.expected_date, st.name AS store_name
       FROM purchase_orders po JOIN stores st ON st.id = po.store_id WHERE po.supplier_id = ? ORDER BY po.id DESC LIMIT 100`,
    id,
  );
  return { ...s, balance: supplierBalance(id), ledger, orders };
}

/** Tedarikçi cari hareketi: fatura (+), ödeme (-), iade (-), düzeltme */
export function supplierEntry(
  user: AuthUser,
  supplierId: number,
  input: { type: 'invoice' | 'payment' | 'return' | 'adjust'; amount: number; method?: 'cash' | 'card' | 'transfer' | 'check'; storeId?: number; dueDate?: string; docNo?: string; note?: string },
) {
  const sup = one<{ id: number; name: string; payment_term_days: number }>('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?', supplierId, user.tenantId);
  if (!sup) throw notFound('Tedarikçi bulunamadı');
  if (!Number.isInteger(input.amount) || input.amount === 0) throw badRequest('Tutar geçersiz');
  if (input.type !== 'adjust' && input.amount < 0) throw badRequest('Tutar pozitif girilmelidir');
  const signed = input.type === 'invoice' || input.type === 'adjust' ? input.amount : -input.amount;
  return tx(() => {
    const r = run(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, type, amount, method, due_date, doc_no, note, user_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      user.tenantId, supplierId, input.type, signed, input.method ?? null,
      input.type === 'invoice' ? input.dueDate || addDays(today(), sup.payment_term_days) : input.dueDate || null,
      input.docNo ?? null, input.note ?? null, user.id,
    );
    if (input.type === 'payment' && input.storeId && input.method && input.method !== 'check') {
      recordCash(user, {
        storeId: input.storeId, type: 'supplier_payment', method: input.method, category: 'Tedarikçi ödemesi',
        amount: input.amount, note: sup.name, refType: 'supplier_ledger', refId: Number(r.lastInsertRowid),
      });
    }
    audit(user, user.tenantId, 'supplier.' + input.type, 'supplier', supplierId, { amount: input.amount });
    return { balance: supplierBalance(supplierId) };
  });
}

export function payables(tenantId: number) {
  return all(
    `SELECT s.id, s.name, s.phone, SUM(sl.amount) balance,
            MIN(CASE WHEN sl.type = 'invoice' THEN sl.due_date END) first_due
       FROM suppliers s JOIN supplier_ledger sl ON sl.supplier_id = s.id
      WHERE s.tenant_id = ? GROUP BY s.id HAVING balance > 0 ORDER BY first_due`,
    tenantId,
  );
}

// ---------------------------------------------------------------- Satın alma siparişleri

export interface POInput {
  supplierId: number;
  storeId: number;
  expectedDate?: string;
  note?: string;
  items: { variantId: number; qty: number; unitCost?: number }[];
  status?: 'draft' | 'ordered';
}

function poTotal(poId: number) {
  const r = one<{ t: number }>('SELECT COALESCE(SUM(qty_ordered * unit_cost),0) t FROM purchase_order_items WHERE po_id = ?', poId)!;
  run('UPDATE purchase_orders SET total = ? WHERE id = ?', r.t, poId);
}

export function savePO(user: AuthUser, input: POInput, id?: number) {
  const storeId = assertStore(user, input.storeId);
  if (!one('SELECT 1 FROM suppliers WHERE id = ? AND tenant_id = ?', input.supplierId, user.tenantId)) throw badRequest('Tedarikçi seçilmelidir');
  if (!input.items?.length) throw badRequest('Siparişte ürün yok');
  return tx(() => {
    let poId = id;
    if (id) {
      const po = one<{ status: string }>('SELECT status FROM purchase_orders WHERE id = ? AND tenant_id = ?', id, user.tenantId);
      if (!po) throw notFound('Sipariş bulunamadı');
      if (!['draft', 'ordered'].includes(po.status)) throw badRequest('Teslim alınmaya başlanmış sipariş değiştirilemez');
      run(
        'UPDATE purchase_orders SET supplier_id = ?, store_id = ?, expected_date = ?, note = ?, status = ? WHERE id = ?',
        input.supplierId, storeId, input.expectedDate || null, input.note || null, input.status ?? po.status, id,
      );
      run('DELETE FROM purchase_order_items WHERE po_id = ?', id);
    } else {
      const no = docNo('SA', nextSeq(user.tenantId, 'po'));
      poId = Number(
        run(
          `INSERT INTO purchase_orders (tenant_id, supplier_id, store_id, order_no, status, expected_date, note, created_by)
           VALUES (?,?,?,?,?,?,?,?)`,
          user.tenantId, input.supplierId, storeId, no, input.status ?? 'draft', input.expectedDate || null, input.note || null, user.id,
        ).lastInsertRowid,
      );
    }
    const merged = new Map<number, { qty: number; unitCost: number }>();
    for (const it of input.items) {
      if (!Number.isInteger(it.qty) || it.qty <= 0) throw badRequest('Adet geçersiz');
      const v = one<{ cost_price: number }>(
        'SELECT p.cost_price FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.tenant_id = ?',
        it.variantId, user.tenantId,
      );
      if (!v) throw notFound('Ürün bulunamadı');
      const cost = it.unitCost ?? v.cost_price;
      if (!Number.isInteger(cost) || cost < 0) throw badRequest('Alış fiyatı geçersiz');
      const ex = merged.get(it.variantId);
      merged.set(it.variantId, { qty: (ex?.qty ?? 0) + it.qty, unitCost: cost });
    }
    for (const [variantId, m] of merged) {
      run('INSERT INTO purchase_order_items (po_id, variant_id, qty_ordered, unit_cost) VALUES (?,?,?,?)', poId, variantId, m.qty, m.unitCost);
    }
    poTotal(poId!);
    audit(user, user.tenantId, id ? 'po.update' : 'po.create', 'purchase_order', poId);
    return getPO(user, poId!);
  });
}

export function setPOStatus(user: AuthUser, id: number, status: 'ordered' | 'cancelled') {
  const po = one<{ status: string; store_id: number }>('SELECT status, store_id FROM purchase_orders WHERE id = ? AND tenant_id = ?', id, user.tenantId);
  if (!po) throw notFound('Sipariş bulunamadı');
  assertStore(user, po.store_id);
  if (status === 'ordered' && po.status !== 'draft') throw badRequest('Sadece taslak sipariş gönderilebilir');
  if (status === 'cancelled' && !['draft', 'ordered'].includes(po.status)) throw badRequest('Teslim alınmaya başlanmış sipariş iptal edilemez');
  run('UPDATE purchase_orders SET status = ? WHERE id = ?', status, id);
  audit(user, user.tenantId, 'po.' + status, 'purchase_order', id);
  return getPO(user, id);
}

/**
 * Mal kabul: gelen adetler stoğa girer, ürünün son alış fiyatı güncellenir,
 * tedarikçi cari hesabına KDV dahil fatura tutarı borç olarak yazılır.
 */
export function receivePO(
  user: AuthUser,
  id: number,
  input: { items: { variantId: number; qty: number; unitCost?: number }[]; invoiceNo?: string; addToLedger?: boolean; dueDate?: string },
) {
  return tx(() => {
    const po = one<{ id: number; status: string; store_id: number; supplier_id: number; order_no: string }>(
      'SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?', id, user.tenantId,
    );
    if (!po) throw notFound('Sipariş bulunamadı');
    assertStore(user, po.store_id);
    if (!['draft', 'ordered', 'partial'].includes(po.status)) throw badRequest('Bu sipariş teslim alınamaz');
    let invoiceTotal = 0;
    let received = 0;
    for (const it of input.items ?? []) {
      if (!it.qty) continue;
      if (!Number.isInteger(it.qty) || it.qty < 0) throw badRequest('Adet geçersiz');
      let line = one<{ id: number; qty_ordered: number; qty_received: number; unit_cost: number }>(
        'SELECT * FROM purchase_order_items WHERE po_id = ? AND variant_id = ?', id, it.variantId,
      );
      const v = one<{ product_id: number; vat_rate: number; cost_price: number }>(
        'SELECT v.product_id, p.vat_rate, p.cost_price FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.tenant_id = ?',
        it.variantId, user.tenantId,
      );
      if (!v) throw notFound('Ürün bulunamadı');
      const cost = it.unitCost ?? line?.unit_cost ?? v.cost_price;
      if (!line) {
        // Siparişte olmayan ama gelen ürün (fazla / farklı numara) — satıra eklenir
        const lid = Number(run('INSERT INTO purchase_order_items (po_id, variant_id, qty_ordered, qty_received, unit_cost) VALUES (?,?,?,?,?)', id, it.variantId, it.qty, 0, cost).lastInsertRowid);
        line = { id: lid, qty_ordered: it.qty, qty_received: 0, unit_cost: cost };
      }
      run('UPDATE purchase_order_items SET qty_received = qty_received + ?, unit_cost = ? WHERE id = ?', it.qty, cost, line.id);
      changeStock({
        tenantId: user.tenantId, storeId: po.store_id, variantId: it.variantId, qty: it.qty, type: 'purchase', userId: user.id,
        refType: 'purchase_order', refId: id, unitCost: cost, note: input.invoiceNo ? 'Fatura ' + input.invoiceNo : po.order_no,
      });
      if (cost > 0) run("UPDATE products SET cost_price = ?, updated_at = datetime('now','localtime') WHERE id = ?", cost, v.product_id);
      invoiceTotal += Math.round(cost * it.qty * (1 + v.vat_rate / 100));
      received += it.qty;
    }
    if (!received) throw badRequest('Teslim alınan ürün yok');
    const remain = one<{ r: number }>('SELECT COALESCE(SUM(MAX(qty_ordered - qty_received, 0)),0) r FROM purchase_order_items WHERE po_id = ?', id)!.r;
    run(
      'UPDATE purchase_orders SET status = ?, invoice_no = COALESCE(?, invoice_no) WHERE id = ?',
      remain > 0 ? 'partial' : 'received', input.invoiceNo || null, id,
    );
    poTotal(id);
    if (input.addToLedger !== false && invoiceTotal > 0) {
      const term = one<{ payment_term_days: number }>('SELECT payment_term_days FROM suppliers WHERE id = ?', po.supplier_id)!.payment_term_days;
      run(
        `INSERT INTO supplier_ledger (tenant_id, supplier_id, type, amount, due_date, doc_no, ref_type, ref_id, note, user_id)
         VALUES (?,?, 'invoice', ?,?,?, 'purchase_order', ?, ?, ?)`,
        user.tenantId, po.supplier_id, invoiceTotal, input.dueDate || addDays(today(), term), input.invoiceNo || null, id,
        po.order_no + ' mal kabul (KDV dahil)', user.id,
      );
    }
    audit(user, user.tenantId, 'po.receive', 'purchase_order', id, { received, invoiceTotal });
    return getPO(user, id);
  });
}

/** Siparişsiz hızlı mal kabul (irsaliye ile gelen mal) */
export function quickReceive(
  user: AuthUser,
  input: { supplierId: number; storeId: number; invoiceNo?: string; items: { variantId: number; qty: number; unitCost?: number }[]; addToLedger?: boolean },
) {
  return tx(() => {
    const po = savePO(user, { supplierId: input.supplierId, storeId: input.storeId, items: input.items, status: 'ordered', note: 'Hızlı mal kabul' });
    return receivePO(user, (po as unknown as { id: number }).id, { items: input.items, invoiceNo: input.invoiceNo, addToLedger: input.addToLedger });
  });
}

export function getPO(user: AuthUser, id: number) {
  const po = one<Record<string, unknown> & { store_id: number }>(
    `SELECT po.*, s.name AS supplier_name, st.name AS store_name, u.name AS created_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN stores st ON st.id = po.store_id
       LEFT JOIN users u ON u.id = po.created_by WHERE po.id = ? AND po.tenant_id = ?`,
    id, user.tenantId,
  );
  if (!po) throw notFound('Sipariş bulunamadı');
  assertStore(user, po.store_id);
  const items = all(
    `SELECT poi.*, v.color, v.size, v.barcode, p.code, p.name, p.id AS product_id, p.vat_rate
       FROM purchase_order_items poi JOIN variants v ON v.id = poi.variant_id JOIN products p ON p.id = v.product_id
      WHERE poi.po_id = ? ORDER BY p.code, v.color, CAST(v.size AS REAL), v.size`,
    id,
  );
  return { ...po, items };
}

export function listPOs(user: AuthUser, f: { status?: string; supplierId?: number }) {
  const where = ['po.tenant_id = ?', `po.store_id IN (${inList(user.storeIds)})`];
  const params: unknown[] = [user.tenantId];
  if (f.status) (where.push('po.status = ?'), params.push(f.status));
  if (f.supplierId) (where.push('po.supplier_id = ?'), params.push(f.supplierId));
  return all(
    `SELECT po.*, s.name AS supplier_name, st.name AS store_name,
            (SELECT SUM(qty_ordered) FROM purchase_order_items WHERE po_id = po.id) AS qty_ordered,
            (SELECT SUM(qty_received) FROM purchase_order_items WHERE po_id = po.id) AS qty_received
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN stores st ON st.id = po.store_id
      WHERE ${where.join(' AND ')} ORDER BY po.id DESC LIMIT 300`,
    ...params,
  );
}
