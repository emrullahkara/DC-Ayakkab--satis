import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, getDb } from '../db/index.js';
import { hashPassword, me, requirePerm, requireSuperadmin, storeFilter } from '../auth.js';
import { h, id, intOpt, parse } from './helpers.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { PROVIDERS, maskConfig } from '../integrations/providers.js';
import { getIntegration, outboxList } from '../integrations/outbox.js';
import { retryJob, runOutboxOnce } from '../integrations/worker.js';
import { listMarketplaceOrders } from '../integrations/marketplace.js';
import { buildInvoice } from '../integrations/einvoice.js';
import * as R from '../services/reports.js';
import { range } from '../utils/dates.js';
import { config } from '../config.js';
import { backupNow, listBackups } from '../services/backup.js';

export const adminRouter = Router();

// ---------------------------------------------------------------- Raporlar & panel
adminRouter.get('/dashboard', requirePerm('dashboard'), h((req) => {
  const u = me(req);
  return R.dashboard(u, storeFilter(u, req.query.storeId));
}));

adminRouter.get('/reports/:name', requirePerm('reports'), h((req) => {
  const u = me(req);
  const r = { storeIds: storeFilter(u, req.query.storeId), ...range(req.query.from, req.query.to) };
  const q = req.query;
  switch (req.params.name) {
    case 'summary': return R.salesSummary(u, r);
    case 'by-day': return R.salesByDay(u, r);
    case 'by-hour': return R.salesByHour(u, r);
    case 'by-store': return R.salesByStore(u, r);
    case 'by-staff': return R.salesByStaff(u, r);
    case 'by-payment': return R.salesByPayment(u, r);
    case 'products': return R.productPerformance(u, r, String(q.groupBy ?? 'product'), intOpt(q.limit) ?? 50);
    case 'size-curve': return R.sizeCurve(u, r, intOpt(q.productId));
    case 'stock-value': return R.stockValue(u, r.storeIds);
    case 'dead-stock': return R.deadStock(u, r.storeIds, intOpt(q.days));
    case 'low-stock': return R.lowStock(u, r.storeIds);
    case 'sell-through': return R.sellThrough(u, r, (q.groupBy as any) ?? 'season');
    case 'pnl': return R.profitAndLoss(u, r);
    case 'vat': return R.vatReport(u, r);
    default: throw notFound('Rapor bulunamadı');
  }
}));

// ---------------------------------------------------------------- Firma ayarları & mağazalar
adminRouter.get('/settings', requirePerm('settings'), h((req) => {
  const u = me(req);
  return { tenant: one('SELECT id, code, name, tax_no, tax_office, address, phone, email, plan, max_stores, license_until FROM tenants WHERE id = ?', u.tenantId), settings: getSettings(u.tenantId) };
}));
adminRouter.put('/settings', requirePerm('settings'), h((req) => {
  const u = me(req);
  const b = parse(z.object({ tenant: z.object({ name: z.string().min(1).max(120), tax_no: z.string().max(11).nullable().optional(), tax_office: z.string().max(60).nullable().optional(), address: z.string().max(300).nullable().optional(), phone: z.string().max(20).nullable().optional(), email: z.string().max(120).nullable().optional() }).optional(), settings: z.record(z.string(), z.any()).optional() }), req.body);
  if (b.tenant) run('UPDATE tenants SET name = ?, tax_no = ?, tax_office = ?, address = ?, phone = ?, email = ? WHERE id = ?', b.tenant.name, b.tenant.tax_no ?? null, b.tenant.tax_office ?? null, b.tenant.address ?? null, b.tenant.phone ?? null, b.tenant.email ?? null, u.tenantId);
  const settings = b.settings ? saveSettings(u.tenantId, b.settings) : getSettings(u.tenantId);
  audit(u, u.tenantId, 'settings.update');
  return { settings };
}));

