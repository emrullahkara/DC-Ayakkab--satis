import { all, getDb, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore, hasPerm, inList } from '../auth.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { internalEan13 } from '../utils/barcode.js';
import { nextSeq } from '../utils/seq.js';
import { audit } from './audit.js';
import { changeStock } from './stock.js';

export interface ProductInput {
  code: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  brand_id?: number | null;
  category_id?: number | null;
  supplier_id?: number | null;
  gender?: string | null;
  season?: string | null;
  material?: string | null;
  cost_price?: number;
  sale_price?: number;
  vat_rate?: number;
  min_stock?: number;
  description?: string | null;
  image_url?: string | null;
  marketplace_sync?: boolean;
  active?: boolean;
  colors?: string[];
  sizes?: string[];
  variants?: { color: string; size: string; barcode?: string | null }[];
}

export function ensureBrand(tenantId: number, name?: string | null): number | null {
  const n = name?.trim();
  if (!n) return null;
  const ex = one<{ id: number }>('SELECT id FROM brands WHERE tenant_id = ? AND name = ? COLLATE NOCASE', tenantId, n);
  if (ex) return ex.id;
  return Number(run('INSERT INTO brands (tenant_id, name) VALUES (?,?)', tenantId, n).lastInsertRowid);
}

export function ensureCategory(tenantId: number, name?: string | null): number | null {
  const n = name?.trim();
  if (!n) return null;
  const ex = one<{ id: number }>('SELECT id FROM categories WHERE tenant_id = ? AND name = ? COLLATE NOCASE', tenantId, n);
  if (ex) return ex.id;
  return Number(run('INSERT INTO categories (tenant_id, name) VALUES (?,?)', tenantId, n).lastInsertRowid);
}

export function newBarcode(tenantId: number): string {
  for (let i = 0; i < 50; i++) {
    const code = internalEan13(tenantId, nextSeq(tenantId, 'barcode'));
    if (!one('SELECT 1 FROM variants WHERE tenant_id = ? AND barcode = ?', tenantId, code)) return code;
  }
  throw new Error('Barkod üretilemedi');
}

function checkBarcode(tenantId: number, barcode: string, exceptVariant = 0) {
  const b = barcode.trim();
  if (!/^[0-9A-Za-z\-.]{4,32}$/.test(b)) throw badRequest('Barkod 4-32 karakter, harf/rakam olmalı: ' + b);
  const ex = one<{ code: string; color: string; size: string }>(
    `SELECT p.code, v.color, v.size FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.tenant_id = ? AND v.barcode = ? AND v.id <> ?`,
    tenantId, b, exceptVariant,
  );
  if (ex) throw conflict(`Bu barkod başka bir üründe kayıtlı: ${ex.code} ${ex.color} ${ex.size}`);
  return b;
}

function addVariant(tenantId: number, productId: number, color: string, size: string, barcode?: string | null) {
  const c = color.trim();
  const s = size.trim();
  if (!c || !s) throw badRequest('Renk ve numara boş olamaz');
  const ex = one<{ id: number; active: number }>('SELECT id, active FROM variants WHERE product_id = ? AND color = ? AND size = ?', productId, c, s);
  if (ex) {
    if (!ex.active) run('UPDATE variants SET active = 1 WHERE id = ?', ex.id);
    return ex.id;
  }
  const code = barcode ? checkBarcode(tenantId, barcode) : newBarcode(tenantId);
  return Number(
    run('INSERT INTO variants (tenant_id, product_id, color, size, barcode) VALUES (?,?,?,?,?)', tenantId, productId, c, s, code).lastInsertRowid,
  );
}

function money(v: unknown, field: string): number {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0) throw badRequest(field + ' geçersiz');
  return n;
}

