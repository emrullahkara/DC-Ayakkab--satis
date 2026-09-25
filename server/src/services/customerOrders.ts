import { all, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore, inList } from '../auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { nextSeq, docNo } from '../utils/seq.js';
import { audit } from './audit.js';
import { recordCash } from './register.js';
import { getSettings } from './settings.js';
import { availableChannels, fillTemplate, sendMessage } from './messages.js';

export const ORDER_STATUS = {
  open: 'Yeni (tedarik edilecek)',
  ordered: 'Tedarikçiye sipariş verildi',
  arrived: 'Mağazaya geldi',
  notified: 'Müşteriye haber verildi',
  delivered: 'Teslim edildi',
  cancelled: 'İptal',
} as const;

export interface CustomerOrderInput {
  storeId: number;
  customerId: number;
  variantId?: number | null;
  description?: string;
  qty?: number;
  price?: number;
  deposit?: number;
  depositMethod?: 'cash' | 'card' | 'transfer';
  dueDate?: string;
  note?: string;
}

export function createCustomerOrder(user: AuthUser, input: CustomerOrderInput) {
  const storeId = assertStore(user, input.storeId);
  const c = one<{ id: number }>('SELECT id FROM customers WHERE id = ? AND tenant_id = ?', input.customerId, user.tenantId);
  if (!c) throw badRequest('Müşteri seçilmelidir');
  let desc = input.description?.trim() ?? '';
  let price = input.price ?? 0;
  if (input.variantId) {
    const v = one<{ code: string; name: string; color: string; size: string; price: number }>(
      `SELECT p.code, p.name, v.color, v.size, COALESCE(v.sale_price, p.sale_price) price FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = ? AND v.tenant_id = ?`,
      input.variantId, user.tenantId,
    );
    if (!v) throw notFound('Ürün bulunamadı');
    desc = desc || `${v.code} ${v.name} - ${v.color} - ${v.size} numara`;
    price = input.price ?? v.price;
  }
  if (!desc) throw badRequest('Sipariş açıklaması (model / renk / numara) yazılmalıdır');
  const deposit = Math.round(input.deposit ?? 0);
  if (deposit < 0) throw badRequest('Kapora geçersiz');
  return tx(() => {
    const no = docNo('MS', nextSeq(user.tenantId, 'customer_order'));
    const r = run(
      `INSERT INTO customer_orders (tenant_id, store_id, order_no, customer_id, variant_id, description, qty, price, deposit, deposit_method, due_date, note, user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      user.tenantId, storeId, no, c.id, input.variantId ?? null, desc, Math.max(1, Math.round(input.qty ?? 1)), price, deposit,
      deposit ? input.depositMethod ?? 'cash' : null, input.dueDate || null, input.note || null, user.id,
    );
    const id = Number(r.lastInsertRowid);
    if (deposit > 0) {
      recordCash(user, { storeId, type: 'income', method: input.depositMethod ?? 'cash', category: 'Kapora', amount: deposit, note: no, refType: 'customer_order', refId: id });
    }
    audit(user, user.tenantId, 'customer_order.create', 'customer_order', id, { no });
    return getCustomerOrder(user, id);
  });
}

export function getCustomerOrder(user: AuthUser, id: number) {
  const o = one<Record<string, unknown> & { store_id: number }>(
    `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, st.name AS store_name, u.name AS user_name, s.receipt_no
       FROM customer_orders o JOIN customers c ON c.id = o.customer_id JOIN stores st ON st.id = o.store_id
       LEFT JOIN users u ON u.id = o.user_id LEFT JOIN sales s ON s.id = o.sale_id
      WHERE o.id = ? AND o.tenant_id = ?`,
    id, user.tenantId,
  );
  if (!o) throw notFound('Sipariş bulunamadı');
  assertStore(user, o.store_id);
  return o;
}

export function listCustomerOrders(user: AuthUser, f: { status?: string; storeId?: number; q?: string }) {
  const stores = inList(f.storeId ? [assertStore(user, f.storeId)] : user.storeIds);
  const where = ['o.tenant_id = ?', `o.store_id IN (${stores})`];
  const params: unknown[] = [user.tenantId];
  if (f.status === 'active') where.push("o.status IN ('open','ordered','arrived','notified')");
  else if (f.status) (where.push('o.status = ?'), params.push(f.status));
  if (f.q) (where.push('(o.order_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR o.description LIKE ?)'), params.push(...Array(4).fill(`%${f.q}%`)));
  return all(
    `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, st.name AS store_name
       FROM customer_orders o JOIN customers c ON c.id = o.customer_id JOIN stores st ON st.id = o.store_id
      WHERE ${where.join(' AND ')} ORDER BY CASE o.status WHEN 'arrived' THEN 0 WHEN 'open' THEN 1 WHEN 'ordered' THEN 2 WHEN 'notified' THEN 3 ELSE 4 END, o.id DESC LIMIT 500`,
    ...params,
  );
}

/** Durum değişikliği. "arrived" durumunda istenirse müşteriye otomatik mesaj gider. */
export function setCustomerOrderStatus(user: AuthUser, id: number, status: keyof typeof ORDER_STATUS, opts: { notify?: boolean; refundMethod?: 'cash' | 'card' | 'transfer' } = {}) {
  if (!(status in ORDER_STATUS) || status === 'delivered') throw badRequest('Geçersiz durum (teslim işlemi kasa ekranından yapılır)');
  return tx(() => {
    const o = getCustomerOrder(user, id) as Record<string, unknown> & { status: string; store_id: number; deposit: number; order_no: string; customer_name: string; customer_phone: string | null; description: string; store_name: string };
    if (['delivered', 'cancelled'].includes(o.status)) throw badRequest('Kapanmış sipariş değiştirilemez');
    run("UPDATE customer_orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?", status, id);
    if (status === 'cancelled' && o.deposit > 0 && opts.refundMethod) {
      recordCash(user, { storeId: o.store_id, type: 'withdraw', method: opts.refundMethod, category: 'Kapora iadesi', amount: o.deposit, note: o.order_no, refType: 'customer_order', refId: id });
    }
    let messageSent = false;
    if (status === 'arrived' && opts.notify && o.customer_phone) {
      const ch = availableChannels(user.tenantId)[0];
      if (ch) {
        const s = getSettings(user.tenantId);
        const text = fillTemplate(s.messages.orderArrivedText, { ad: o.customer_name.split(' ')[0], urun: o.description, magaza: o.store_name });
        sendMessage(user.tenantId, ch, o.customer_phone, text, { type: 'customer_order', id });
        run("UPDATE customer_orders SET status = 'notified' WHERE id = ?", id);
        messageSent = true;
      }
    }
    audit(user, user.tenantId, 'customer_order.' + status, 'customer_order', id);
    return { ...getCustomerOrder(user, id), messageSent };
  });
}
