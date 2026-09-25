import { createApp } from './app.js';
import { initDb } from './db/index.js';
import { config } from './config.js';
import { ensureBootstrap } from './db/bootstrap.js';
import { seedDemo } from './db/seed.js';
import { runOutboxOnce, scheduleMarketplacePolls } from './integrations/worker.js';
import { backupNow } from './services/backup.js';
import { dailyJobs } from './services/jobs.js';

process.env.TZ = process.env.TZ || 'Europe/Istanbul';

initDb(config.dbFile);
ensureBootstrap();
if (config.seedDemo) seedDemo();

const app = createApp();
app.listen(config.port, () => {
  console.log(`DC Ayakkabı Satış sunucusu http://localhost:${config.port} adresinde çalışıyor (veri: ${config.dbFile})`);
});

if (config.workers) {
  setInterval(() => runOutboxOnce().catch((e) => console.error('outbox', e)), 15000);
  setInterval(() => scheduleMarketplacePolls(), 5 * 60000);
  setInterval(() => backupNow().catch((e) => console.error('yedek', e)), 6 * 3600000);
  setInterval(() => dailyJobs(), 3600000);
  setTimeout(() => dailyJobs(), 10000);
}
