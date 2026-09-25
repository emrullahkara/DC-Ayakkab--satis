import { all, getDb, one, run } from '../db/index.js';
import { getSettings } from '../services/settings.js';
import { MARKETPLACES } from './providers.js';

export interface IntegrationRow {
  tenant_id: number;
  provider: string;
  enabled: number;
  mode: 'test' | 'live';
  config: string;
}

export function getIntegration(tenantId: number, provider: string) {
  const row = one<IntegrationRow>('SELECT * FROM integration_settings WHERE tenant_id = ? AND provider = ?', tenantId, provider);
  if (!row) return null;
  let cfg: Record<string, string> = {};
  try {
    cfg = JSON.parse(row.config || '{}');
  } catch {
    cfg = {};
  }
  return { enabled: !!row.enabled, mode: row.mode, config: cfg };
}

export function isEnabled(tenantId: number, provider: string) {
  return !!getIntegration(tenantId, provider)?.enabled;
}

/** Dış sisteme gidecek işi kuyruğa ekler. Entegrasyon kapalıysa hiçbir şey yapmaz. */
export function enqueue(
  tenantId: number,
  provider: string,
  action: string,
  payload: unknown,
  ref?: { type: string; id: number | bigint },
  opts: { force?: boolean } = {},
): number | null {
  if (!opts.force && !isEnabled(tenantId, provider)) return null;
  const r = run(
    'INSERT INTO outbox (tenant_id, provider, action, payload, ref_type, ref_id) VALUES (?,?,?,?,?,?)',
    tenantId, provider, action, JSON.stringify(payload ?? {}), ref?.type ?? null, ref ? Number(ref.id) : null,
  );
  return Number(r.lastInsertRowid);
}

/**
 * Pazaryeri stok eşitlemesi: stok değişince ilgili ürün pazaryerine açıksa kuyruğa eklenir.
 * Aynı barkod için bekleyen iş varsa yenisi eklenmez (gönderim anındaki güncel stok gönderilir).
 */
export function queueMarketplaceStock(tenantId: number, storeId: number, variantId: number) {
  const active = MARKETPLACES.filter((m) => isEnabled(tenantId, m));
  if (!active.length) return;
  const settings = getSettings(tenantId);
  if (!settings.marketplace.storeId || settings.marketplace.storeId !== storeId) return;
  const p = one<{ marketplace_sync: number }>(
    'SELECT p.marketplace_sync FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?',
    variantId,
  );
  if (!p?.marketplace_sync) return;
  const db = getDb();
  for (const m of active) {
    const exists = db
      .prepare(
        "SELECT 1 FROM outbox WHERE tenant_id = ? AND provider = ? AND action = 'stock_update' AND ref_id = ? AND status = 'pending'",
      )
      .get(tenantId, m, variantId);
    if (!exists) enqueue(tenantId, m, 'stock_update', { variantId }, { type: 'variant', id: variantId });
  }
}

export function outboxList(tenantId: number, filter: { status?: string; provider?: string; limit?: number }) {
  const where = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.provider) {
    where.push('provider = ?');
    params.push(filter.provider);
  }
  return all(
    `SELECT * FROM outbox WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${Math.min(Number(filter.limit) || 100, 500)}`,
    ...params,
  );
}
