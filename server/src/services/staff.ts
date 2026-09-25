import { all, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore, hashPassword, inList } from '../auth.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { audit } from './audit.js';
import type { Role } from './permissions.js';

export interface UserInput {
  username: string;
  name: string;
  phone?: string;
  role: Role;
  password?: string;
  commission_rate?: number;
  all_stores?: boolean;
  store_ids?: number[];
  active?: boolean;
}

export function listUsers(tenantId: number) {
  const users = all<{ id: number }>(
    `SELECT id, username, name, phone, role, commission_rate, all_stores, active, last_login_at, created_at
       FROM users WHERE tenant_id = ? AND is_superadmin = 0 ORDER BY active DESC, name`,
    tenantId,
  );
  const links = all<{ user_id: number; store_id: number }>(
    `SELECT us.* FROM user_stores us JOIN users u ON u.id = us.user_id WHERE u.tenant_id = ?`, tenantId,
  );
  return users.map((u) => ({ ...u, store_ids: links.filter((l) => l.user_id === u.id).map((l) => l.store_id) }));
}

/** Satış danışmanı seçimi için aktif personel (kasa ekranı) */
export function listSalespeople(tenantId: number, storeId: number) {
  return all(
    `SELECT u.id, u.name FROM users u WHERE u.tenant_id = ? AND u.active = 1 AND u.is_superadmin = 0
        AND (u.role = 'owner' OR u.all_stores = 1 OR EXISTS (SELECT 1 FROM user_stores us WHERE us.user_id = u.id AND us.store_id = ?))
      ORDER BY u.name`,
    tenantId, storeId,
  );
}

