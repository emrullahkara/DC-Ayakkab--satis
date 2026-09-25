import { Router } from 'express';
import { z } from 'zod';
import { all, one, run } from '../db/index.js';
import { me, requirePerm, storeFilter } from '../auth.js';
import { h, id, intOpt, parse } from './helpers.js';
import { badRequest, notFound } from '../utils/errors.js';
import { bulkPrice, deleteVariant, getProduct, importProducts, listProducts, saveProduct, updateVariant } from '../services/products.js';
import {
  adjustStock, applyCount, cancelCount, cancelTransfer, countScan, createCount, createTransfer, getCount, getTransfer, listCounts,
  listTransfers, movements, receiveTransfer, sendRequestedTransfer, stockList,
} from '../services/inventory.js';
import { MOVEMENT_LABELS } from '../services/stock.js';
import { range } from '../utils/dates.js';
import { audit } from '../services/audit.js';

export const catalogRouter = Router();

const productSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  brand: z.string().max(60).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  brand_id: z.number().int().nullable().optional(),
  category_id: z.number().int().nullable().optional(),
  supplier_id: z.number().int().nullable().optional(),
  gender: z.string().max(20).nullable().optional(),
  season: z.string().max(20).nullable().optional(),
  material: z.string().max(60).nullable().optional(),
  cost_price: z.number().int().min(0).optional(),
  sale_price: z.number().int().min(0).optional(),
  vat_rate: z.number().int().optional(),
  min_stock: z.number().int().min(0).optional(),
  description: z.string().max(2000).nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
  marketplace_sync: z.boolean().optional(),
  active: z.boolean().optional(),
  colors: z.array(z.string().min(1).max(40)).optional(),
  sizes: z.array(z.string().min(1).max(10)).optional(),
  variants: z.array(z.object({ color: z.string().min(1), size: z.string().min(1), barcode: z.string().nullable().optional() })).optional(),
});

catalogRouter.get('/catalog/meta', requirePerm('products.view'), h((req) => {
  const t = me(req).tenantId;
  return {
    brands: all('SELECT id, name FROM brands WHERE tenant_id = ? ORDER BY name', t),
    categories: all('SELECT id, name FROM categories WHERE tenant_id = ? ORDER BY name', t),
    sizeSeries: all<{ sizes: string; assortment: string | null }>('SELECT * FROM size_series WHERE tenant_id = ? ORDER BY id', t).map((s) => ({ ...s, sizes: JSON.parse(s.sizes), assortment: s.assortment ? JSON.parse(s.assortment) : null })),
    seasons: all<{ season: string }>('SELECT DISTINCT season FROM products WHERE tenant_id = ? AND season IS NOT NULL ORDER BY season DESC', t).map((r) => r.season),
    colors: all<{ color: string }>('SELECT DISTINCT color FROM variants WHERE tenant_id = ? ORDER BY color', t).map((r) => r.color),
    suppliers: all('SELECT id, name FROM suppliers WHERE tenant_id = ? AND active = 1 ORDER BY name', t),
    movementLabels: MOVEMENT_LABELS,
    genders: [{ value: 'kadin', label: 'Kadın' }, { value: 'erkek', label: 'Erkek' }, { value: 'cocuk', label: 'Çocuk' }, { value: 'unisex', label: 'Unisex' }],
  };
}));

