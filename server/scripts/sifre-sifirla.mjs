#!/usr/bin/env node
/**
 * Şifre sıfırlama (sunucu üzerinden, uygulama kapalıyken veya açıkken çalışır).
 * Kullanım:  node scripts/sifre-sifirla.mjs <firma-kodu> <kullanici-adi> <yeni-sifre>
 * Örnek:     node scripts/sifre-sifirla.mjs sistem admin YeniSifre123
 * Docker:    docker compose exec app node scripts/sifre-sifirla.mjs sistem admin YeniSifre123
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { join, resolve } from 'node:path';

const [tenant, username, password] = process.argv.slice(2);
if (!tenant || !username || !password || password.length < 6) {
  console.error('Kullanım: node scripts/sifre-sifirla.mjs <firma-kodu> <kullanici-adi> <yeni-sifre (en az 6 karakter)>');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const file = process.env.DB_FILE || join(dataDir, 'dc-ayakkabi.db');
const db = new Database(file);
const r = db
  .prepare(
    `UPDATE users SET password_hash = ?, token_version = token_version + 1, active = 1
      WHERE username = ? COLLATE NOCASE AND tenant_id = (SELECT id FROM tenants WHERE code = ? COLLATE NOCASE)`,
  )
  .run(bcrypt.hashSync(password, 10), username, tenant);
if (!r.changes) {
  console.error(`Kullanıcı bulunamadı: ${tenant} / ${username} (veritabanı: ${file})`);
  process.exit(2);
}
console.log(`Şifre güncellendi: ${tenant} / ${username}. Açık oturumlar kapatıldı.`);