export function saveUser(user: AuthUser, input: UserInput, id?: number) {
  const username = input.username?.trim().toLowerCase();
  if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) throw badRequest('Kullanıcı adı 3-32 karakter; harf, rakam, nokta, tire');
  if (!input.name?.trim()) throw badRequest('Ad soyad zorunludur');
  if (!['owner', 'manager', 'cashier', 'warehouse'].includes(input.role)) throw badRequest('Geçersiz rol');
  if (!id && (!input.password || input.password.length < 6)) throw badRequest('Şifre en az 6 karakter olmalı');
  if (input.password && input.password.length < 6) throw badRequest('Şifre en az 6 karakter olmalı');
  const rate = Math.round(Number(input.commission_rate ?? 0));
  if (rate < 0 || rate > 5000) throw badRequest('Prim oranı %0 - %50 arası olmalı');
  return tx(() => {
    const dup = one('SELECT 1 FROM users WHERE tenant_id = ? AND username = ? AND id <> ?', user.tenantId, username, id ?? 0);
    if (dup) throw conflict('Bu kullanıcı adı kullanılıyor');
    const storeIds = (input.store_ids ?? []).map(Number);
    const validStores = all<{ id: number }>(`SELECT id FROM stores WHERE tenant_id = ? AND id IN (${inList(storeIds)})`, user.tenantId).map((s) => s.id);
    let uid = id;
    if (id) {
      const ex = one<{ role: string; is_superadmin: number }>('SELECT role, is_superadmin FROM users WHERE id = ? AND tenant_id = ?', id, user.tenantId);
      if (!ex || ex.is_superadmin) throw notFound('Kullanıcı bulunamadı');
      if (id === user.id && (input.role !== 'owner' || input.active === false)) throw forbidden('Kendi yetkinizi düşüremez / hesabınızı kapatamazsınız');
      if (ex.role === 'owner' && (input.role !== 'owner' || input.active === false)) {
        const owners = one<{ n: number }>("SELECT COUNT(*) n FROM users WHERE tenant_id = ? AND role = 'owner' AND active = 1", user.tenantId)!.n;
        if (owners <= 1) throw badRequest('Firmada en az bir aktif patron kullanıcısı kalmalı');
      }
      run(
        `UPDATE users SET username = ?, name = ?, phone = ?, role = ?, commission_rate = ?, all_stores = ?, active = ?,
                token_version = token_version + CASE WHEN ? THEN 1 ELSE 0 END WHERE id = ?`,
        username, input.name.trim(), input.phone || null, input.role, rate, input.all_stores ? 1 : 0, input.active === false ? 0 : 1,
        input.active === false || !!input.password ? 1 : 0, id,
      );
      if (input.password) run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(input.password), id);
      run('DELETE FROM user_stores WHERE user_id = ?', id);
    } else {
      uid = Number(
        run(
          `INSERT INTO users (tenant_id, username, name, phone, role, password_hash, commission_rate, all_stores, active)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          user.tenantId, username, input.name.trim(), input.phone || null, input.role, hashPassword(input.password!), rate,
          input.all_stores ? 1 : 0, input.active === false ? 0 : 1,
        ).lastInsertRowid,
      );
    }
    for (const s of validStores) run('INSERT INTO user_stores (user_id, store_id) VALUES (?,?)', uid, s);
    audit(user, user.tenantId, id ? 'user.update' : 'user.create', 'user', uid, { username, role: input.role });
    return listUsers(user.tenantId).find((u) => u.id === uid);
  });
}

// ---------------------------------------------------------------- Vardiya (mesai)

export function clockIn(user: AuthUser, storeId: number) {
  assertStore(user, storeId);
  const open = one('SELECT id FROM shifts WHERE user_id = ? AND clock_out IS NULL', user.id);
  if (open) throw badRequest('Zaten mesaidesiniz; önce çıkış yapın');
  const r = run('INSERT INTO shifts (tenant_id, user_id, store_id) VALUES (?,?,?)', user.tenantId, user.id, storeId);
  return one('SELECT * FROM shifts WHERE id = ?', r.lastInsertRowid);
}

export function clockOut(user: AuthUser) {
  const open = one<{ id: number }>('SELECT id FROM shifts WHERE user_id = ? AND clock_out IS NULL', user.id);
  if (!open) throw badRequest('Açık mesai kaydınız yok');
  run("UPDATE shifts SET clock_out = datetime('now','localtime') WHERE id = ?", open.id);
  return one('SELECT * FROM shifts WHERE id = ?', open.id);
}

export function myShift(user: AuthUser) {
  return one('SELECT s.*, st.name AS store_name FROM shifts s JOIN stores st ON st.id = s.store_id WHERE s.user_id = ? AND s.clock_out IS NULL', user.id) ?? null;
}

export function listShifts(user: AuthUser, from: string, toExclusive: string, userId?: number) {
  return all(
    `SELECT sh.*, u.name AS user_name, st.name AS store_name,
            ROUND((julianday(COALESCE(sh.clock_out, datetime('now','localtime'))) - julianday(sh.clock_in)) * 24, 2) AS hours
       FROM shifts sh JOIN users u ON u.id = sh.user_id JOIN stores st ON st.id = sh.store_id
      WHERE sh.tenant_id = ? AND sh.store_id IN (${inList(user.storeIds)}) AND sh.clock_in >= ? AND sh.clock_in < ?
        ${userId ? 'AND sh.user_id = ?' : ''}
      ORDER BY sh.clock_in DESC LIMIT 1000`,
    user.tenantId, from, toExclusive, ...(userId ? [userId] : []),
  );
}

// ---------------------------------------------------------------- Hedefler

export function setTarget(user: AuthUser, input: { month: string; storeId?: number | null; userId?: number | null; amount: number }) {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw badRequest('Ay YYYY-AA biçiminde olmalı');
  if (!Number.isInteger(input.amount) || input.amount < 0) throw badRequest('Hedef tutarı geçersiz');
  if (input.storeId) assertStore(user, input.storeId);
  if (input.userId && !one('SELECT 1 FROM users WHERE id = ? AND tenant_id = ?', input.userId, user.tenantId)) throw notFound('Personel bulunamadı');
  const ex = one<{ id: number }>(
    'SELECT id FROM targets WHERE tenant_id = ? AND month = ? AND store_id IS ? AND user_id IS ?',
    user.tenantId, input.month, input.storeId ?? null, input.userId ?? null,
  );
  if (ex) {
    if (input.amount === 0) run('DELETE FROM targets WHERE id = ?', ex.id);
    else run('UPDATE targets SET amount = ? WHERE id = ?', input.amount, ex.id);
  } else if (input.amount > 0) {
    run('INSERT INTO targets (tenant_id, month, store_id, user_id, amount) VALUES (?,?,?,?,?)', user.tenantId, input.month, input.storeId ?? null, input.userId ?? null, input.amount);
  }
  return listTargets(user, input.month);
}

export function listTargets(user: AuthUser, month: string) {
  const targets = all<{ id: number; store_id: number | null; user_id: number | null; amount: number }>(
    `SELECT t.*, st.name AS store_name, u.name AS user_name FROM targets t LEFT JOIN stores st ON st.id = t.store_id
       LEFT JOIN users u ON u.id = t.user_id WHERE t.tenant_id = ? AND t.month = ?`,
    user.tenantId, month,
  );
  const from = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  return targets.map((t) => {
    const actual = one<{ a: number }>(
      `SELECT COALESCE(SUM(total),0) a FROM sales WHERE tenant_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?
         ${t.store_id ? 'AND store_id = ' + Number(t.store_id) : ''} ${t.user_id ? 'AND salesperson_id = ' + Number(t.user_id) : ''}`,
      user.tenantId, from, to,
    )!.a;
    return { ...t, actual, percent: t.amount ? Math.round((actual * 1000) / t.amount) / 10 : 0 };
  });
}

// ---------------------------------------------------------------- Görevler

export function listTasks(user: AuthUser, showDone = false) {
  return all(
    `SELECT t.*, st.name AS store_name, ua.name AS assigned_name, uc.name AS created_by_name FROM tasks t
       LEFT JOIN stores st ON st.id = t.store_id LEFT JOIN users ua ON ua.id = t.assigned_to LEFT JOIN users uc ON uc.id = t.created_by
      WHERE t.tenant_id = ? AND (t.store_id IS NULL OR t.store_id IN (${inList(user.storeIds)})) ${showDone ? '' : 'AND t.done = 0'}
      ORDER BY t.done, COALESCE(t.due_date, '9999'), t.id DESC LIMIT 300`,
    user.tenantId,
  );
}

export function saveTask(user: AuthUser, input: { title: string; detail?: string; storeId?: number | null; assignedTo?: number | null; dueDate?: string | null }, id?: number) {
  if (!input.title?.trim()) throw badRequest('Başlık zorunlu');
  if (input.storeId) assertStore(user, input.storeId);
  if (id) {
    if (!one('SELECT 1 FROM tasks WHERE id = ? AND tenant_id = ?', id, user.tenantId)) throw notFound();
    run('UPDATE tasks SET title = ?, detail = ?, store_id = ?, assigned_to = ?, due_date = ? WHERE id = ?', input.title.trim(), input.detail || null, input.storeId || null, input.assignedTo || null, input.dueDate || null, id);
    return one('SELECT * FROM tasks WHERE id = ?', id);
  }
  const r = run(
    'INSERT INTO tasks (tenant_id, title, detail, store_id, assigned_to, due_date, created_by) VALUES (?,?,?,?,?,?,?)',
    user.tenantId, input.title.trim(), input.detail || null, input.storeId || null, input.assignedTo || null, input.dueDate || null, user.id,
  );
  return one('SELECT * FROM tasks WHERE id = ?', r.lastInsertRowid);
}

export function toggleTask(user: AuthUser, id: number, done: boolean) {
  if (!one('SELECT 1 FROM tasks WHERE id = ? AND tenant_id = ?', id, user.tenantId)) throw notFound();
  run("UPDATE tasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now','localtime') END WHERE id = ?", done ? 1 : 0, done ? 1 : 0, id);
  return one('SELECT * FROM tasks WHERE id = ?', id);
}

export function deleteTask(user: AuthUser, id: number) {
  run('DELETE FROM tasks WHERE id = ? AND tenant_id = ?', id, user.tenantId);
  return { ok: true };
}