export function saveProduct(user: AuthUser, input: ProductInput, id?: number) {
  if (!input.code?.trim()) throw badRequest('Model kodu zorunludur');
  if (!input.name?.trim()) throw badRequest('Ürün adı zorunludur');
  const vat = Number(input.vat_rate ?? 10);
  if (![0, 1, 10, 20].includes(vat)) throw badRequest('KDV oranı 0, 1, 10 veya 20 olmalı');
  return tx(() => {
    const t = user.tenantId;
    const dup = one<{ id: number }>('SELECT id FROM products WHERE tenant_id = ? AND code = ? AND id <> ?', t, input.code.trim(), id ?? 0);
    if (dup) throw conflict('Bu model kodu zaten kayıtlı: ' + input.code);
    const brandId = input.brand_id ?? ensureBrand(t, input.brand);
    const categoryId = input.category_id ?? ensureCategory(t, input.category);
    if (input.supplier_id && !one('SELECT 1 FROM suppliers WHERE id = ? AND tenant_id = ?', input.supplier_id, t)) throw badRequest('Tedarikçi bulunamadı');
    const canPrice = hasPerm(user, 'prices.edit');
    const vals: Record<string, unknown> = {
      code: input.code.trim(),
      name: input.name.trim(),
      brand_id: brandId,
      category_id: categoryId,
      supplier_id: input.supplier_id ?? null,
      gender: input.gender || null,
      season: input.season?.trim() || null,
      material: input.material?.trim() || null,
      vat_rate: vat,
      min_stock: Math.max(0, Math.round(Number(input.min_stock ?? 1))),
      description: input.description || null,
      image_url: input.image_url || null,
      marketplace_sync: input.marketplace_sync ? 1 : 0,
      active: input.active === false ? 0 : 1,
    };
    if (!id || canPrice) {
      vals.sale_price = money(input.sale_price, 'Satış fiyatı');
      if (hasPerm(user, 'costs.view') || !id) vals.cost_price = money(input.cost_price, 'Alış fiyatı');
    }
    let productId = id;
    if (id) {
      const ex = one<{ sale_price: number }>('SELECT sale_price FROM products WHERE id = ? AND tenant_id = ?', id, t);
      if (!ex) throw notFound('Ürün bulunamadı');
      const keys = Object.keys(vals);
      run(
        `UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`,
        ...keys.map((k) => vals[k]), id,
      );
      audit(user, t, 'product.update', 'product', id, vals.sale_price !== undefined && vals.sale_price !== ex.sale_price ? { oldPrice: ex.sale_price, newPrice: vals.sale_price } : undefined);
    } else {
      const keys = Object.keys(vals);
      productId = Number(
        run(`INSERT INTO products (tenant_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`, t, ...keys.map((k) => vals[k])).lastInsertRowid,
      );
      audit(user, t, 'product.create', 'product', productId, { code: vals.code });
    }
    for (const color of input.colors ?? []) for (const size of input.sizes ?? []) addVariant(t, productId!, color, size);
    for (const v of input.variants ?? []) addVariant(t, productId!, v.color, v.size, v.barcode);
    return getProduct(user, productId!);
  });
}

export function updateVariant(user: AuthUser, variantId: number, input: { barcode?: string; sale_price?: number | null; active?: boolean; color?: string; size?: string }) {
  const v = one<{ id: number; product_id: number }>('SELECT id, product_id FROM variants WHERE id = ? AND tenant_id = ?', variantId, user.tenantId);
  if (!v) throw notFound('Varyant bulunamadı');
  if (input.barcode !== undefined) run('UPDATE variants SET barcode = ? WHERE id = ?', checkBarcode(user.tenantId, input.barcode, variantId), variantId);
  if (input.sale_price !== undefined) {
    if (!hasPerm(user, 'prices.edit')) throw badRequest('Fiyat değiştirme yetkiniz yok');
    run('UPDATE variants SET sale_price = ? WHERE id = ?', input.sale_price === null ? null : money(input.sale_price, 'Fiyat'), variantId);
  }
  if (input.active !== undefined) run('UPDATE variants SET active = ? WHERE id = ?', input.active ? 1 : 0, variantId);
  if (input.color || input.size) {
    const cur = one<{ color: string; size: string }>('SELECT color, size FROM variants WHERE id = ?', variantId)!;
    const color = input.color?.trim() || cur.color;
    const size = input.size?.trim() || cur.size;
    if (one('SELECT 1 FROM variants WHERE product_id = ? AND color = ? AND size = ? AND id <> ?', v.product_id, color, size, variantId)) {
      throw conflict('Bu renk/numara zaten var');
    }
    run('UPDATE variants SET color = ?, size = ? WHERE id = ?', color, size, variantId);
  }
  audit(user, user.tenantId, 'variant.update', 'variant', variantId, input);
  return one('SELECT * FROM variants WHERE id = ?', variantId);
}

