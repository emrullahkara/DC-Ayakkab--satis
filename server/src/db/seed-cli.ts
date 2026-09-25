import { initDb } from './index.js';
import { config } from '../config.js';
import { ensureBootstrap } from './bootstrap.js';
import { seedDemo } from './seed.js';

process.env.TZ = process.env.TZ || 'Europe/Istanbul';
initDb(config.dbFile);
ensureBootstrap();
seedDemo();