catalogRouter.post('/catalog/size-series', requirePerm('products.edit'), h((req) => {
  const b = parse(z.object({ id: z.number().int().optional(), name: z.string().min(1), sizes: z.array(z.string().min(1)).min(1), assortment: z.array(z.number().int().min(0)).nullable().optional() }), req.body);
  const t = me(req).tenantId;
  if (b.assortment && b.assortment.length !== b.sizes.length) throw badRequest('Asorti uzunluğu numara sayısına eşit olmalı');
  if (b.id) run('UPDATE size_series SET name = ?, sizes = ?, assortment = ? WHERE id = ? AND tenant_id = ?', b.name, JSON.stringify(b.sizes), b.assortment ? JSON.stringify(b.assortment) : null, b.id, t);
  else run('INSERT INTO size_series (tenant_id, name, sizes, assortment) VALUES (?,?,?,?)', t, b.name, JSON.stringify(b.sizes), b.assortment ? JSON.stringify(b.assortment) : null);
  return { ok: true };
}));
catalogRouter.delete('/catalog/size-series/:id', requirePerm('products.edit'), h((req) => {
  run('DELETE FROM size_series WHERE id = ? AND tenant_id = ?', id(req.params.id), me(req).tenantId);
}));
catalogRouter.post('/catalog/brands', requirePerm('products.edit'), h((req) => {
  const b = parse(z.object({ name: z.string().min(1).max(60) }), req.body);
  const r = run('INSERT INTO brands (tenant_id, name) VALUES (?,?)', me(req).tenantId, b.name.trim());
  return { id: Number(r.lastInsertRowid), name: b.name.trim() };
}));
catalogRouter.post('/catalog/categories', requirePerm('products.edit'), h((req) => {
  const b = parse(z.object({ name: z.string().min(1).max(60) }), req.body);
  const r = run('INSERT INTO categories (tenant_id, name) VALUES (?,?)', me(req).tenantId, b.name.trim());
  return { id: Number(r.lastInsertRowid), name: b.name.trim() };
}));

catalogRouter.get('/products', requirePerm('products.view'), h((req) => {
  const u = me(req);
  return listProducts(u, {
    q: req.query.q ? String(req.query.q) : undefined, brandId: intOpt(req.query.brandId), categoryId: intOpt(req.query.categoryId),
    supplierId: intOpt(req.query.supplierId), season: req.query.season ? String(req.query.season) : undefined, gender: req.query.gender ? String(req.query.gender) : undefined,
    active: req.query.active ? String(req.query.active) : undefined, stock: req.query.stock as 'in' | 'out' | 'low' | undefined,
    storeIds: storeFilter(u, req.query.storeId), limit: intOpt(req.query.limit), offset: intOpt(req.query.offset),
  });
}));
catalogRouter.post('/products', requirePerm('products.edit'), h((req) => saveProduct(me(req), parse(productSchema, req.body))));
catalogRouter.post('/products/bulk-price', requirePerm('prices.edit'), h((req) => {
  const b = parse(z.object({ productIds: z.array(z.number().int()).min(1), mode: z.enum(['percent', 'set', 'amount']), value: z.number().int(), round: z.string().optional(), dryRun: z.boolean().optional() }), req.body);
  return bulkPrice(me(req), b);
}));
catalogRouter.post('/products/import', requirePerm('products.edit'), h((req) => {
  const b = parse(z.object({ rows: z.array(z.record(z.string(), z.any())).min(1).max(20000), dryRun: z.boolean().optional() }), req.body);
  return importProducts(me(req), b.rows as any, b.dryRun);
}));
catalogRouter.get('/products/:id', requirePerm('products.view'), h((req) => getProduct(me(req), id(req.params.id))));
catalogRouter.put('/products/:id', requirePerm('products.edit'), h((req) => saveProduct(me(req), parse(productSchema, req.body), id(req.params.id))));
catalogRouter.put('/variants/:id', requirePerm('products.edit'), h((req) => {
  const b = parse(z.object({ barcode: z.string().optional(), sale_price: z.number().int().min(0).nullable().optional(), active: z.boolean().optional(), color: z.string().optional(), size: z.string().optional() }), req.body);
  return updateVariant(me(req), id(req.params.id), b);
}));
catalogRouter.delete('/variants/:id', requirePerm('products.edit'), h((req) => deleteVariant(me(req), id(req.params.id))));

