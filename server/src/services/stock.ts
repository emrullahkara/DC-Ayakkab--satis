import { getDb, one } from '../db/index.js';
import { badRequest } from '../utils/errors.js';
import { queueMarketplaceStock } from '../integrations/outbox.js';

export type MovementType =
  | 'purchase' | 'sale' | 'return' | 'transfer_out' | 'transfer_in' | 'count' | 'damage' | 'manual' | 'opening' | 'marketplace';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  purchase: 'Mal kabul',
  sale: 'Satış',
  return: 'İade',
  transfer_out: 'Transfer çıkış',
  transfer_in: 'Transfer giriş',
  count: 'Sayım farkı',
  damage: 'Fire / defolu',
  manual: 'Elle düzeltme',
  opening: 'Açılış stoğu',
  marketplace: 'Pazaryeri satışı',
};

export function stockQty(storeId: number, variantId: number): number {
  return one<{ qty: number }>('SELECT qty FROM stock WHERE store_id = ? AND variant_id = ?', storeId, variantId)?.qty ?? 0;
}

interface ChangeOpts {
  tenantId: number;
  storeId: number;
  variantId: number;
  qty: number;
  type: MovementType;
  userId?: number | null;
  refType?: string;
  refId?: number | bigint;
  unitCost?: number | null;
  note?: string | null;
  /** false ise stok eksiye düşecekse hata verir */
  allowNegative?: boolean;
}

/** Stoğu değiştirir ve hareket kaydı atar. Transaction içinde çağrılmalıdır. */
export function changeStock(o: ChangeOpts) {
  if (!Number.isInteger(o.qty) || o.qty === 0) return;
  const db = getDb();
  if (o.allowNegative === false && o.qty < 0) {
    const cur = stockQty(o.storeId, o.variantId);
    if (cur + o.qty < 0) {
      const v = one<{ code: string; color: string; size: string }>(
        'SELECT p.code, v.color, v.size FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?',
        o.variantId,
      );
      throw badRequest(`Yetersiz stok: ${v?.code} ${v?.color} ${v?.size} numara (mevcut ${cur})`);
    }
  }
  db.prepare(
    `INSERT INTO stock (store_id, variant_id, qty, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT (store_id, variant_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at`,
  ).run(o.storeId, o.variantId, o.qty);
  db.prepare(
    `INSERT INTO stock_movements (tenant_id, store_id, variant_id, qty, type, ref_type, ref_id, unit_cost, note, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    o.tenantId, o.storeId, o.variantId, o.qty, o.type, o.refType ?? null,
    o.refId == null ? null : Number(o.refId), o.unitCost ?? null, o.note ?? null, o.userId ?? null,
  );
  queueMarketplaceStock(o.tenantId, o.storeId, o.variantId);
}
