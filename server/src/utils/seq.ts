import { getDb } from '../db/index.js';

/** Firma bazında artan sıra numarası üretir (transaction içinde çağrılmalı). */
export function nextSeq(tenantId: number, key: string): number {
  const db = getDb();
  db.prepare('INSERT INTO sequences (tenant_id, key, value) VALUES (?, ?, 0) ON CONFLICT DO NOTHING').run(tenantId, key);
  db.prepare('UPDATE sequences SET value = value + 1 WHERE tenant_id = ? AND key = ?').run(tenantId, key);
  const row = db.prepare('SELECT value FROM sequences WHERE tenant_id = ? AND key = ?').get(tenantId, key) as { value: number };
  return row.value;
}

export function docNo(prefix: string, n: number, width = 6) {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
