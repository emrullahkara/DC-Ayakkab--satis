import { all, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore } from '../auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { audit } from './audit.js';

export type CashType = 'expense' | 'income' | 'deposit' | 'withdraw' | 'collection' | 'supplier_payment';

export const CASH_LABELS: Record<CashType, string> = {
  expense: 'Gider',
  income: 'Gelir',
  deposit: 'Bankaya yatırılan',
  withdraw: 'Kasadan alınan',
  collection: 'Tahsilat',
  supplier_payment: 'Tedarikçi ödemesi',
};

const CASH_IN: CashType[] = ['income', 'collection'];

export const EXPENSE_CATEGORIES = [
  'Kira', 'Elektrik / su / doğalgaz', 'Personel maaş / avans', 'Yemek / çay', 'Kargo', 'Temizlik', 'Poşet / ambalaj',
  'Vergi / SGK', 'Bakım onarım', 'Reklam', 'Diğer',
];

export function openSessionFor(tenantId: number, storeId: number) {
  return one<{ id: number; opened_at: string; opening_cash: number; opened_by: number }>(
    "SELECT * FROM register_sessions WHERE tenant_id = ? AND store_id = ? AND status = 'open'",
    tenantId, storeId,
  );
}

export function recordCash(
  user: AuthUser,
  input: { storeId: number; type: CashType; method?: string; category?: string | null; amount: number; note?: string | null; refType?: string; refId?: number },
) {
  const storeId = assertStore(user, input.storeId);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest('Tutar sıfırdan büyük olmalı');
  const method = input.method ?? 'cash';
  if (!['cash', 'card', 'transfer'].includes(method)) throw badRequest('Geçersiz ödeme şekli');
  const session = openSessionFor(user.tenantId, storeId);
  if (method === 'cash' && !session) throw badRequest('Nakit işlem için kasanın açık olması gerekir');
  const r = run(
    `INSERT INTO cash_movements (tenant_id, store_id, register_session_id, type, method, category, amount, note, ref_type, ref_id, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    user.tenantId, storeId, session?.id ?? null, input.type, method, input.category ?? null, input.amount,
    input.note ?? null, input.refType ?? null, input.refId ?? null, user.id,
  );
  audit(user, user.tenantId, 'cash.' + input.type, 'cash_movement', r.lastInsertRowid, { amount: input.amount, method });
  return Number(r.lastInsertRowid);
}

export function sessionSummary(sessionId: number) {
  const s = one<{ id: number; opening_cash: number; store_id: number; tenant_id: number }>('SELECT * FROM register_sessions WHERE id = ?', sessionId);
  if (!s) throw notFound('Kasa oturumu bulunamadı');
  const byMethod = all<{ method: string; amount: number; n: number }>(
    `SELECT sp.method, SUM(sp.amount) amount, COUNT(DISTINCT sp.sale_id) n FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
      WHERE sa.register_session_id = ? AND sa.status = 'completed' GROUP BY sp.method`,
    sessionId,
  );
  const counts = one<{ sales: number; returns: number; gross: number; items: number; discount: number }>(
    `SELECT SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END) sales, SUM(CASE WHEN type<>'sale' THEN 1 ELSE 0 END) returns,
            COALESCE(SUM(total),0) gross, COALESCE(SUM(item_count),0) items, COALESCE(SUM(discount_total),0) discount
       FROM sales WHERE register_session_id = ? AND status = 'completed'`,
    sessionId,
  )!;
  const cash = all<{ type: CashType; method: string; amount: number; n: number }>(
    'SELECT type, method, SUM(amount) amount, COUNT(*) n FROM cash_movements WHERE register_session_id = ? GROUP BY type, method',
    sessionId,
  );
  const cashSales = byMethod.find((m) => m.method === 'cash')?.amount ?? 0;
  const cashMoves = cash
    .filter((c) => c.method === 'cash')
    .reduce((a, c) => a + (CASH_IN.includes(c.type) ? c.amount : -c.amount), 0);
  const expectedCash = s.opening_cash + cashSales + cashMoves;
  const cancelled = one<{ n: number }>("SELECT COUNT(*) n FROM sales WHERE register_session_id = ? AND status = 'cancelled'", sessionId)!.n;
  return {
    openingCash: s.opening_cash,
    byMethod,
    cashMovements: cash,
    salesCount: counts.sales ?? 0,
    returnsCount: counts.returns ?? 0,
    cancelledCount: cancelled,
    netTotal: counts.gross,
    items: counts.items,
    discount: counts.discount,
    cashSales,
    expectedCash,
  };
}

export function currentRegister(user: AuthUser, storeId: number) {
  assertStore(user, storeId);
  const s = openSessionFor(user.tenantId, storeId);
  if (!s) return { open: false as const };
  const opener = one<{ name: string }>('SELECT name FROM users WHERE id = ?', s.opened_by);
  const movements = all(
    `SELECT cm.*, u.name AS user_name FROM cash_movements cm LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.register_session_id = ? ORDER BY cm.id DESC`,
    s.id,
  );
  return { open: true as const, session: { ...s, opened_by_name: opener?.name }, summary: sessionSummary(s.id), movements };
}

export function openRegister(user: AuthUser, storeId: number, openingCash: number, note?: string) {
  assertStore(user, storeId);
  if (!Number.isInteger(openingCash) || openingCash < 0) throw badRequest('Açılış tutarı geçersiz');
  return tx(() => {
    if (openSessionFor(user.tenantId, storeId)) throw badRequest('Bu mağazada zaten açık bir kasa var');
    const r = run(
      'INSERT INTO register_sessions (tenant_id, store_id, opened_by, opening_cash, note) VALUES (?,?,?,?,?)',
      user.tenantId, storeId, user.id, openingCash, note ?? null,
    );
    audit(user, user.tenantId, 'register.open', 'register_session', r.lastInsertRowid, { openingCash });
    return currentRegister(user, storeId);
  });
}

/** Gün sonu: sayılan nakit ile beklenen nakit karşılaştırılır, fark kaydedilir. */
export function closeRegister(user: AuthUser, storeId: number, countedCash: number, note?: string) {
  assertStore(user, storeId);
  if (!Number.isInteger(countedCash) || countedCash < 0) throw badRequest('Sayılan tutar geçersiz');
  return tx(() => {
    const s = openSessionFor(user.tenantId, storeId);
    if (!s) throw badRequest('Açık kasa yok');
    const summary = sessionSummary(s.id);
    const diff = countedCash - summary.expectedCash;
    run(
      `UPDATE register_sessions SET status = 'closed', closed_by = ?, closed_at = datetime('now','localtime'),
              expected_cash = ?, counted_cash = ?, difference = ?, summary = ?, note = COALESCE(?, note) WHERE id = ?`,
      user.id, summary.expectedCash, countedCash, diff, JSON.stringify(summary), note ?? null, s.id,
    );
    audit(user, user.tenantId, 'register.close', 'register_session', s.id, { expected: summary.expectedCash, countedCash, diff });
    return sessionReport(user, s.id);
  });
}

export function sessionReport(user: AuthUser, sessionId: number) {
  const s = one<Record<string, unknown> & { store_id: number; status: string; summary: string | null }>(
    `SELECT rs.*, st.name AS store_name, uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM register_sessions rs JOIN stores st ON st.id = rs.store_id
       LEFT JOIN users uo ON uo.id = rs.opened_by LEFT JOIN users uc ON uc.id = rs.closed_by
      WHERE rs.id = ? AND rs.tenant_id = ?`,
    sessionId, user.tenantId,
  );
  if (!s) throw notFound('Kasa oturumu bulunamadı');
  assertStore(user, s.store_id);
  const summary = s.status === 'closed' && s.summary ? JSON.parse(s.summary) : sessionSummary(sessionId);
  const movements = all(
    `SELECT cm.*, u.name AS user_name FROM cash_movements cm LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.register_session_id = ? ORDER BY cm.id`,
    sessionId,
  );
  return { ...s, summary, movements };
}

export function listSessions(tenantId: number, storeIds: number[], from: string, toExclusive: string) {
  return all(
    `SELECT rs.id, rs.store_id, rs.status, rs.opened_at, rs.closed_at, rs.opening_cash, rs.expected_cash, rs.counted_cash, rs.difference,
            st.name AS store_name, uo.name AS opened_by_name, uc.name AS closed_by_name,
            (SELECT COALESCE(SUM(total),0) FROM sales WHERE register_session_id = rs.id AND status = 'completed') AS net_total
       FROM register_sessions rs JOIN stores st ON st.id = rs.store_id
       LEFT JOIN users uo ON uo.id = rs.opened_by LEFT JOIN users uc ON uc.id = rs.closed_by
      WHERE rs.tenant_id = ? AND rs.store_id IN (${storeIds.join(',')}) AND rs.opened_at >= ? AND rs.opened_at < ?
      ORDER BY rs.id DESC`,
    tenantId, from, toExclusive,
  );
}

export function listCashMovements(tenantId: number, storeIds: number[], from: string, toExclusive: string, type?: string) {
  return all(
    `SELECT cm.*, st.name AS store_name, u.name AS user_name FROM cash_movements cm
       JOIN stores st ON st.id = cm.store_id LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.tenant_id = ? AND cm.store_id IN (${storeIds.join(',')}) AND cm.created_at >= ? AND cm.created_at < ?
        ${type ? 'AND cm.type = ?' : ''}
      ORDER BY cm.id DESC LIMIT 1000`,
    tenantId, from, toExclusive, ...(type ? [type] : []),
  );
}