/** Etiket yazdırma verisi: seçilen varyantlar için barkod + fiyat */
catalogRouter.post('/labels', requirePerm('products.view'), h((req) => {
  const b = parse(z.object({ items: z.array(z.object({ variantId: z.number().int(), qty: z.number().int().min(1).max(200) })).min(1).max(500) }), req.body);
  const u = me(req);
  const ids = b.items.map((i) => i.variantId);
  const rows = all<{ id: number }>(
    `SELECT v.id, v.barcode, v.color, v.size, p.code, p.name, COALESCE(v.sale_price, p.sale_price) price, br.name brand
       FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN brands br ON br.id = p.brand_id WHERE v.tenant_id = ? AND v.id IN (${ids.map((n) => Number(n) | 0).join(',')})`,
    u.tenantId,
  );
  return b.items.flatMap((i) => {
    const r = rows.find((x) => x.id === i.variantId);
    return r ? Array(i.qty).fill(r) : [];
  });
}));

// ---------------------------------------------------------------- Stok
catalogRouter.get('/stock', requirePerm('stock.view'), h((req) => {
  const u = me(req);
  return stockList(u, {
    storeIds: storeFilter(u, req.query.storeId), q: req.query.q ? String(req.query.q) : undefined, brandId: intOpt(req.query.brandId),
    categoryId: intOpt(req.query.categoryId), onlyPositive: req.query.positive === '1', low: req.query.low === '1', limit: intOpt(req.query.limit),
  });
}));
catalogRouter.get('/stock/movements', requirePerm('stock.view'), h((req) => {
  const u = me(req);
  const r = range(req.query.from, req.query.to);
  return movements(u, { storeIds: storeFilter(u, req.query.storeId), from: r.from, toExclusive: r.toExclusive, variantId: intOpt(req.query.variantId), productId: intOpt(req.query.productId), type: req.query.type ? String(req.query.type) : undefined, limit: intOpt(req.query.limit) });
}));
catalogRouter.post('/stock/adjust', requirePerm('stock.adjust'), h((req) => {
  const b = parse(z.object({ storeId: z.number().int(), type: z.enum(['damage', 'manual', 'opening']), note: z.string().max(300).optional(), items: z.array(z.object({ variantId: z.number().int(), qty: z.number().int() })).min(1) }), req.body);
  return adjustStock(me(req), b);
}));

// ---------------------------------------------------------------- Transfer
const transferItems = z.array(z.object({ variantId: z.number().int(), qty: z.number().int().min(1) })).min(1);
catalogRouter.get('/transfers', requirePerm('transfers'), h((req) => listTransfers(me(req), { status: req.query.status ? String(req.query.status) : undefined, storeId: intOpt(req.query.storeId), direction: req.query.direction as 'in' | 'out' | undefined })));
catalogRouter.post('/transfers', requirePerm('transfers'), h((req) => createTransfer(me(req), parse(z.object({ fromStoreId: z.number().int(), toStoreId: z.number().int(), items: transferItems, note: z.string().max(300).optional(), request: z.boolean().optional() }), req.body))));
catalogRouter.get('/transfers/:id', requirePerm('transfers'), h((req) => getTransfer(me(req), id(req.params.id))));
catalogRouter.post('/transfers/:id/send', requirePerm('transfers'), h((req) => sendRequestedTransfer(me(req), id(req.params.id), req.body?.items)));
catalogRouter.post('/transfers/:id/receive', requirePerm('transfers'), h((req) => receiveTransfer(me(req), id(req.params.id), req.body?.items)));
catalogRouter.post('/transfers/:id/cancel', requirePerm('transfers'), h((req) => cancelTransfer(me(req), id(req.params.id))));

