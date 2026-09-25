import { join, resolve } from 'node:path';

const env = process.env;
const dataDir = env.DATA_DIR ? resolve(env.DATA_DIR) : resolve(process.cwd(), 'data');

export const config = {
  port: Number(env.PORT || 3000),
  dataDir,
  dbFile: env.DB_FILE || join(dataDir, 'dc-ayakkabi.db'),
  jwtSecret: env.JWT_SECRET || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  seedDemo: env.DEMO_DATA === '1' || env.DEMO_DATA === 'true',
  cookieSecure: env.COOKIE_SECURE === '1' || env.COOKIE_SECURE === 'true',
  webDist: env.WEB_DIST || resolve(process.cwd(), '../web/dist'),
  backupKeep: Number(env.BACKUP_KEEP || 14),
  workers: env.DISABLE_WORKERS !== '1',
  isTest: env.NODE_ENV === 'test' || !!env.VITEST,
};

export function setTestConfig() {
  config.dataDir = ':memory:';
  config.dbFile = ':memory:';
  config.workers = false;
  config.isTest = true;
}
