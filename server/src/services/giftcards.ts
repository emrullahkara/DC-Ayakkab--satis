import { randomInt } from 'node:crypto';
import { all, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { addDays, today } from '../utils/dates.js';
import { audit } from './audit.js';
import { recordCash } from './register.js';

const ALPHABET = 'ABCDEFGHJKLMNPRSTUVYZ23456789';

export function randomGiftCode(tenantId: number): string {
  for (let tries = 0; tries < 20; tries++) {
    let code = 'HC';
    for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    if (!one('SELECT 1 FROM gift_cards WHERE tenant_id = ? AND code = ?', tenantId, code)) return code;
  }
  throw new Error('Hediye çeki kodu üretilemedi');
}

export function listGiftCards(tenantId: number, q?: string) {
  return all(
    `SELECT g.*, c.name AS customer_name FROM gift_cards g LEFT JOIN customers c ON c.id = g.customer_id
      WHERE g.tenant_id = ? ${q ? 'AND (g.code LIKE ? OR c.name LIKE ?)' : ''} ORDER BY g.id DESC LIMIT 300`,
    tenantId, ...(q ? [`%${q}%`, `%${q}%`] : []),
  );
}

export function checkGiftCard(tenantId: number, code: string) {
  const g = one<{ code: string; balance: number; expires_at: string | null; active: number }>(
    'SELECT code, balance, expires_at, active FROM gift_cards WHERE tenant_id = ? AND code = ?',
    tenantId, code.trim().toUpperCase(),
  );
  if (!g) throw notFound('Hediye çeki bulunamadı');
  return { ...g, expired: !!g.expires_at && g.expires_at < today() };
}

/** Hediye çeki satışı: para kasaya girer, çek oluşturulur. */
export function sellGiftCard(
  user: AuthUser,
  input: { storeId: number; amount: number; method: 'cash' | 'card' | 'transfer'; customerId?: number | null; validDays?: number; note?: string },
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest('Tutar geçersiz');
  return tx(() => {
    const code = randomGiftCode(user.tenantId);
    const r = run(
      `INSERT INTO gift_cards (tenant_id, code, initial_amount, balance, customer_id, expires_at, note, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      user.tenantId, code, input.amount, input.amount, input.customerId ?? null,
      addDays(today(), input.validDays ?? 365), input.note ?? null, user.id,
    );
    recordCash(user, {
      storeId: input.storeId, type: 'income', method: input.method, category: 'Hediye çeki satışı',
      amount: input.amount, note: code, refType: 'gift_card', refId: Number(r.lastInsertRowid),
    });
    audit(user, user.tenantId, 'giftcard.sell', 'gift_card', r.lastInsertRowid, { code, amount: input.amount });
    return one('SELECT * FROM gift_cards WHERE id = ?', r.lastInsertRowid);
  });
}
