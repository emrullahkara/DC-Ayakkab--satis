import { setTestConfig } from '../src/config.js';
setTestConfig();
process.env.TZ = 'Europe/Istanbul';
import { initDb } from '../src/db/index.js';
import { ensureBootstrap } from '../src/db/bootstrap.js';
import { hashPassword, loadUser, type AuthUser } from '../src/auth.js';
import { run } from '../src/db/index.js';
import { ensureBrand, newBarcode } from '../src/services/products.js';
import { changeStock } from '../src/services/stock.js';

export interface Fixture {
  tenantId: number;
  storeA: number;
  storeB: number;
  owner: AuthUser;
  cashier: AuthUser;
  product: number;
  v38: number;
  v39: number;
  customer: number;
}

/** Her test dosyası için temiz bellek içi veritabanı ve temel kayıtlar */
export function fixture(): Fixture {
  initDb(':memory:');
  ensureBootstrap();
  const tenantId = Number(run("INSERT INTO tenants (code, name) VALUES ('t1', 'Test Ayakkabı')").lastInsertRowid);
  const storeA = Number(run("INSERT INTO stores (tenant_id, code, name) VALUES (?, 'A', 'Mağaza A')", tenantId).lastInsertRowid);
  const storeB = Number(run("INSERT INTO stores (tenant_id, code, name) VALUES (?, 'B', 'Mağaza B')", tenantId).lastInsertRowid);
  const pw = hashPassword('x');
  const ownerId = Number(run("INSERT INTO users (tenant_id, username, name, role, password_hash, all_stores) VALUES (?, 'patron', 'Patron', 'owner', ?, 1)", tenantId, pw).lastInsertRowid);
  const cashierId = Number(run("INSERT INTO users (tenant_id, username, name, role, password_hash) VALUES (?, 'kasa', 'Kasiyer', 'cashier', ?)", tenantId, pw).lastInsertRowid);
  run('INSERT INTO user_stores VALUES (?, ?)', cashierId, storeA);
  const product = Number(
    run('INSERT INTO products (tenant_id, code, name, brand_id, cost_price, sale_price, vat_rate) VALUES (?, ?, ?, ?, 50000, 100000, 10)', tenantId, 'M1', 'Model 1', ensureBrand(tenantId, 'Marka')).lastInsertRowid,
  );
  const v38 = Number(run('INSERT INTO variants (tenant_id, product_id, color, size, barcode) VALUES (?,?,?,?,?)', tenantId, product, 'Siyah', '38', newBarcode(tenantId)).lastInsertRowid);
  const v39 = Number(run('INSERT INTO variants (tenant_id, product_id, color, size, barcode) VALUES (?,?,?,?,?)', tenantId, product, 'Siyah', '39', newBarcode(tenantId)).lastInsertRowid);
  changeStock({ tenantId, storeId: storeA, variantId: v38, qty: 5, type: 'opening' });
  changeStock({ tenantId, storeId: storeA, variantId: v39, qty: 2, type: 'opening' });
  changeStock({ tenantId, storeId: storeB, variantId: v38, qty: 3, type: 'opening' });
  const customer = Number(run("INSERT INTO customers (tenant_id, name, phone, credit_limit) VALUES (?, 'Ayşe Test', '5551112233', 200000)", tenantId).lastInsertRowid);
  return { tenantId, storeA, storeB, owner: loadUser(ownerId)!, cashier: loadUser(cashierId)!, product, v38, v39, customer };
}
