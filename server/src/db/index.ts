import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_VERSION = 1;

let current: DB | null = null;

/** Veritabanını açar, şemayı uygular. Testlerde ':memory:' kullanılır. */
export function initDb(file: string): DB {
  if (file !== ':memory:') {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
  migrate(db, row?.version ?? SCHEMA_VERSION);
  current = db;
  return db;
}

/** İleride şema değişiklikleri buraya sürüm sürüm eklenir. */
function migrate(db: DB, from: number) {
  const steps: Record<number, (db: DB) => void> = {};
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const step = steps[v];
    if (step) db.transaction(() => step(db))();
    db.prepare('UPDATE schema_version SET version = ?').run(v);
  }
}

export function getDb(): DB {
  if (!current) throw new Error('Veritabanı başlatılmadı');
  return current;
}

/** Tek satır getirir (tip yardımcı). */
export function one<T>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}
export function all<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}
export function run(sql: string, ...params: unknown[]) {
  return getDb().prepare(sql).run(...params);
}
export function tx<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
