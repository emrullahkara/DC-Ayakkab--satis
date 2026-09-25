import { all, one } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { hasPerm, inList } from '../auth.js';
import { addDays, today } from '../utils/dates.js';
import { getSettings } from './settings.js';

interface R {
  storeIds: number[];
  from: string;
  toExclusive: string;
}

const SALES_BASE = `FROM sales s WHERE s.tenant_id = ? AND s.status = 'completed' AND s.store_id IN (%S) AND s.created_at >= ? AND s.created_at < ?`;

function base(user: AuthUser, r: R) {
  return { sql: SALES_BASE.replace('%S', inList(r.storeIds)), params: [user.tenantId, r.from, r.toExclusive] as unknown[] };
}

function strip(user: AuthUser, rows: Record<string, unknown>[], keys: string[]) {
  if (hasPerm(user, 'costs.view')) return rows;
  return rows.map((row) => {
    const o = { ...row };
    for (const k of keys) delete o[k];
    return o;
  });
}

/** Satış özeti: ciro, adet, iade, kâr, ortalama sepet */
export function salesSummary(user: AuthUser, r: R) {
  const b = base(user, r);
  const row = one<Record<string, number>>(
    `SELECT COALESCE(SUM(s.total),0) revenue, COALESCE(SUM(s.item_count),0) pairs,
            COUNT(CASE WHEN s.type='sale' THEN 1 END) receipts,
            COALESCE(SUM(CASE WHEN s.type<>'sale' THEN -s.total END),0) returns_amount,
            COUNT(CASE WHEN s.type<>'sale' THEN 1 END) returns_count,
            COALESCE(SUM(s.discount_total),0) discount, COALESCE(SUM(s.vat_total),0) vat,
            COALESCE(SUM(s.total - s.cost_total),0) profit, COALESCE(SUM(s.cost_total),0) cost,
            COUNT(DISTINCT s.customer_id) customers
     ${b.sql}`,
    ...b.params,
  )!;
  const out: Record<string, number> = {
    ...row,
    avg_basket: row.receipts ? Math.round(row.revenue / row.receipts) : 0,
    margin: row.revenue ? Math.round(((row.revenue - row.cost) * 1000) / row.revenue) / 10 : 0,
  };
  if (!hasPerm(user, 'costs.view')) {
    delete out.profit;
    delete out.cost;
    delete out.margin;
  }
  return out;
}

export function salesByDay(user: AuthUser, r: R) {
  const b = base(user, r);
  return strip(user, all(
    `SELECT substr(s.created_at,1,10) day, SUM(s.total) revenue, SUM(s.item_count) pairs, COUNT(*) receipts, SUM(s.total - s.cost_total) profit ${b.sql}
      GROUP BY day ORDER BY day`,
    ...b.params,
  ), ['profit']);
}

export function salesByHour(user: AuthUser, r: R) {
  const b = base(user, r);
  return all(`SELECT CAST(substr(s.created_at,12,2) AS INTEGER) hour, SUM(s.total) revenue, COUNT(*) receipts ${b.sql} GROUP BY hour ORDER BY hour`, ...b.params);
}

export function salesByStore(user: AuthUser, r: R) {
  const b = base(user, r);
  return strip(user, all(
    `SELECT st.id, st.name, SUM(s.total) revenue, SUM(s.item_count) pairs, COUNT(CASE WHEN s.type='sale' THEN 1 END) receipts,
            SUM(s.total - s.cost_total) profit, SUM(s.discount_total) discount
       ${b.sql.replace('FROM sales s', 'FROM sales s JOIN stores st ON st.id = s.store_id')} GROUP BY st.id ORDER BY revenue DESC`,
    ...b.params,
  ), ['profit']);
}