adminRouter.get('/stores', h((req) => {
  const u = me(req);
  return all('SELECT * FROM stores WHERE tenant_id = ? ORDER BY active DESC, is_warehouse, id', u.tenantId).filter((s: any) => u.perms.has('settings') || u.storeIds.includes(s.id));
}));
const storeSchema = z.object({ code: z.string().min(1).max(10).regex(/^[A-Za-z0-9]+$/, 'Sadece harf ve rakam'), name: z.string().min(1).max(80), city: z.string().max(40).nullable().optional(), address: z.string().max(300).nullable().optional(), phone: z.string().max(20).nullable().optional(), is_warehouse: z.boolean().optional(), active: z.boolean().optional() });
adminRouter.post('/stores', requirePerm('settings'), h((req) => {
  const u = me(req);
  const b = parse(storeSchema, req.body);
  const t = one<{ max_stores: number }>('SELECT max_stores FROM tenants WHERE id = ?', u.tenantId)!;
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM stores WHERE tenant_id = ? AND active = 1', u.tenantId)!.n;
  if (n >= t.max_stores) throw badRequest(`Lisansınız en fazla ${t.max_stores} mağazaya izin veriyor`);
  if (one('SELECT 1 FROM stores WHERE tenant_id = ? AND code = ? COLLATE NOCASE', u.tenantId, b.code)) throw conflict('Bu mağaza kodu kullanılıyor');
  const r = run('INSERT INTO stores (tenant_id, code, name, city, address, phone, is_warehouse) VALUES (?,?,?,?,?,?,?)', u.tenantId, b.code.toUpperCase(), b.name, b.city ?? null, b.address ?? null, b.phone ?? null, b.is_warehouse ? 1 : 0);
  audit(u, u.tenantId, 'store.create', 'store', r.lastInsertRowid, { code: b.code });
  return one('SELECT * FROM stores WHERE id = ?', r.lastInsertRowid);
}));
adminRouter.put('/stores/:id', requirePerm('settings'), h((req) => {
  const u = me(req);
  const b = parse(storeSchema, req.body);
  const sid = id(req.params.id);
  if (!one('SELECT 1 FROM stores WHERE id = ? AND tenant_id = ?', sid, u.tenantId)) throw notFound();
  if (one('SELECT 1 FROM stores WHERE tenant_id = ? AND code = ? COLLATE NOCASE AND id <> ?', u.tenantId, b.code, sid)) throw conflict('Bu mağaza kodu kullanılıyor');
  run('UPDATE stores SET code=?, name=?, city=?, address=?, phone=?, is_warehouse=?, active=? WHERE id = ?', b.code.toUpperCase(), b.name, b.city ?? null, b.address ?? null, b.phone ?? null, b.is_warehouse ? 1 : 0, b.active === false ? 0 : 1, sid);
  audit(u, u.tenantId, 'store.update', 'store', sid);
  return one('SELECT * FROM stores WHERE id = ?', sid);
}));

// ---------------------------------------------------------------- Entegrasyonlar
adminRouter.get('/integrations', requirePerm('integrations'), h((req) => {
  const u = me(req);
  return Object.entries(PROVIDERS).map(([key, def]) => {
    const cur = getIntegration(u.tenantId, key);
    return { key, ...def, enabled: cur?.enabled ?? false, mode: cur?.mode ?? 'test', config: maskConfig(key, cur?.config ?? {}) };
  });
}));
adminRouter.put('/integrations/:provider', requirePerm('integrations'), h((req) => {
  const u = me(req);
  const key = String(req.params.provider);
  const def = PROVIDERS[key];
  if (!def) throw notFound('Sağlayıcı bulunamadı');
  const b = parse(z.object({ enabled: z.boolean(), mode: z.enum(['test', 'live']), config: z.record(z.string(), z.string()) }), req.body);
  const cur = getIntegration(u.tenantId, key)?.config ?? {};
  const cfg: Record<string, string> = {};
  for (const f of def.fields) {
    const v = b.config[f.key];
    cfg[f.key] = f.secret && (v === '••••••••' || v === undefined) ? (cur[f.key] ?? '') : (v ?? '');
  }
  run(
    `INSERT INTO integration_settings (tenant_id, provider, enabled, mode, config, updated_at) VALUES (?,?,?,?,?, datetime('now','localtime'))
     ON CONFLICT (tenant_id, provider) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode, config = excluded.config, updated_at = excluded.updated_at`,
    u.tenantId, key, b.enabled ? 1 : 0, b.mode, JSON.stringify(cfg),
  );
  audit(u, u.tenantId, 'integration.update', 'integration', null, { provider: key, enabled: b.enabled, mode: b.mode });
  return { key, enabled: b.enabled, mode: b.mode, config: maskConfig(key, cfg) };
}));
adminRouter.get('/integrations/outbox', requirePerm('integrations'), h((req) => outboxList(me(req).tenantId, { status: req.query.status ? String(req.query.status) : undefined, provider: req.query.provider ? String(req.query.provider) : undefined, limit: intOpt(req.query.limit) })));
adminRouter.post('/integrations/outbox/:id/retry', requirePerm('integrations'), h((req) => ({ ok: retryJob(me(req).tenantId, id(req.params.id)) })));
adminRouter.post('/integrations/outbox/run', requirePerm('integrations'), h(async () => ({ processed: await runOutboxOnce() })));
adminRouter.get('/integrations/marketplace-orders', requirePerm('integrations'), h((req) => listMarketplaceOrders(me(req).tenantId)));
adminRouter.get('/integrations/einvoice/preview/:saleId', requirePerm('integrations'), h((req) => {
  const u = me(req);
  const inv = buildInvoice(u.tenantId, id(req.params.saleId), getIntegration(u.tenantId, 'einvoice')?.config ?? {});
  if (!inv) throw notFound('Satış bulunamadı');
  return { invoiceNo: inv.invoiceNo, profile: inv.profile, xml: inv.xml };
}));

