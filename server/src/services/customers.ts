import { all, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore } from '../auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { audit } from './audit.js';
import { recordCash } from './register.js';

export function customerBalance(customerId: number): number {
  return one<{ b: number }>('SELECT COALESCE(SUM(amount),0) b FROM customer_ledger WHERE customer_id = ?', customerId)!.b;
}

export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.startsWith('90') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  return d || null;
}

export interface CustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  shoe_size?: string | null;
  city?: string | null;
  address?: string | null;
  tax_no?: string | null;
  tax_office?: string | null;
  notes?: string | null;
  kvkk_consent?: boolean;
  sms_consent?: boolean;
  credit_limit?: number;
  home_store_id?: number | null;
}

const FIELDS = ['name', 'phone', 'email', 'birth_date', 'gender', 'shoe_size', 'city', 'address', 'tax_no', 'tax_office', 'notes'] as const;

export function saveCustomer(user: AuthUser, input: CustomerInput, id?: number, canCredit = false) {
  if (!input.name?.trim()) throw badRequest('Müşteri adı zorunludur');
  const phone = normalizePhone(input.phone);
  if (phone && phone.length !== 10) throw badRequest('Telefon 10 haneli olmalı (5xx xxx xx xx)');
  if (phone) {
    const dup = one<{ id: number; name: string }>(
      'SELECT id, name FROM customers WHERE tenant_id = ? AND phone = ? AND id <> ? AND active = 1',
      user.tenantId, phone, id ?? 0,
    );
    if (dup) throw badRequest(`Bu telefon numarası zaten kayıtlı: ${dup.name}`);
  }
  const vals: Record<string, unknown> = {};
  for (const f of FIELDS) vals[f] = (input[f] as string | null | undefined)?.toString().trim() || null;
  vals.name = input.name.trim();
  vals.phone = phone;
  vals.kvkk_consent = input.kvkk_consent ? 1 : 0;
  vals.sms_consent = input.sms_consent ? 1 : 0;
  vals.home_store_id = input.home_store_id ?? null;
  if (canCredit && input.credit_limit !== undefined) {
    if (!Number.isInteger(input.credit_limit) || input.credit_limit < 0) throw badRequest('Veresiye limiti geçersiz');
    vals.credit_limit = input.credit_limit;
  }
  const keys = Object.keys(vals);
  if (id) {
    const ex = one('SELECT id FROM customers WHERE id = ? AND tenant_id = ?', id, user.tenantId);
    if (!ex) throw notFound('Müşteri bulunamadı');
    run(`UPDATE customers SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => vals[k]), id);
    audit(user, user.tenantId, 'customer.update', 'customer', id);
    return getCustomer(user, id);
  }
  const r = run(
    `INSERT INTO customers (tenant_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
    user.tenantId, ...keys.map((k) => vals[k]),
  );
  audit(user, user.tenantId, 'customer.create', 'customer', r.lastInsertRowid);
  return getCustomer(user, Number(r.lastInsertRowid));
}

export function searchCustomers(tenantId: number, q: string, opts: { segment?: string; limit?: number } = {}) {
  const where = ['c.tenant_id = ?', 'c.active = 1'];
  const params: unknown[] = [tenantId];
  if (q) {
    const phone = normalizePhone(q);
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
    params.push(`%${q}%`, `%${phone ?? q}%`, `%${q}%`);
  }
  let outer = '';
  switch (opts.segment) {
    case 'debt':
      outer = 'WHERE balance > 0';
      break;
    case 'vip':
      outer = 'WHERE total_spent >= 1000000'; // 10.000 TL üzeri
      break;
    case 'lost':
      outer = "WHERE last_purchase IS NOT NULL AND last_purchase < date('now','localtime','-180 days')";
      break;
    case 'birthday':
      where.push("strftime('%m', c.birth_date) = strftime('%m', 'now', 'localtime')");
      break;
    case 'new':
      where.push("c.created_at >= date('now','localtime','-30 days')");
      break;
  }
  return all(
    `SELECT * FROM (SELECT c.id, c.name, c.phone, c.email, c.shoe_size, c.points, c.credit_limit, c.birth_date, c.sms_consent, c.created_at,
            COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id = c.id),0) AS balance,
            COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id AND status = 'completed'),0) AS total_spent,
            (SELECT COUNT(*) FROM sales WHERE customer_id = c.id AND status = 'completed' AND type = 'sale') AS visits,
            (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id AND status = 'completed') AS last_purchase
       FROM customers c WHERE ${where.join(' AND ')}) ${outer}
      ORDER BY ${q ? 'name' : 'id DESC'} LIMIT ?`,
    ...params, Math.min(opts.limit ?? 100, 2000),
  );
}

export function getCustomer(user: AuthUser, id: number) {
  const c = one<Record<string, unknown>>('SELECT * FROM customers WHERE id = ? AND tenant_id = ?', id, user.tenantId);
  if (!c) throw notFound('Müşteri bulunamadı');
  const balance = customerBalance(id);
  const stats = one(
    `SELECT COUNT(CASE WHEN type='sale' THEN 1 END) visits, COALESCE(SUM(total),0) total_spent, COALESCE(SUM(item_count),0) pairs,
            MAX(created_at) last_purchase, MIN(created_at) first_purchase
       FROM sales WHERE customer_id = ? AND status = 'completed'`,
    id,
  );
  const sales = all(
    `SELECT s.id, s.receipt_no, s.type, s.status, s.total, s.item_count, s.created_at, st.name AS store_name
       FROM sales s JOIN stores st ON st.id = s.store_id WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 100`,
    id,
  );
  const products = all(
    `SELECT p.code, p.name, v.color, v.size, SUM(si.qty) qty, MAX(s.created_at) last_date
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
      WHERE s.customer_id = ? AND s.status = 'completed' GROUP BY v.id HAVING qty > 0 ORDER BY last_date DESC LIMIT 50`,
    id,
  );
  const ledger = all(
    `SELECT cl.*, u.name AS user_name, st.name AS store_name FROM customer_ledger cl
       LEFT JOIN users u ON u.id = cl.user_id LEFT JOIN stores st ON st.id = cl.store_id
      WHERE cl.customer_id = ? ORDER BY cl.id DESC LIMIT 200`,
    id,
  );
  const orders = all('SELECT * FROM customer_orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50', id);
  const giftCards = all('SELECT code, balance, expires_at, active FROM gift_cards WHERE customer_id = ? AND active = 1 AND balance > 0', id);
  return { ...c, balance, stats, sales, products, ledger, orders, giftCards };
}

/** Veresiye tahsilatı */
export function collectPayment(
  user: AuthUser,
  customerId: number,
  input: { storeId: number; amount: number; method: 'cash' | 'card' | 'transfer'; note?: string },
) {
  const storeId = assertStore(user, input.storeId);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest('Tutar geçersiz');
  return tx(() => {
    const c = one<{ id: number; name: string }>('SELECT id, name FROM customers WHERE id = ? AND tenant_id = ?', customerId, user.tenantId);
    if (!c) throw notFound('Müşteri bulunamadı');
    const r = run(
      `INSERT INTO customer_ledger (tenant_id, customer_id, store_id, type, amount, method, note, user_id)
       VALUES (?,?,?,'payment',?,?,?,?)`,
      user.tenantId, customerId, storeId, -input.amount, input.method, input.note ?? null, user.id,
    );
    recordCash(user, {
      storeId, type: 'collection', method: input.method, category: 'Veresiye tahsilatı', amount: input.amount,
      note: c.name, refType: 'customer_ledger', refId: Number(r.lastInsertRowid),
    });
    audit(user, user.tenantId, 'customer.payment', 'customer', customerId, { amount: input.amount, method: input.method });
    return { balance: customerBalance(customerId) };
  });
}

export function adjustBalance(user: AuthUser, customerId: number, amount: number, note: string) {
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('Tutar geçersiz');
  if (!note?.trim()) throw badRequest('Açıklama zorunludur');
  const c = one('SELECT id FROM customers WHERE id = ? AND tenant_id = ?', customerId, user.tenantId);
  if (!c) throw notFound('Müşteri bulunamadı');
  run(
    `INSERT INTO customer_ledger (tenant_id, customer_id, type, amount, note, user_id) VALUES (?,?,'adjust',?,?,?)`,
    user.tenantId, customerId, amount, note.trim(), user.id,
  );
  audit(user, user.tenantId, 'customer.adjust', 'customer', customerId, { amount, note });
  return { balance: customerBalance(customerId) };
}

export function receivables(tenantId: number) {
  return all(
    `SELECT c.id, c.name, c.phone, c.credit_limit, SUM(cl.amount) balance,
            MIN(CASE WHEN cl.type='sale' THEN cl.due_date END) oldest_due,
            MAX(CASE WHEN cl.type='payment' THEN cl.created_at END) last_payment
       FROM customers c JOIN customer_ledger cl ON cl.customer_id = c.id
      WHERE c.tenant_id = ? GROUP BY c.id HAVING balance > 0 ORDER BY balance DESC`,
    tenantId,
  );
}