// ---------------------------------------------------------------- Sayım
catalogRouter.get('/counts', requirePerm('counts'), h((req) => listCounts(me(req))));
catalogRouter.post('/counts', requirePerm('counts'), h((req) => createCount(me(req), parse(z.object({ storeId: z.number().int(), name: z.string().optional(), scope: z.enum(['partial', 'full']).optional() }), req.body))));
catalogRouter.get('/counts/:id', requirePerm('counts'), h((req) => getCount(me(req), id(req.params.id))));
catalogRouter.post('/counts/:id/scan', requirePerm('counts'), h((req) => countScan(me(req), id(req.params.id), parse(z.object({ barcode: z.string().optional(), variantId: z.number().int().optional(), qty: z.number().int().optional(), mode: z.enum(['add', 'set']).optional() }), req.body))));
catalogRouter.post('/counts/:id/apply', requirePerm('counts'), h((req) => applyCount(me(req), id(req.params.id))));
catalogRouter.post('/counts/:id/cancel', requirePerm('counts'), h((req) => cancelCount(me(req), id(req.params.id))));

// ---------------------------------------------------------------- Kampanya
const campaignSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['percent', 'amount', 'buy_x_pay_y', 'nth_percent']),
  value: z.number().int().min(0),
  min_qty: z.number().int().min(1).optional(),
  scope: z.enum(['all', 'category', 'brand', 'product', 'season']).optional(),
  scope_value: z.string().nullable().optional(),
  store_ids: z.array(z.number().int()).nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
});
catalogRouter.get('/campaigns', requirePerm('campaigns', 'pos'), h((req) => all('SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY active DESC, priority DESC, id DESC', me(req).tenantId).map((c: any) => ({ ...c, store_ids: c.store_ids ? JSON.parse(c.store_ids) : null }))));
catalogRouter.post('/campaigns', requirePerm('campaigns'), h((req) => {
  const b = parse(campaignSchema, req.body);
  const u = me(req);
  if (b.type === 'percent' && b.value > 100) throw badRequest('Yüzde 100 üzeri olamaz');
  if (b.type === 'buy_x_pay_y' && (b.min_qty ?? 1) < 2) throw badRequest('"X al Y öde" için en az 2 ürün');
  const r = run(
    'INSERT INTO campaigns (tenant_id, name, type, value, min_qty, scope, scope_value, store_ids, start_date, end_date, priority, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    u.tenantId, b.name, b.type, b.value, b.min_qty ?? 1, b.scope ?? 'all', b.scope_value ?? null, b.store_ids?.length ? JSON.stringify(b.store_ids) : null,
    b.start_date || null, b.end_date || null, b.priority ?? 0, b.active === false ? 0 : 1,
  );
  audit(u, u.tenantId, 'campaign.create', 'campaign', r.lastInsertRowid, { name: b.name });
  return one('SELECT * FROM campaigns WHERE id = ?', r.lastInsertRowid);
}));
catalogRouter.put('/campaigns/:id', requirePerm('campaigns'), h((req) => {
  const b = parse(campaignSchema, req.body);
  const u = me(req);
  const cid = id(req.params.id);
  if (!one('SELECT 1 FROM campaigns WHERE id = ? AND tenant_id = ?', cid, u.tenantId)) throw notFound();
  run(
    'UPDATE campaigns SET name=?, type=?, value=?, min_qty=?, scope=?, scope_value=?, store_ids=?, start_date=?, end_date=?, priority=?, active=? WHERE id = ?',
    b.name, b.type, b.value, b.min_qty ?? 1, b.scope ?? 'all', b.scope_value ?? null, b.store_ids?.length ? JSON.stringify(b.store_ids) : null,
    b.start_date || null, b.end_date || null, b.priority ?? 0, b.active === false ? 0 : 1, cid,
  );
  audit(u, u.tenantId, 'campaign.update', 'campaign', cid);
  return one('SELECT * FROM campaigns WHERE id = ?', cid);
}));
catalogRouter.delete('/campaigns/:id', requirePerm('campaigns'), h((req) => {
  run('UPDATE campaigns SET active = 0 WHERE id = ? AND tenant_id = ?', id(req.params.id), me(req).tenantId);
}));
