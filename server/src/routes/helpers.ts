import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { HttpError } from '../utils/errors.js';

/** Async route sarmalayıcı: hataları merkezi işleyiciye taşır. */
export const h =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (!res.headersSent) res.json(out ?? { ok: true });
      })
      .catch(next);
  };

export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first?.path?.length ? first.path.join('.') + ': ' : '';
    throw new HttpError(400, 'Geçersiz veri - ' + path + (first?.message ?? ''), r.error.issues);
  }
  return r.data;
}

export const id = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Geçersiz kayıt numarası');
  return n;
};

export const intOpt = (v: unknown) => (v === undefined || v === '' || v === null ? undefined : Number(v));
export const money = z.number().int().min(0);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG olmalı');

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string; code?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Geçersiz JSON' });
    return;
  }
  if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    res.status(409).json({ error: 'Bu kayıt zaten var (benzersiz alan çakışması)' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası: ' + (e?.message ?? 'bilinmeyen') });
}
