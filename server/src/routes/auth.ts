import { Router } from 'express';
import { z } from 'zod';
import { all, one, run } from '../db/index.js';
import { COOKIE, checkPassword, hashPassword, loadUser, me, requireAuth, signToken } from '../auth.js';
import { HttpError, badRequest } from '../utils/errors.js';
import { h, parse } from './helpers.js';
import { PERMISSIONS, ROLE_LABELS } from '../services/permissions.js';
import { getSettings } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';
import { myShift } from '../services/staff.js';

export const authRouter = Router();

// Kaba kuvvet koruması: firma+kullanıcı başına 5 dakikada 10 deneme
const attempts = new Map<string, { n: number; until: number }>();

function sessionPayload(userId: number) {
  const u = loadUser(userId)!;
  const tenant = one<{ id: number; code: string; name: string; plan: string; license_until: string | null }>(
    'SELECT id, code, name, plan, license_until FROM tenants WHERE id = ?', u.tenantId,
  )!;
  const stores = all('SELECT id, code, name, city, is_warehouse FROM stores WHERE tenant_id = ? AND active = 1 ORDER BY is_warehouse, id', u.tenantId)
    .filter((s: any) => u.storeIds.includes(s.id));
  return {
    user: { id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLE_LABELS[u.role], isSuperadmin: u.isSuperadmin, perms: [...u.perms] },
    tenant,
    stores,
    settings: getSettings(u.tenantId),
    permissions: PERMISSIONS,
    shift: myShift(u),
  };
}

authRouter.post(
  '/login',
  h((req, res) => {
    const body = parse(z.object({ tenant: z.string().min(1), username: z.string().min(1), password: z.string().min(1) }), req.body);
    const key = `${body.tenant}:${body.username}`.toLowerCase();
    const a = attempts.get(key);
    if (a && a.n >= 10 && a.until > Date.now()) throw new HttpError(429, 'Çok fazla hatalı deneme. 5 dakika bekleyin.');
    const row = one<{ id: number; password_hash: string; active: number; tenant_active: number; license_until: string | null; token_version: number }>(
      `SELECT u.id, u.password_hash, u.active, u.token_version, t.active tenant_active, t.license_until
         FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.code = ? COLLATE NOCASE AND u.username = ? COLLATE NOCASE`,
      body.tenant.trim(), body.username.trim(),
    );
    if (!row || !checkPassword(body.password, row.password_hash)) {
      attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 5 * 60000 });
      throw new HttpError(401, 'Firma kodu, kullanıcı adı veya şifre hatalı');
    }
    attempts.delete(key);
    if (!row.active) throw new HttpError(403, 'Kullanıcı hesabı kapalı');
    if (!row.tenant_active) throw new HttpError(403, 'Firma hesabı kapalı. Lütfen sağlayıcınızla görüşün.');
    if (row.license_until && row.license_until < new Date().toISOString().slice(0, 10)) throw new HttpError(403, 'Lisans süresi dolmuş (' + row.license_until + '). Lütfen sağlayıcınızla görüşün.');
    const token = signToken(row.id, row.token_version);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 12 * 3600 * 1000 });
    run("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?", row.id);
    const u = loadUser(row.id)!;
    audit(u, u.tenantId, 'login', 'user', u.id, null, req.ip);
    return { token, ...sessionPayload(row.id) };
  }),
);

authRouter.post(
  '/logout',
  h((req, res) => {
    res.clearCookie(COOKIE);
    return { ok: true };
  }),
);

authRouter.get('/me', requireAuth, h((req) => sessionPayload(me(req).id)));

authRouter.post(
  '/change-password',
  requireAuth,
  h((req, res) => {
    const u = me(req);
    const body = parse(z.object({ current: z.string(), next: z.string().min(6, 'Yeni şifre en az 6 karakter') }), req.body);
    const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id)!;
    if (!checkPassword(body.current, row.password_hash)) throw badRequest('Mevcut şifre hatalı');
    run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', hashPassword(body.next), u.id);
    const tv = one<{ token_version: number }>('SELECT token_version FROM users WHERE id = ?', u.id)!.token_version;
    const token = signToken(u.id, tv);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 12 * 3600 * 1000 });
    audit(u, u.tenantId, 'password.change', 'user', u.id);
    return { ok: true, token };
  }),
);