export function salesByStaff(user: AuthUser, r: R) {
  const b = base(user, r);
  return strip(user, all(
    `SELECT u.id, u.name, u.commission_rate, SUM(s.total) revenue, SUM(s.item_count) pairs, COUNT(CASE WHEN s.type='sale' THEN 1 END) receipts,
            SUM(s.total - s.cost_total) profit, SUM(s.discount_total) discount,
            CAST(SUM(s.total) * u.commission_rate / 10000 AS INTEGER) commission,
            (SELECT COUNT(*) FROM sales r WHERE r.salesperson_id = u.id AND r.type <> 'sale' AND r.status = 'completed' AND r.created_at >= ? AND r.created_at < ?) returns_count
       ${b.sql.replace('FROM sales s', 'FROM sales s JOIN users u ON u.id = s.salesperson_id')} GROUP BY u.id ORDER BY revenue DESC`,
    r.from, r.toExclusive, ...b.params,
  ), ['profit']);
}

export function salesByPayment(user: AuthUser, r: R) {
  const b = base(user, r);
  return all(
    `SELECT sp.method, SUM(sp.amount) amount, COUNT(DISTINCT sp.sale_id) n
       ${b.sql.replace('FROM sales s', 'FROM sales s JOIN sale_payments sp ON sp.sale_id = s.id')} GROUP BY sp.method ORDER BY amount DESC`,
    ...b.params,
  );
}

const ITEM_BASE = `FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
   LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
  WHERE s.tenant_id = ? AND s.status = 'completed' AND s.store_id IN (%S) AND s.created_at >= ? AND s.created_at < ?`;

function itemBase(user: AuthUser, r: R) {
  return { sql: ITEM_BASE.replace('%S', inList(r.storeIds)), params: [user.tenantId, r.from, r.toExclusive] as unknown[] };
}

/** Ürün performansı: en çok satanlar; groupBy = product | brand | category | size | color | gender | season */
export function productPerformance(user: AuthUser, r: R, groupBy = 'product', limit = 50) {
  const ib = itemBase(user, r);
  const groups: Record<string, { key: string; label: string }> = {
    product: { key: 'p.id', label: "p.code || ' ' || p.name" },
    brand: { key: 'p.brand_id', label: "COALESCE(b.name,'(Markasız)')" },
    category: { key: 'p.category_id', label: "COALESCE(c.name,'(Kategorisiz)')" },
    size: { key: 'v.size', label: 'v.size' },
    color: { key: 'v.color', label: 'v.color' },
    gender: { key: 'p.gender', label: "COALESCE(p.gender,'-')" },
    season: { key: 'p.season', label: "COALESCE(p.season,'-')" },
    supplier: { key: 'p.supplier_id', label: "COALESCE((SELECT name FROM suppliers WHERE id = p.supplier_id),'-')" },
  };
  const g = groups[groupBy] ?? groups.product;
  return strip(user, all(
    `SELECT ${g.key} id, ${g.label} label, SUM(si.qty) pairs, SUM(si.line_total) revenue, SUM(si.discount) discount,
            SUM(si.line_total - si.unit_cost * si.qty) profit, SUM(CASE WHEN si.qty < 0 THEN -si.qty ELSE 0 END) returned
       ${ib.sql} GROUP BY ${g.key} ORDER BY ${groupBy === 'size' ? 'CAST(v.size AS REAL)' : 'pairs DESC'} LIMIT ?`,
    ...ib.params, Math.min(limit, 500),
  ), ['profit']);
}