// ---------------------------------------------------------------- Log & yedek
adminRouter.get('/audit', requirePerm('audit'), h((req) => {
  const u = me(req);
  const r = range(req.query.from, req.query.to, 7);
  return all(
    `SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = ? AND a.created_at >= ? AND a.created_at < ? ${req.query.userId ? 'AND a.user_id = ?' : ''} ${req.query.action ? 'AND a.action LIKE ?' : ''}
      ORDER BY a.id DESC LIMIT 1000`,
    u.tenantId, r.from, r.toExclusive, ...(req.query.userId ? [Number(req.query.userId)] : []), ...(req.query.action ? [`${req.query.action}%`] : []),
  );
}));
adminRouter.get('/backups', requirePerm('settings'), h(() => listBackups()));
adminRouter.post('/backups', requirePerm('settings'), h(async (req) => {
  const u = me(req);
  const f = await backupNow();
  audit(u, u.tenantId, 'backup.manual', undefined, null, f);
  return { file: f };
}));

/** Firma verisini JSON olarak dışa aktarma (taşınabilirlik / KVKK) */
adminRouter.get('/export', requirePerm('settings'), h((req, res) => {
  const u = me(req);
  const tables = ['stores', 'brands', 'categories', 'suppliers', 'products', 'variants', 'customers', 'customer_ledger', 'sales', 'sale_items', 'sale_payments', 'stock_movements', 'cash_movements', 'register_sessions', 'purchase_orders', 'purchase_order_items', 'supplier_ledger', 'transfers', 'transfer_items', 'campaigns', 'gift_cards', 'customer_orders'];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const hasTenant = (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((c) => c.name === 'tenant_id');
    out[t] = hasTenant ? all(`SELECT * FROM ${t} WHERE tenant_id = ?`, u.tenantId) : all(`SELECT x.* FROM ${t} x`);
  }
  out.stock = all('SELECT s.* FROM stock s JOIN stores st ON st.id = s.store_id WHERE st.tenant_id = ?', u.tenantId);
  res.setHeader('Content-Disposition', `attachment; filename="dc-ayakkabi-${u.tenantCode}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
}));

// ---------------------------------------------------------------- Süper yönetici: firma (kiracı) yönetimi
adminRouter.get('/admin/tenants', requireSuperadmin, h(() =>
  all(`SELECT t.*, (SELECT COUNT(*) FROM stores WHERE tenant_id = t.id AND active = 1) store_count, (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND active = 1) user_count,
              (SELECT COUNT(*) FROM sales WHERE tenant_id = t.id AND created_at >= date('now','localtime','-30 days')) sales30
         FROM tenants t ORDER BY t.id`),
));
const tenantSchema = z.object({
  code: z.string().min(2).max(20).regex(/^[a-z0-9-]+$/, 'Küçük harf, rakam ve tire'), name: z.string().min(1).max(120), plan: z.string().max(30).optional(), max_stores: z.number().int().min(1).max(500).optional(),
  license_until: z.string().nullable().optional(), active: z.boolean().optional(), phone: z.string().max(20).nullable().optional(), email: z.string().max(120).nullable().optional(),
  owner: z.object({ username: z.string().min(3), name: z.string().min(1), password: z.string().min(6) }).optional(),
  first_store: z.object({ code: z.string().min(1).max(10), name: z.string().min(1) }).optional(),
});
adminRouter.post('/admin/tenants', requireSuperadmin, h((req) => {
  const b = parse(tenantSchema, req.body);
  const u = me(req);
  if (one('SELECT 1 FROM tenants WHERE code = ?', b.code)) throw conflict('Firma kodu kullanılıyor');
  return getDb().transaction(() => {
    const r = run('INSERT INTO tenants (code, name, plan, max_stores, license_until, active, phone, email) VALUES (?,?,?,?,?,?,?,?)', b.code, b.name, b.plan ?? 'standart', b.max_stores ?? 5, b.license_until ?? null, b.active === false ? 0 : 1, b.phone ?? null, b.email ?? null);
    const tid = Number(r.lastInsertRowid);
    if (b.first_store) run('INSERT INTO stores (tenant_id, code, name) VALUES (?,?,?)', tid, b.first_store.code.toUpperCase(), b.first_store.name);
    if (b.owner) run("INSERT INTO users (tenant_id, username, name, role, password_hash, all_stores) VALUES (?,?,?,'owner',?,1)", tid, b.owner.username.toLowerCase(), b.owner.name, hashPassword(b.owner.password));
    run("INSERT INTO size_series (tenant_id, name, sizes, assortment) VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?)",
      tid, 'Kadın', JSON.stringify(['35', '36', '37', '38', '39', '40', '41']), JSON.stringify([1, 2, 3, 3, 2, 1, 0]),
      tid, 'Erkek', JSON.stringify(['39', '40', '41', '42', '43', '44', '45']), JSON.stringify([1, 2, 3, 3, 2, 1, 0]),
      tid, 'Çocuk', JSON.stringify(['26', '27', '28', '29', '30', '31', '32', '33', '34', '35']), null);
    audit(u, tid, 'tenant.create', 'tenant', tid, { code: b.code });
    return one('SELECT * FROM tenants WHERE id = ?', tid);
  })();
}));
adminRouter.put('/admin/tenants/:id', requireSuperadmin, h((req) => {
  const b = parse(tenantSchema.omit({ owner: true, first_store: true }), req.body);
  const tid = id(req.params.id);
  if (!one('SELECT 1 FROM tenants WHERE id = ?', tid)) throw notFound();
  run('UPDATE tenants SET code=?, name=?, plan=?, max_stores=?, license_until=?, active=?, phone=?, email=? WHERE id = ?', b.code, b.name, b.plan ?? 'standart', b.max_stores ?? 5, b.license_until ?? null, b.active === false ? 0 : 1, b.phone ?? null, b.email ?? null, tid);
  if (b.active === false) run('UPDATE users SET token_version = token_version + 1 WHERE tenant_id = ?', tid);
  audit(me(req), tid, 'tenant.update', 'tenant', tid);
  return one('SELECT * FROM tenants WHERE id = ?', tid);
}));
adminRouter.post('/admin/tenants/:id/reset-owner-password', requireSuperadmin, h((req) => {
  const b = parse(z.object({ username: z.string(), password: z.string().min(6) }), req.body);
  const tid = id(req.params.id);
  const r = run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE tenant_id = ? AND username = ?', hashPassword(b.password), tid, b.username.toLowerCase());
  if (!r.changes) throw notFound('Kullanıcı bulunamadı');
  audit(me(req), tid, 'tenant.reset_password', 'user', null, { username: b.username });
}));
adminRouter.get('/admin/info', requireSuperadmin, h(() => ({ dbFile: config.dbFile, dataDir: config.dataDir, node: process.version, uptime: process.uptime() })));
