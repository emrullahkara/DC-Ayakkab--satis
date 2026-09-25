import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { all, one } from './db/index.js';
import { HttpError, forbidden } from './utils/errors.js';
import { ROLE_PERMISSIONS, type Permission, type Role } from './services/permissions.js';
import { config } from './config.js';

export interface AuthUser {
  id: number;
  tenantId: number;
  tenantCode: string;
  username: string;
  name: string;
  role: Role;
  isSuperadmin: boolean;
  allStores: boolean;
  storeIds: number[];
  perms: Set<Permission>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE = 'dc_oturum';
let secret: string | null = null;

function jwtSecret(): string {
  if (secret) return secret;
  if (config.jwtSecret) return (secret = config.jwtSecret);
  // Ortam değişkeni verilmemişse veri klasöründe kalıcı bir anahtar üret
  if (config.dataDir === ':memory:') return (secret = randomBytes(32).toString('hex'));
  const file = join(config.dataDir, '.jwt-secret');
  if (existsSync(file)) return (secret = readFileSync(file, 'utf8').trim());
  mkdirSync(config.dataDir, { recursive: true });
  secret = randomBytes(48).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function hashPassword(pw: string) {
  return bcrypt.hashSync(pw, 10);
}
export function checkPassword(pw: string, hash: string) {
  return bcrypt.compareSync(pw, hash);
}

export function signToken(userId: number, tokenVersion: number) {
  return jwt.sign({ uid: userId, tv: tokenVersion }, jwtSecret(), { expiresIn: '12h' });
}

interface UserRow {
  id: number;
  tenant_id: number;
  username: string;
  name: string;
  role: Role;
  is_superadmin: number;
  all_stores: number;
  active: number;
  token_version: number;
  tenant_code: string;
  tenant_active: number;
  license_until: string | null;
}

export function loadUser(userId: number): (AuthUser & { tokenVersion: number; active: boolean; tenantActive: boolean; licenseUntil: string | null }) | null {
  const u = one<UserRow>(
    `SELECT u.*, t.code AS tenant_code, t.active AS tenant_active, t.license_until
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ?`,
    userId,
  );
  if (!u) return null;
  const allStores = u.role === 'owner' || !!u.all_stores;
  const storeIds = allStores
    ? all<{ id: number }>('SELECT id FROM stores WHERE tenant_id = ? AND active = 1', u.tenant_id).map((r) => r.id)
    : all<{ store_id: number }>(
        'SELECT us.store_id FROM user_stores us JOIN stores s ON s.id = us.store_id WHERE us.user_id = ? AND s.active = 1',
        u.id,
      ).map((r) => r.store_id);
  return {
    id: u.id,
    tenantId: u.tenant_id,
    tenantCode: u.tenant_code,
    username: u.username,
    name: u.name,
    role: u.role,
    isSuperadmin: !!u.is_superadmin,
    allStores,
    storeIds,
    perms: new Set(ROLE_PERMISSIONS[u.role]),
    tokenVersion: u.token_version,
    active: !!u.active,
    tenantActive: !!u.tenant_active,
    licenseUntil: u.license_until,
  };
}

/** Oturum çerezini okuyup req.user'ı doldurur. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = (req.cookies?.[COOKIE] as string | undefined) || (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, jwtSecret()) as { uid: number; tv: number };
    const u = loadUser(payload.uid);
    if (u && u.active && u.tenantActive && u.tokenVersion === payload.tv) req.user = u;
  } catch {
    /* geçersiz / süresi dolmuş oturum */
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Oturum açmanız gerekiyor'));
  next();
}

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Oturum açmanız gerekiyor'));
    if (!perms.some((p) => req.user!.perms.has(p))) return next(forbidden());
    next();
  };
}

export function requireSuperadmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.isSuperadmin) return next(forbidden('Sadece sistem yöneticisi'));
  next();
}

export function me(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Oturum açmanız gerekiyor');
  return req.user;
}

export function hasPerm(u: AuthUser, p: Permission) {
  return u.perms.has(p);
}

/** Kullanıcının mağazaya erişimi var mı? Yoksa 403. */
export function assertStore(u: AuthUser, storeId: number | null | undefined): number {
  const id = Number(storeId);
  if (!id || !u.storeIds.includes(id)) throw forbidden('Bu mağazaya erişim yetkiniz yok');
  return id;
}

/** Rapor filtreleri için: storeId verilmişse onu, yoksa kullanıcının tüm mağazalarını döner. */
export function storeFilter(u: AuthUser, storeId?: unknown): number[] {
  if (storeId !== undefined && storeId !== null && storeId !== '' && storeId !== 'all') {
    return [assertStore(u, Number(storeId))];
  }
  return u.storeIds.length ? u.storeIds : [-1];
}

export function inList(ids: number[]): string {
  return ids.map((n) => Number(n) | 0).join(',') || '-1';
}