/** Numara bazlı satış / stok dağılımı (asorti planlaması için) */
export function sizeCurve(user: AuthUser, r: R, productId?: number) {
  const ib = itemBase(user, r);
  const sold = all<{ size: string; pairs: number }>(
    `SELECT v.size, SUM(si.qty) pairs ${ib.sql} ${productId ? 'AND p.id = ?' : ''} GROUP BY v.size`,
    ...ib.params, ...(productId ? [productId] : []),
  );
  const stock = all<{ size: string; qty: number }>(
    `SELECT v.size, SUM(st.qty) qty FROM stock st JOIN variants v ON v.id = st.variant_id
      WHERE v.tenant_id = ? AND st.store_id IN (${inList(r.storeIds)}) ${productId ? 'AND v.product_id = ?' : ''} GROUP BY v.size`,
    user.tenantId, ...(productId ? [productId] : []),
  );
  const sizes = [...new Set([...sold.map((s) => s.size), ...stock.map((s) => s.size)])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return sizes.map((size) => ({ size, sold: sold.find((s) => s.size === size)?.pairs ?? 0, stock: stock.find((s) => s.size === size)?.qty ?? 0 }));
}

/** Stok değeri (alış ve satış fiyatı üzerinden), mağaza bazında */
export function stockValue(user: AuthUser, storeIds: number[]) {
  const rows = all<Record<string, unknown>>(
    `SELECT st.store_id, s.name store_name, SUM(st.qty) pairs, SUM(st.qty * p.cost_price) cost_value,
            SUM(st.qty * COALESCE(v.sale_price, p.sale_price)) sale_value, COUNT(DISTINCT p.id) models
       FROM stock st JOIN variants v ON v.id = st.variant_id JOIN products p ON p.id = v.product_id JOIN stores s ON s.id = st.store_id
      WHERE v.tenant_id = ? AND st.store_id IN (${inList(storeIds)}) AND st.qty > 0 GROUP BY st.store_id`,
    user.tenantId,
  );
  return strip(user, rows, ['cost_value']);
}

/** Ölü stok: X gündür hiç satılmayan, stokta olan modeller */
export function deadStock(user: AuthUser, storeIds: number[], days?: number) {
  const d = days ?? getSettings(user.tenantId).stock.deadStockDays;
  const since = addDays(today(), -d);
  return strip(user, all(
    `SELECT p.id, p.code, p.name, b.name brand, p.season, p.sale_price, p.cost_price, SUM(st.qty) qty, SUM(st.qty * p.cost_price) cost_value,
            (SELECT MAX(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN variants v2 ON v2.id = si.variant_id
              WHERE v2.product_id = p.id AND s.status = 'completed' AND si.qty > 0) last_sale,
            (SELECT MIN(created_at) FROM stock_movements m JOIN variants v3 ON v3.id = m.variant_id WHERE v3.product_id = p.id AND m.qty > 0) first_in
       FROM stock st JOIN variants v ON v.id = st.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE v.tenant_id = ? AND st.store_id IN (${inList(storeIds)}) AND st.qty > 0 AND p.active = 1
      GROUP BY p.id HAVING (last_sale IS NULL OR last_sale < ?) ORDER BY cost_value DESC LIMIT 500`,
    user.tenantId, since,
  ), ['cost_price', 'cost_value']);
}

/** Kritik stok: mağazada satılan ama numarası tükenmiş / azalmış modeller (eksik numara uyarısı) */
export function lowStock(user: AuthUser, storeIds: number[]) {
  return all(
    `SELECT p.id product_id, p.code, p.name, p.min_stock, v.id variant_id, v.color, v.size, st.id store_id, st.name store_name,
            COALESCE(sk.qty,0) qty,
            (SELECT COALESCE(SUM(qty),0) FROM stock WHERE variant_id = v.id AND store_id <> st.id) other_stores_qty,
            (SELECT COALESCE(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
              WHERE si.variant_id = v.id AND s.store_id = st.id AND s.status='completed' AND s.created_at >= date('now','localtime','-30 days')) sold30
       FROM variants v JOIN products p ON p.id = v.product_id
       JOIN stores st ON st.tenant_id = p.tenant_id AND st.active = 1 AND st.is_warehouse = 0 AND st.id IN (${inList(storeIds)})
       LEFT JOIN stock sk ON sk.variant_id = v.id AND sk.store_id = st.id
      WHERE v.tenant_id = ? AND v.active = 1 AND p.active = 1 AND COALESCE(sk.qty,0) < p.min_stock
        AND EXISTS (SELECT 1 FROM stock s2 JOIN variants v2 ON v2.id = s2.variant_id WHERE v2.product_id = p.id AND s2.store_id = st.id AND s2.qty > 0)
      ORDER BY sold30 DESC, p.code, v.color, CAST(v.size AS REAL) LIMIT 500`,
    user.tenantId,
  );
}

/** Devir hızı: sezon / marka bazında satılan ÷ ortalama stok */
export function sellThrough(user: AuthUser, r: R, groupBy: 'brand' | 'season' | 'category' | 'supplier' = 'season') {
  const ib = itemBase(user, r);
  const key = { brand: 'p.brand_id', season: 'p.season', category: 'p.category_id', supplier: 'p.supplier_id' }[groupBy];
  const label = {
    brand: "COALESCE(b.name,'-')", season: "COALESCE(p.season,'-')", category: "COALESCE(c.name,'-')",
    supplier: "COALESCE((SELECT name FROM suppliers WHERE id = p.supplier_id),'-')",
  }[groupBy];
  const sold = all<{ id: unknown; label: string; pairs: number; revenue: number }>(
    `SELECT ${key} id, ${label} label, SUM(si.qty) pairs, SUM(si.line_total) revenue ${ib.sql} GROUP BY ${key}`,
    ...ib.params,
  );
  const stock = all<{ id: unknown; qty: number }>(
    `SELECT ${key} id, SUM(st.qty) qty FROM stock st JOIN variants v ON v.id = st.variant_id JOIN products p ON p.id = v.product_id
      WHERE v.tenant_id = ? AND st.store_id IN (${inList(r.storeIds)}) GROUP BY ${key}`,
    user.tenantId,
  );
  return sold.map((s) => {
    const q = stock.find((x) => String(x.id) === String(s.id))?.qty ?? 0;
    return { ...s, stock: q, sell_through: s.pairs + q > 0 ? Math.round((s.pairs * 1000) / (s.pairs + q)) / 10 : 0 };
  }).sort((a, b) => b.revenue - a.revenue);
}

export function profitAndLoss(user: AuthUser, r: R) {
  const b = base(user, r);
  const s = one<{ revenue: number; cost: number; vat: number }>(`SELECT COALESCE(SUM(s.total),0) revenue, COALESCE(SUM(s.cost_total),0) cost, COALESCE(SUM(s.vat_total),0) vat ${b.sql}`, ...b.params)!;
  const expenses = all<{ category: string; amount: number }>(
    `SELECT COALESCE(category,'Diğer') category, SUM(amount) amount FROM cash_movements
      WHERE tenant_id = ? AND type = 'expense' AND store_id IN (${inList(r.storeIds)}) AND created_at >= ? AND created_at < ? GROUP BY category ORDER BY amount DESC`,
    user.tenantId, r.from, r.toExclusive,
  );
  const otherIncome = one<{ a: number }>(
    `SELECT COALESCE(SUM(amount),0) a FROM cash_movements WHERE tenant_id = ? AND type = 'income' AND store_id IN (${inList(r.storeIds)}) AND created_at >= ? AND created_at < ?`,
    user.tenantId, r.from, r.toExclusive,
  )!.a;
  const expenseTotal = expenses.reduce((a, e) => a + e.amount, 0);
  const gross = s.revenue - s.cost;
  return {
    revenue: s.revenue, revenueNet: s.revenue - s.vat, vat: s.vat, cost: s.cost, grossProfit: gross,
    otherIncome, expenses, expenseTotal, netProfit: gross + otherIncome - expenseTotal,
  };
}

export function vatReport(user: AuthUser, r: R) {
  const ib = itemBase(user, r);
  return all(
    `SELECT si.vat_rate rate, SUM(si.line_total) gross, SUM(si.line_total) - SUM(ROUND(si.line_total * si.vat_rate / (100.0 + si.vat_rate))) net,
            SUM(ROUND(si.line_total * si.vat_rate / (100.0 + si.vat_rate))) vat ${ib.sql} GROUP BY si.vat_rate ORDER BY rate`,
    ...ib.params,
  );
}

/** Patron paneli: bugün / bu ay özet, mağaza karşılaştırması, uyarılar */
export function dashboard(user: AuthUser, storeIds: number[]) {
  const t = today();
  const tomorrow = addDays(t, 1);
  const monthStart = t.slice(0, 7) + '-01';
  const yesterday = addDays(t, -1);
  const lastYearSameDay = `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`;
  const todayR = { storeIds, from: t, toExclusive: tomorrow };
  const monthR = { storeIds, from: monthStart, toExclusive: tomorrow };
  const canCost = hasPerm(user, 'costs.view');
  const sum = (from: string, to: string) => one<{ revenue: number; pairs: number; receipts: number }>(
    `SELECT COALESCE(SUM(s.total),0) revenue, COALESCE(SUM(s.item_count),0) pairs, COUNT(CASE WHEN s.type='sale' THEN 1 END) receipts
     ${SALES_BASE.replace('%S', inList(storeIds))}`,
    user.tenantId, from, to,
  )!;
  const registers = all(
    `SELECT st.id, st.name, rs.id session_id, rs.opened_at, u.name opened_by_name,
            (SELECT COALESCE(SUM(total),0) FROM sales WHERE register_session_id = rs.id AND status='completed') session_total,
            (SELECT COALESCE(SUM(total),0) FROM sales WHERE store_id = st.id AND status='completed' AND created_at >= ? AND created_at < ?) today_total,
            (SELECT COALESCE(SUM(item_count),0) FROM sales WHERE store_id = st.id AND status='completed' AND created_at >= ? AND created_at < ?) today_pairs,
            (SELECT COUNT(*) FROM sales WHERE store_id = st.id AND status='completed' AND type='sale' AND created_at >= ? AND created_at < ?) today_receipts
       FROM stores st LEFT JOIN register_sessions rs ON rs.store_id = st.id AND rs.status = 'open' LEFT JOIN users u ON u.id = rs.opened_by
      WHERE st.tenant_id = ? AND st.active = 1 AND st.id IN (${inList(storeIds)}) ORDER BY st.is_warehouse, st.id`,
    t, tomorrow, t, tomorrow, t, tomorrow, user.tenantId,
  );
  const alerts: { type: string; level: 'info' | 'warn' | 'danger'; text: string; link?: string; count?: number }[] = [];
  const lowCount = lowStock(user, storeIds).length;
  if (lowCount) alerts.push({ type: 'low_stock', level: 'warn', text: `${lowCount} numarada stok kritik seviyede (eksik numara)`, link: '/stok?filtre=kritik', count: lowCount });
  const arrived = one<{ n: number }>(`SELECT COUNT(*) n FROM customer_orders WHERE tenant_id = ? AND status IN ('arrived') AND store_id IN (${inList(storeIds)})`, user.tenantId)!.n;
  if (arrived) alerts.push({ type: 'orders_arrived', level: 'info', text: `${arrived} müşteri siparişi geldi, müşteriye haber verilecek`, link: '/siparisler', count: arrived });
  const overdueOrders = one<{ n: number }>(`SELECT COUNT(*) n FROM customer_orders WHERE tenant_id = ? AND status IN ('open','ordered') AND due_date < ? AND store_id IN (${inList(storeIds)})`, user.tenantId, t)!.n;
  if (overdueOrders) alerts.push({ type: 'orders_late', level: 'danger', text: `${overdueOrders} müşteri siparişinin söz verilen tarihi geçti`, link: '/siparisler', count: overdueOrders });
  const pendingTransfers = one<{ n: number }>(`SELECT COUNT(*) n FROM transfers WHERE tenant_id = ? AND status = 'sent' AND to_store_id IN (${inList(storeIds)})`, user.tenantId)!.n;
  if (pendingTransfers) alerts.push({ type: 'transfers', level: 'info', text: `${pendingTransfers} transfer teslim alınmayı bekliyor`, link: '/transferler', count: pendingTransfers });
  const requested = one<{ n: number }>(`SELECT COUNT(*) n FROM transfers WHERE tenant_id = ? AND status = 'requested' AND from_store_id IN (${inList(storeIds)})`, user.tenantId)!.n;
  if (requested) alerts.push({ type: 'transfer_requests', level: 'info', text: `${requested} mağaza sizden ürün talep ediyor`, link: '/transferler', count: requested });
  if (hasPerm(user, 'customers.credit')) {
    const debt = one<{ n: number; total: number }>(
      `SELECT COUNT(*) n, COALESCE(SUM(b),0) total FROM (SELECT SUM(amount) b FROM customer_ledger cl JOIN customers c ON c.id = cl.customer_id WHERE c.tenant_id = ? GROUP BY cl.customer_id HAVING b > 0)`,
      user.tenantId,
    )!;
    if (debt.n) alerts.push({ type: 'receivables', level: 'warn', text: `${debt.n} müşteride toplam ${(debt.total / 100).toLocaleString('tr-TR')} TL veresiye alacak var`, link: '/musteriler?segment=debt', count: debt.n });
  }
  if (hasPerm(user, 'suppliers')) {
    const due = one<{ n: number; total: number }>(
      `SELECT COUNT(*) n, COALESCE(SUM(b),0) total FROM (SELECT SUM(amount) b FROM supplier_ledger sl JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.tenant_id = ? GROUP BY sl.supplier_id HAVING b > 0 AND MIN(CASE WHEN sl.type='invoice' THEN sl.due_date END) <= ?)`,
      user.tenantId, addDays(t, 7),
    )!;
    if (due.n) alerts.push({ type: 'payables', level: 'warn', text: `${due.n} tedarikçiye 7 gün içinde ${(due.total / 100).toLocaleString('tr-TR')} TL ödeme var`, link: '/tedarikciler', count: due.n });
  }
  const openRegistersYesterday = one<{ n: number }>(
    `SELECT COUNT(*) n FROM register_sessions WHERE tenant_id = ? AND status = 'open' AND opened_at < ? AND store_id IN (${inList(storeIds)})`,
    user.tenantId, t,
  )!.n;
  if (openRegistersYesterday) alerts.push({ type: 'register_open', level: 'danger', text: `${openRegistersYesterday} mağazada dünden kalan kapatılmamış kasa var`, link: '/kasa', count: openRegistersYesterday });
  const birthdays = all<{ name: string }>(
    `SELECT name FROM customers WHERE tenant_id = ? AND active = 1 AND birth_date IS NOT NULL AND strftime('%m-%d', birth_date) = strftime('%m-%d', 'now', 'localtime') LIMIT 20`,
    user.tenantId,
  );
  if (birthdays.length) alerts.push({ type: 'birthday', level: 'info', text: `Bugün doğum günü olan müşteriler: ${birthdays.map((b) => b.name).join(', ')}`, link: '/musteriler?segment=birthday', count: birthdays.length });
  const errors = one<{ n: number }>("SELECT COUNT(*) n FROM outbox WHERE tenant_id = ? AND status = 'error'", user.tenantId)!.n;
  if (errors && hasPerm(user, 'integrations')) alerts.push({ type: 'outbox', level: 'danger', text: `${errors} entegrasyon işi hata verdi (e-fatura / pazaryeri / SMS)`, link: '/ayarlar/entegrasyonlar', count: errors });
  const tasks = one<{ n: number }>(`SELECT COUNT(*) n FROM tasks WHERE tenant_id = ? AND done = 0 AND (assigned_to = ? OR assigned_to IS NULL) AND (due_date IS NULL OR due_date <= ?)`, user.tenantId, user.id, t)!.n;
  if (tasks) alerts.push({ type: 'tasks', level: 'info', text: `${tasks} bekleyen görev / not`, link: '/gorevler', count: tasks });

  const topToday = productPerformance(user, todayR, 'product', 5);
  const staffMonth = salesByStaff(user, monthR);
  const targets = all<{ store_id: number | null; user_id: number | null; amount: number }>('SELECT * FROM targets WHERE tenant_id = ? AND month = ?', user.tenantId, t.slice(0, 7));
  const monthSum = sum(monthStart, tomorrow);
  const companyTarget = targets.find((x) => !x.store_id && !x.user_id);
  const last14 = salesByDay(user, { storeIds, from: addDays(t, -13), toExclusive: tomorrow });
  const paymentsToday = salesByPayment(user, todayR);
  const result: Record<string, unknown> = {
    today: sum(t, tomorrow),
    yesterday: sum(yesterday, t),
    lastYear: sum(lastYearSameDay, addDays(lastYearSameDay, 1)),
    month: monthSum,
    monthTarget: companyTarget ? { amount: companyTarget.amount, percent: Math.round((monthSum.revenue * 1000) / companyTarget.amount) / 10 } : null,
    registers,
    alerts,
    topToday,
    staffMonth,
    last14,
    paymentsToday,
  };
  if (canCost) result.monthProfit = one<{ p: number }>(`SELECT COALESCE(SUM(s.total - s.cost_total),0) p ${SALES_BASE.replace('%S', inList(storeIds))}`, user.tenantId, monthStart, tomorrow)!.p;
  return result;
}
