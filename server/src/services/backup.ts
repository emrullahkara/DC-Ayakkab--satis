import { readdirSync, statSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { config } from '../config.js';

function backupDir() {
  const d = join(config.dataDir, 'backups');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

/** SQLite çevrimiçi yedek: çalışırken tutarlı kopya alır, eski yedekleri temizler. */
export async function backupNow(): Promise<string> {
  if (config.dbFile === ':memory:') return '(bellek içi veritabanı, yedek alınmadı)';
  const dir = backupDir();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = join(dir, `dc-ayakkabi-${stamp}.db`);
  await getDb().backup(file);
  const files = readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  while (files.length > config.backupKeep) unlinkSync(join(dir, files.shift()!));
  return file;
}

export function listBackups() {
  if (config.dbFile === ':memory:') return [];
  const dir = backupDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .sort()
    .reverse()
    .map((f) => ({ file: f, size: statSync(join(dir, f)).size, created: statSync(join(dir, f)).mtime.toISOString() }));
}