export function deleteVariant(user: AuthUser, variantId: number) {
  const v = one<{ id: number }>('SELECT id FROM variants WHERE id = ? AND tenant_id = ?', variantId, user.tenantId);
  if (!v) throw notFound('Varyant bulunamadı');
  const used = one('SELECT 1 FROM stock_movements WHERE variant_id = ? LIMIT 1', variantId) || one('SELECT 1 FROM sale_items WHERE variant_id = ? LIMIT 1', variantId);
  if (used) {
    run('UPDATE variants SET active = 0 WHERE id = ?', variantId);
    return { deactivated: true };
  }
  run('DELETE FROM stock WHERE variant_id = ?', variantId);
  run('DELETE FROM variants WHERE id = ?', variantId);
  return { deleted: true };
}

export interface ProductFilter {
  q?: string;
  brandId?: number;
  categoryId?: number;
  supplierId?: number;
  season?: string;
  gender?: string;
  active?: string;
  stock?: 'in' | 'out' | 'low';
  storeIds: number[];
  limit?: number;
  offset?: number;
}

export function listProducts(user: AuthUser, f: ProductFilter) {
  const where = ['p.tenant_id = ?'];
  const params: unknown[] = [user.tenantId];
  if (f.q) {
    where.push('(p.code LIKE ? OR p.name LIKE ? OR p.id IN (SELECT product_id FROM variants WHERE tenant_id = ? AND barcode = ?))');
    params.push(`%${f.q}%`, `%${f.q}%`, user.tenantId, f.q);
  }
  if (f.brandId) (where.push('p.brand_id = ?'), params.push(f.brandId));
  if (f.categoryId) (where.push('p.category_id = ?'), params.push(f.categoryId));
  if (f.supplierId) (where.push('p.supplier_id = ?'), params.push(f.supplierId));
  if (f.season) (where.push('p.season = ?'), params.push(f.season));
  if (f.gender) (where.push('p.gender = ?'), params.push(f.gender));
  if (f.active !== 'all') where.push(`p.active = ${f.active === '0' ? 0 : 1}`);
  const stores = inList(f.storeIds);
  let outer = '';
  if (f.stock === 'in') outer = 'WHERE stock_qty > 0';
  if (f.stock === 'out') outer = 'WHERE stock_qty <= 0';
  if (f.stock === 'low') outer = 'WHERE stock_qty <= min_stock * variant_count';
  const rows = all<Record<string, unknown>>(
    `SELECT * FROM (SELECT p.id, p.code, p.name, p.gender, p.season, p.material, p.sale_price, p.cost_price, p.vat_rate, p.active, p.image_url, p.min_stock,
            p.marketplace_sync, b.name AS brand, c.name AS category, s.name AS supplier,
            (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS variant_count,
            (SELECT GROUP_CONCAT(DISTINCT v.color) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS colors,
            COALESCE((SELECT SUM(st.qty) FROM stock st JOIN variants v ON v.id = st.variant_id WHERE v.product_id = p.id AND st.store_id IN (${stores})),0) AS stock_qty
       FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${where.join(' AND ')}) ${outer}
      ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params, Math.min(f.limit ?? 100, 2000), f.offset ?? 0,
  );
  if (!hasPerm(user, 'costs.view')) rows.forEach((r) => delete r.cost_price);
  return rows;
}

export function getProduct(user: AuthUser, id: number) {
  const p = one<Record<string, unknown>>(
    `SELECT p.*, b.name AS brand, c.name AS category, s.name AS supplier FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ? AND p.tenant_id = ?`,
    id, user.tenantId,
  );
  if (!p) throw notFound('Ürün bulunamadı');
  if (!hasPerm(user, 'costs.view')) delete p.cost_price;
  const variants = all<{ id: number }>('SELECT * FROM variants WHERE product_id = ? ORDER BY color, CAST(size AS REAL), size', id);
  const stores = all<{ id: number; code: string; name: string; is_warehouse: number }>(
    'SELECT id, code, name, is_warehouse FROM stores WHERE tenant_id = ? AND active = 1 ORDER BY is_warehouse, id',
    user.tenantId,
  );
  const stock = all<{ store_id: number; variant_id: number; qty: number }>(
    `SELECT st.store_id, st.variant_id, st.qty FROM stock st JOIN variants v ON v.id = st.variant_id WHERE v.product_id = ?`,
    id,
  );
  const sales30 = all<{ variant_id: number; qty: number }>(
    `SELECT si.variant_id, SUM(si.qty) qty FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN variants v ON v.id = si.variant_id
      WHERE v.product_id = ? AND s.status = 'completed' AND s.created_at >= date('now','localtime','-30 days') GROUP BY si.variant_id`,
    id,
  );
  const lastSale = one<{ d: string }>(
    `SELECT MAX(s.created_at) d FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN variants v ON v.id = si.variant_id
      WHERE v.product_id = ? AND s.status = 'completed' AND si.qty > 0`,
    id,
  );
  return { ...p, variants, stores, stock, sales30, lastSale: lastSale?.d ?? null };
}

/** Barkod okutma: tam barkod eşleşmesi. Tüm mağazalardaki stok da döner (müşteriyi yönlendirmek için). */
export function lookupBarcode(user: AuthUser, code: string) {
  const c = code.trim();
  const v = one<Record<string, unknown> & { id: number }>(
    `SELECT v.id, v.color, v.size, v.barcode, v.active, COALESCE(v.sale_price, p.sale_price) AS price, p.id AS product_id,
            p.code, p.name, p.vat_rate, p.image_url, b.name AS brand
       FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE v.tenant_id = ? AND v.barcode = ?`,
    user.tenantId, c,
  );
  if (!v) throw notFound('Barkod bulunamadı: ' + c);
  return { ...v, stock: variantStockAllStores(user.tenantId, v.id) };
}

export function variantStockAllStores(tenantId: number, variantId: number) {
  return all(
    `SELECT s.id AS store_id, s.name AS store_name, s.is_warehouse, COALESCE(st.qty,0) AS qty
       FROM stores s LEFT JOIN stock st ON st.store_id = s.id AND st.variant_id = ?
      WHERE s.tenant_id = ? AND s.active = 1 ORDER BY s.is_warehouse, s.id`,
    variantId, tenantId,
  );
}

/** Kasa ekranı ürün arama: model kodu/adı → numara/renk seçimi için varyantlar */
export function searchVariants(user: AuthUser, q: string, storeId: number) {
  assertStore(user, storeId);
  const term = q.trim();
  if (!term) return [];
  const products = all<{ id: number }>(
    `SELECT p.id, p.code, p.name, p.sale_price, b.name AS brand, p.image_url FROM products p LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.tenant_id = ? AND p.active = 1 AND (p.code LIKE ? OR p.name LIKE ? OR b.name LIKE ?
            OR p.id IN (SELECT product_id FROM variants WHERE tenant_id = ? AND barcode LIKE ?))
      ORDER BY p.code LIMIT 20`,
    user.tenantId, `%${term}%`, `%${term}%`, `%${term}%`, user.tenantId, `${term}%`,
  );
  if (!products.length) return [];
  const ids = products.map((p) => p.id).join(',');
  const variants = all<{ product_id: number }>(
    `SELECT v.id, v.product_id, v.color, v.size, v.barcode, COALESCE(v.sale_price, p.sale_price) AS price,
            COALESCE((SELECT qty FROM stock WHERE store_id = ? AND variant_id = v.id),0) AS qty,
            COALESCE((SELECT SUM(qty) FROM stock WHERE variant_id = v.id),0) AS total_qty
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.product_id IN (${ids}) AND v.active = 1 ORDER BY v.color, CAST(v.size AS REAL), v.size`,
    storeId,
  );
  return products.map((p) => ({ ...p, variants: variants.filter((v) => v.product_id === p.id) }));
}

function roundPrice(kurus: number, mode: string): number {
  if (mode === 'tl') return Math.round(kurus / 100) * 100;
  if (mode === '90') return Math.max(90, Math.ceil((kurus + 10) / 1000) * 1000 - 10);
  if (mode === '99') return Math.max(99_90, Math.ceil((kurus + 10) / 10000) * 10000 - 10);
  return Math.round(kurus);
}

/** Toplu fiyat güncelleme (zam / sezon sonu indirimi) */
export function bulkPrice(
  user: AuthUser,
  input: { productIds: number[]; mode: 'percent' | 'set' | 'amount'; value: number; round?: string; dryRun?: boolean },
) {
  if (!input.productIds?.length) throw badRequest('Ürün seçilmedi');
  const ids = inList(input.productIds);
  const rows = all<{ id: number; code: string; name: string; sale_price: number }>(
    `SELECT id, code, name, sale_price FROM products WHERE tenant_id = ? AND id IN (${ids})`,
    user.tenantId,
  );
  const changes = rows.map((r) => {
    let np = r.sale_price;
    if (input.mode === 'percent') np = (r.sale_price * (100 + input.value)) / 100;
    if (input.mode === 'amount') np = r.sale_price + input.value;
    if (input.mode === 'set') np = input.value;
    np = Math.max(0, roundPrice(np, input.round ?? 'none'));
    return { id: r.id, code: r.code, name: r.name, old: r.sale_price, new: np };
  });
  if (!input.dryRun) {
    tx(() => {
      const st = getDb().prepare("UPDATE products SET sale_price = ?, updated_at = datetime('now','localtime') WHERE id = ?");
      for (const c of changes) st.run(c.new, c.id);
      audit(user, user.tenantId, 'product.bulk_price', 'product', null, { count: changes.length, mode: input.mode, value: input.value });
    });
  }
  return changes;
}

export interface ImportRow {
  code: string;
  name: string;
  brand?: string;
  category?: string;
  gender?: string;
  season?: string;
  material?: string;
  color: string;
  size: string;
  barcode?: string;
  cost?: number;
  price?: number;
  vat?: number;
  qty?: number;
  store?: string;
}

/** Excel/CSV'den toplu ürün + açılış stoğu aktarımı */
export function importProducts(user: AuthUser, rows: ImportRow[], dryRun = false) {
  const errors: { row: number; message: string }[] = [];
  let createdProducts = 0;
  let createdVariants = 0;
  let stockRows = 0;
  const stores = all<{ id: number; code: string; name: string }>('SELECT id, code, name FROM stores WHERE tenant_id = ?', user.tenantId);
  const run1 = () => {
    rows.forEach((r, i) => {
      const line = i + 2;
      try {
        if (!r.code || !r.name || !r.color || !r.size) throw new Error('Model kodu, ad, renk ve numara zorunlu');
        let p = one<{ id: number }>('SELECT id FROM products WHERE tenant_id = ? AND code = ?', user.tenantId, String(r.code).trim());
        if (!p) {
          const vat = Number(r.vat ?? 10);
          const pid = Number(
            run(
              `INSERT INTO products (tenant_id, code, name, brand_id, category_id, gender, season, material, cost_price, sale_price, vat_rate)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              user.tenantId, String(r.code).trim(), String(r.name).trim(), ensureBrand(user.tenantId, r.brand), ensureCategory(user.tenantId, r.category),
              r.gender || null, r.season || null, r.material || null, Math.round(Number(r.cost ?? 0)), Math.round(Number(r.price ?? 0)),
              [0, 1, 10, 20].includes(vat) ? vat : 10,
            ).lastInsertRowid,
          );
          p = { id: pid };
          createdProducts++;
        }
        const exists = one<{ id: number }>('SELECT id FROM variants WHERE product_id = ? AND color = ? AND size = ?', p.id, String(r.color).trim(), String(r.size).trim());
        const vid = exists?.id ?? addVariant(user.tenantId, p.id, String(r.color), String(r.size), r.barcode ? String(r.barcode) : null);
        if (!exists) createdVariants++;
        const qty = Math.round(Number(r.qty ?? 0));
        if (qty) {
          const store = stores.find((s) => s.code === r.store || s.name === r.store) ?? (r.store ? null : stores[0]);
          if (!store) throw new Error('Mağaza bulunamadı: ' + r.store);
          assertStore(user, store.id);
          changeStock({ tenantId: user.tenantId, storeId: store.id, variantId: vid, qty, type: 'opening', userId: user.id, note: 'Toplu aktarım' });
          stockRows++;
        }
      } catch (e) {
        errors.push({ row: line, message: (e as Error).message });
      }
    });
    if (dryRun || errors.length) throw Object.assign(new Error('rollback'), { rollback: true });
  };
  try {
    tx(run1);
  } catch (e) {
    if (!(e as { rollback?: boolean }).rollback) throw e;
  }
  const ok = !errors.length;
  if (ok && !dryRun) audit(user, user.tenantId, 'product.import', 'product', null, { rows: rows.length, createdProducts, createdVariants });
  return { ok, applied: ok && !dryRun, errors, createdProducts, createdVariants, stockRows };
}
