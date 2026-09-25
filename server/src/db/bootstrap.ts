import { randomBytes } from 'node:crypto';
import { one, run } from './index.js';
import { hashPassword } from '../auth.js';
import { config } from '../config.js';

/**
 * İlk açılış: "sistem" firması ve süper yönetici (admin) kullanıcısı oluşturulur.
 * Şifre ADMIN_PASSWORD ortam değişkeninden alınır; yoksa üretilip konsola yazılır.
 */
export function ensureBootstrap() {
  if (one('SELECT 1 FROM users WHERE is_superadmin = 1')) return;
  let sysTenant = one<{ id: number }>("SELECT id FROM tenants WHERE code = 'sistem'");
  if (!sysTenant) {
    const r = run("INSERT INTO tenants (code, name, plan, max_stores) VALUES ('sistem', 'Sistem Yönetimi', 'sistem', 1)");
    sysTenant = { id: Number(r.lastInsertRowid) };
    run("INSERT INTO stores (tenant_id, code, name) VALUES (?, 'SYS', 'Sistem')", sysTenant.id);
  }
  const password = config.adminPassword || randomBytes(6).toString('base64url');
  run(
    "INSERT INTO users (tenant_id, username, name, role, is_superadmin, password_hash, all_stores) VALUES (?, 'admin', 'Sistem Yöneticisi', 'owner', 1, ?, 1)",
    sysTenant.id, hashPassword(password),
  );
  if (!config.isTest) {
    console.log('==============================================================');
    console.log(' İlk kurulum: süper yönetici oluşturuldu');
    console.log(' Firma kodu : sistem');
    console.log(' Kullanıcı  : admin');
    console.log(' Şifre      : ' + password + (config.adminPassword ? '' : '   (ADMIN_PASSWORD verilmediği için üretildi; hemen değiştirin)'));
    console.log('==============================================================');
  }
}
