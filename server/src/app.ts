import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { authenticate, requireAuth } from './auth.js';
import { errorHandler } from './routes/helpers.js';
import { authRouter } from './routes/auth.js';
import { posRouter } from './routes/pos.js';
import { catalogRouter } from './routes/catalog.js';
import { peopleRouter } from './routes/people.js';
import { adminRouter } from './routes/admin.js';
import { config } from './config.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());
  app.use(authenticate);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth, posRouter, catalogRouter, peopleRouter, adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Uç nokta bulunamadı' }));
  app.use(errorHandler);

  // Derlenmiş web arayüzü (tek sunucu, tek port)
  const dist = config.webDist;
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }
  return app;
}
