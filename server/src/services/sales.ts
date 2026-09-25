import { all, getDb, one, run, tx } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { assertStore, hasPerm } from '../auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { nextSeq } from '../utils/seq.js';
import { addDays, today } from '../utils/dates.js';
import { activeCampaigns, priceCart, type PriceLineInput, type PriceResult } from './pricing.js';
import { changeStock } from './stock.js';
import { getSettings } from './settings.js';
import { enqueue, isEnabled } from '../integrations/outbox.js';
import { audit } from './audit.js';
import { customerBalance } from './customers.js';
import { randomGiftCode } from './giftcards.js';

export type PayMethod = 'cash' | 'card' | 'transfer' | 'credit' | 'giftcard' | 'points' | 'deposit';

export const PAY_LABELS: Record<PayMethod, string> = {
  cash: 'Nakit',
  card: 'Kredi kartı',
  transfer: 'Havale / EFT',
  credit: 'Veresiye (açık hesap)',
  giftcard: 'Hediye çeki',
  points: 'Puan',
  deposit: 'Kapora',
};

export interface CartItemInput {
  variantId: number;
  qty: number;
  unitPrice?: number;
  discount?: number;
}
export interface PaymentInput {
  method: PayMethod;
  amount: number;
  installments?: number;
  ref?: string;
}
export interface SaleInput {
  storeId: number;
  customerId?: number | null;
  salespersonId?: number | null;
  customerOrderId?: number | null;
  items: CartItemInput[];
  cartDiscount?: number;
  payments: PaymentInput[];
  note?: string | null;
  einvoice?: boolean;
}

interface VariantInfo {
  id: number;
  product_id: number;
  color: string;
  size: string;
  barcode: string;
  price: number;
  cost_price: number;
  vat_rate: number;
  category_id: number | null;
  brand_id: number | null;
  season: string | null;
  code: string;
  name: string;
}

function loadVariant(tenantId: number, variantId: number): VariantInfo {
  const v = one<VariantInfo>(
    `SELECT v.id, v.product_id, v.color, v.size, v.barcode, COALESCE(v.sale_price, p.sale_price) AS price,
            p.cost_price, p.vat_rate, p.category_id, p.brand_id, p.season, p.code, p.name
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = ? AND v.tenant_id = ?`,
    variantId, tenantId,
  );
  if (!v) throw notFound('Ürün bulunamadı (#' + variantId + ')');
  return v;
}

function mergeItems(items: CartItemInput[]): CartItemInput[] {
  // Aynı ürün birden çok kez okutulduysa (ve fiyat/indirim aynıysa) tek satırda birleştir
  const out: CartItemInput[] = [];
  for (const it of items) {
    const same = out.find((o) => o.variantId === it.variantId && o.unitPrice === it.unitPrice && !o.discount && !it.discount);
    if (same) same.qty += it.qty;
    else out.push({ ...it });
  }
  return out;
}

/** Sepeti fiyatlar (kampanyalar dahil). Kasa ekranı her değişiklikte bunu çağırır. */
export function quote(user: AuthUser, input: { storeId: number; items: CartItemInput[]; cartDiscount?: number }) {
  const storeId = assertStore(user, input.storeId);
  const items = mergeItems(input.items ?? []);
  const infos = items.map((it) => {
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw badRequest('Adet 1 veya daha fazla olmalı');
    return loadVariant(user.tenantId, it.variantId);
  });
  const lines: PriceLineInput[] = items.map((it, i) => {
    const v = infos[i];
    let unitPrice = v.price;
    if (it.unitPrice != null && it.unitPrice !== v.price) {
      if (!hasPerm(user, 'prices.edit') && !hasPerm(user, 'sales.discount')) throw forbidden('Fiyat değiştirme yetkiniz yok');
      if (!Number.isInteger(it.unitPrice) || it.unitPrice < 0) throw badRequest('Geçersiz fiyat');
      unitPrice = it.unitPrice;
    }
    return {
      variantId: v.id,
      qty: it.qty,
      unitPrice,
      vatRate: v.vat_rate,
      productId: v.product_id,
      categoryId: v.category_id,
      brandId: v.brand_id,
      season: v.season,
      manualDiscount: Math.max(0, Math.round(it.discount ?? 0)),
    };
  });
  const result = priceCart(lines, activeCampaigns(user.tenantId, storeId), Math.max(0, Math.round(input.cartDiscount ?? 0)));
  const settings = getSettings(user.tenantId);
  const afterCampaign = result.subtotal - result.campaignDiscount;
  const manualPct = afterCampaign > 0 ? (result.manualDiscount * 100) / afterCampaign : 0;
  if (manualPct > settings.pos.maxDiscountPercent + 1e-9 && !hasPerm(user, 'sales.discount')) {
    throw forbidden(`En fazla %${settings.pos.maxDiscountPercent} indirim yapabilirsiniz. Daha fazlası için müdür onayı gerekir.`);
  }
  return {
    ...result,
    lines: result.lines.map((l, i) => ({
      ...l,
      code: infos[i].code,
      name: infos[i].name,
      color: infos[i].color,
      size: infos[i].size,
      barcode: infos[i].barcode,
      unitCost: infos[i].cost_price,
      listPrice: infos[i].price,
    })),
  };
}

type Quote = ReturnType<typeof quote>;

function openSession(tenantId: number, storeId: number): number | null {
  const s = one<{ id: number }>("SELECT id FROM register_sessions WHERE tenant_id = ? AND store_id = ? AND status = 'open'", tenantId, storeId);
  return s?.id ?? null;
}

function requireSession(user: AuthUser, storeId: number): number | null {
  const id = openSession(user.tenantId, storeId);
  if (!id && getSettings(user.tenantId).pos.requireOpenRegister) throw badRequest('Kasa açık değil. Önce kasayı açın.');
  return id;
}

interface CustomerRow {
  id: number;
  name: string;
  points: number;
  credit_limit: number;
}

function loadCustomer(tenantId: number, id?: number | null): CustomerRow | null {
  if (!id) return null;
  const c = one<CustomerRow>('SELECT id, name, points, credit_limit FROM customers WHERE id = ? AND tenant_id = ?', id, tenantId);
  if (!c) throw notFound('Müşteri bulunamadı');
  return c;
}

function checkSalesperson(tenantId: number, id?: number | null) {
  if (!id) return null;
  const u = one<{ id: number }>('SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1', id, tenantId);
  if (!u) throw badRequest('Satış danışmanı bulunamadı');
  return u.id;
}

interface PayContext {
  user: AuthUser;
  storeId: number;
  saleId: number;
  customer: CustomerRow | null;
  sessionId: number | null;
  receiptNo: string;
  depositAvailable: number;
}

const METHODS: PayMethod[] = ['cash', 'card', 'transfer', 'credit', 'giftcard', 'points', 'deposit'];

/** Ödemeleri doğrular ve yan etkilerini (veresiye, hediye çeki, puan) uygular. Dönen: iadede oluşturulan hediye çekleri. */
function applyPayments(ctx: PayContext, payments: PaymentInput[], total: number): { issuedGiftCards: string[]; pointsUsed: number } {
  const db = getDb();
  const sum = payments.reduce((a, p) => a + p.amount, 0);
  if (sum !== total) {
    throw badRequest(`Ödeme toplamı (${(sum / 100).toFixed(2)} TL) ile tutar (${(total / 100).toFixed(2)} TL) eşit değil`);
  }
  const issuedGiftCards: string[] = [];
  let pointsUsed = 0;
  let depositUsed = 0;
  for (const p of payments) {
    if (!METHODS.includes(p.method)) throw badRequest('Geçersiz ödeme türü');
    if (!Number.isInteger(p.amount) || p.amount === 0) throw badRequest('Ödeme tutarı geçersiz');
    if (total > 0 && p.amount < 0) throw badRequest('Satışta ödeme tutarı eksi olamaz');
    if (total < 0 && p.amount > 0) throw badRequest('İadede ödeme tutarları eksi olmalı');
    const installments = Math.max(1, Math.min(12, Math.round(p.installments ?? 1)));
    let ref = p.ref ?? null;

    if (p.method === 'credit') {
      if (!ctx.customer) throw badRequest('Veresiye için müşteri seçilmelidir');
      if (p.amount > 0) {
        const bal = customerBalance(ctx.customer.id);
        if (ctx.customer.credit_limit <= 0) throw badRequest(`${ctx.customer.name} için veresiye limiti tanımlı değil`);
        if (bal + p.amount > ctx.customer.credit_limit) {
          throw badRequest(`Veresiye limiti aşılıyor. Limit ${(ctx.customer.credit_limit / 100).toFixed(2)} TL, mevcut borç ${(bal / 100).toFixed(2)} TL`);
        }
      }
      db.prepare(
        `INSERT INTO customer_ledger (tenant_id, customer_id, store_id, type, amount, due_date, ref_type, ref_id, note, user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        ctx.user.tenantId, ctx.customer.id, ctx.storeId, p.amount > 0 ? 'sale' : 'return', p.amount,
        p.amount > 0 ? addDays(today(), 30) : null, 'sale', ctx.saleId, 'Fiş ' + ctx.receiptNo, ctx.user.id,
      );
    } else if (p.method === 'giftcard') {
      if (p.amount > 0) {
        const code = (p.ref ?? '').trim().toUpperCase();
        const g = one<{ id: number; balance: number; expires_at: string | null; active: number }>(
          'SELECT id, balance, expires_at, active FROM gift_cards WHERE tenant_id = ? AND code = ?',
          ctx.user.tenantId, code,
        );
        if (!g || !g.active) throw badRequest('Hediye çeki bulunamadı: ' + code);
        if (g.expires_at && g.expires_at < today()) throw badRequest('Hediye çekinin süresi dolmuş');
        if (g.balance < p.amount) throw badRequest(`Hediye çeki bakiyesi yetersiz (${(g.balance / 100).toFixed(2)} TL)`);
        db.prepare('UPDATE gift_cards SET balance = balance - ? WHERE id = ?').run(p.amount, g.id);
        ref = code;
      } else {
        // İade tutarı hediye çeki (mağaza kredisi) olarak verilir
        const code = randomGiftCode(ctx.user.tenantId);
        db.prepare(
          `INSERT INTO gift_cards (tenant_id, code, initial_amount, balance, customer_id, expires_at, note, created_by)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(ctx.user.tenantId, code, -p.amount, -p.amount, ctx.customer?.id ?? null, addDays(today(), 365), 'İade karşılığı ' + ctx.receiptNo, ctx.user.id);
        issuedGiftCards.push(code);
        ref = code;
      }
    } else if (p.method === 'points') {
      if (!ctx.customer) throw badRequest('Puan kullanımı için müşteri seçilmelidir');
      if (p.amount < 0) throw badRequest('İadede puan ile ödeme yapılamaz');
      const cur = one<{ points: number }>('SELECT points FROM customers WHERE id = ?', ctx.customer.id)!.points;
      if (cur < p.amount) throw badRequest(`Müşteri puanı yetersiz (${(cur / 100).toFixed(2)} TL)`);
      db.prepare('UPDATE customers SET points = points - ? WHERE id = ?').run(p.amount, ctx.customer.id);
      pointsUsed += p.amount;
    } else if (p.method === 'deposit') {
      if (p.amount < 0) throw badRequest('Kapora iadesi sipariş ekranından yapılır');
      depositUsed += p.amount;
      if (depositUsed > ctx.depositAvailable) throw badRequest('Kapora tutarı siparişte alınan kaporadan fazla olamaz');
    }
    db.prepare('INSERT INTO sale_payments (sale_id, method, amount, installments, ref) VALUES (?,?,?,?,?)').run(
      ctx.saleId, p.method, p.amount, p.method === 'card' ? installments : 1, ref,
    );
  }
  return { issuedGiftCards, pointsUsed };
}

function receiptNumber(tenantId: number, storeId: number): string {
  const store = one<{ code: string }>('SELECT code FROM stores WHERE id = ?', storeId)!;
  const n = nextSeq(tenantId, 'receipt:' + storeId);
  return `${store.code}-${String(n).padStart(6, '0')}`;
}

function queueIntegrations(user: AuthUser, saleId: number, wantInvoice: boolean) {
  if (isEnabled(user.tenantId, 'okc')) {
    enqueue(user.tenantId, 'okc', 'send_sale', { saleId }, { type: 'sale', id: saleId });
    run("UPDATE sales SET okc_status = 'pending' WHERE id = ?", saleId);
  }
  const settings = getSettings(user.tenantId);
  if (isEnabled(user.tenantId, 'einvoice') && (wantInvoice || settings.einvoice.autoSend)) {
    enqueue(user.tenantId, 'einvoice', 'send_invoice', { saleId }, { type: 'sale', id: saleId });
    run("UPDATE sales SET einvoice_status = 'pending' WHERE id = ?", saleId);
  }
}

function insertItems(saleId: number, q: Quote) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO sale_items (sale_id, variant_id, qty, unit_price, discount, line_total, vat_rate, unit_cost, campaign_id, campaign_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const l of q.lines) {
    stmt.run(saleId, l.variantId, l.qty, l.unitPrice, l.discount, l.lineTotal, l.vatRate, l.unitCost, l.campaignId, l.campaignName);
  }
}

/** Satışı tamamlar: stok düşer, ödemeler işlenir, puan kazanılır, entegrasyon kuyruğu doldurulur. */
export function createSale(user: AuthUser, input: SaleInput) {
  const storeId = assertStore(user, input.storeId);
  if (!input.items?.length) throw badRequest('Sepet boş');
  const settings = getSettings(user.tenantId);
  if (settings.pos.requireSalesperson && !input.salespersonId) throw badRequest('Satış danışmanı seçilmelidir');

  return tx(() => {
    const q = quote(user, input);
    const sessionId = requireSession(user, storeId);
    const salespersonId = checkSalesperson(user.tenantId, input.salespersonId) ?? user.id;

    let depositAvailable = 0;
    let order: { id: number; deposit: number; status: string; customer_id: number } | undefined;
    if (input.customerOrderId) {
      order = one('SELECT id, deposit, status, customer_id FROM customer_orders WHERE id = ? AND tenant_id = ?', input.customerOrderId, user.tenantId);
      if (!order) throw notFound('Müşteri siparişi bulunamadı');
      if (['delivered', 'cancelled'].includes(order.status)) throw badRequest('Bu sipariş zaten kapatılmış');
      depositAvailable = order.deposit;
    }
    const customer = loadCustomer(user.tenantId, input.customerId ?? order?.customer_id);

    const receiptNo = receiptNumber(user.tenantId, storeId);
    const costTotal = q.lines.reduce((a, l) => a + l.unitCost * l.qty, 0);
    const itemCount = q.lines.reduce((a, l) => a + l.qty, 0);
    const r = run(
      `INSERT INTO sales (tenant_id, store_id, receipt_no, type, customer_id, user_id, salesperson_id, register_session_id,
                          subtotal, discount_total, total, vat_total, cost_total, item_count, note)
       VALUES (?,?,?,'sale',?,?,?,?,?,?,?,?,?,?,?)`,
      user.tenantId, storeId, receiptNo, customer?.id ?? null, user.id, salespersonId, sessionId,
      q.subtotal, q.discountTotal, q.total, q.vatTotal, costTotal, itemCount, input.note ?? null,
    );
    const saleId = Number(r.lastInsertRowid);
    insertItems(saleId, q);
    for (const l of q.lines) {
      changeStock({
        tenantId: user.tenantId, storeId, variantId: l.variantId, qty: -l.qty, type: 'sale', userId: user.id,
        refType: 'sale', refId: saleId, unitCost: l.unitCost, allowNegative: settings.pos.allowNegativeStock,
      });
    }
    const { pointsUsed } = applyPayments(
      { user, storeId, saleId, customer, sessionId, receiptNo, depositAvailable },
      input.payments ?? [],
      q.total,
    );
    let pointsEarned = 0;
    if (customer && settings.loyalty.enabled) {
      pointsEarned = Math.floor(((q.total - pointsUsed) * settings.loyalty.earnPercent) / 100);
      if (pointsEarned > 0) run('UPDATE customers SET points = points + ? WHERE id = ?', pointsEarned, customer.id);
      run('UPDATE sales SET points_earned = ? WHERE id = ?', pointsEarned, saleId);
    }
    if (order) {
      run(
        "UPDATE customer_orders SET status = 'delivered', sale_id = ?, updated_at = datetime('now','localtime') WHERE id = ?",
        saleId, order.id,
      );
    }
    queueIntegrations(user, saleId, !!input.einvoice);
    audit(user, user.tenantId, 'sale.create', 'sale', saleId, { receiptNo, total: q.total });
    return getSale(user, saleId);
  });
}

export interface ReturnInput {
  storeId: number;
  originalSaleId: number;
  returnItems: { saleItemId: number; qty: number }[];
  newItems?: CartItemInput[];
  cartDiscount?: number;
  payments: PaymentInput[];
  reason?: string;
  salespersonId?: number | null;
}

/** İade ve değişim (örn. numara değişimi). Net tutar eksi ise müşteriye ödeme yapılır. */
export function returnSale(user: AuthUser, input: ReturnInput) {
  const storeId = assertStore(user, input.storeId);
  const settings = getSettings(user.tenantId);
  return tx(() => {
    const orig = one<{ id: number; status: string; customer_id: number | null; created_at: string; receipt_no: string; store_id: number }>(
      'SELECT id, status, customer_id, created_at, receipt_no, store_id FROM sales WHERE id = ? AND tenant_id = ?',
      input.originalSaleId, user.tenantId,
    );
    if (!orig) throw notFound('Satış bulunamadı');
    if (orig.status !== 'completed') throw badRequest('İptal edilmiş satışta iade yapılamaz');
    const ageDays = (Date.now() - new Date(orig.created_at.replace(' ', 'T')).getTime()) / 86400000;
    if (ageDays > settings.returns.daysLimit && !hasPerm(user, 'sales.cancel')) {
      throw forbidden(`İade süresi (${settings.returns.daysLimit} gün) geçmiş. Müdür onayı gerekir.`);
    }
    if (!input.returnItems?.length) throw badRequest('İade edilecek ürün seçilmedi');

    const sessionId = requireSession(user, storeId);
    const customer = loadCustomer(user.tenantId, orig.customer_id);
    const receiptNo = receiptNumber(user.tenantId, storeId);

    // İade satırları
    const retLines: { item: { id: number; variant_id: number; qty: number; unit_price: number; discount: number; line_total: number; vat_rate: number; unit_cost: number; returned_qty: number }; qty: number; refund: number; disc: number }[] = [];
    for (const ri of input.returnItems) {
      const item = one<{ id: number; variant_id: number; qty: number; unit_price: number; discount: number; line_total: number; vat_rate: number; unit_cost: number; returned_qty: number }>(
        'SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', ri.saleItemId, orig.id,
      );
      if (!item || item.qty <= 0) throw badRequest('İade satırı bu satışa ait değil');
      if (!Number.isInteger(ri.qty) || ri.qty <= 0) throw badRequest('İade adedi geçersiz');
      if (item.returned_qty + ri.qty > item.qty) throw badRequest(`Bu üründen en fazla ${item.qty - item.returned_qty} adet iade edilebilir`);
      const before = item.returned_qty;
      const refund = Math.round((item.line_total * (before + ri.qty)) / item.qty) - Math.round((item.line_total * before) / item.qty);
      const disc = Math.round((item.discount * (before + ri.qty)) / item.qty) - Math.round((item.discount * before) / item.qty);
      retLines.push({ item, qty: ri.qty, refund, disc });
    }
    const refundTotal = retLines.reduce((a, l) => a + l.refund, 0);

    // Değişimde verilen yeni ürünler
    const newQ = input.newItems?.length ? quote(user, { storeId, items: input.newItems, cartDiscount: input.cartDiscount }) : null;
    const newTotal = newQ?.total ?? 0;
    const total = newTotal - refundTotal;
    const type = newQ ? 'exchange' : 'return';
    const retGross = retLines.reduce((a, l) => a + l.item.unit_price * l.qty, 0);
    const retVat = retLines.reduce((a, l) => a + Math.round((l.refund * l.item.vat_rate) / (100 + l.item.vat_rate)), 0);
    const retCost = retLines.reduce((a, l) => a + l.item.unit_cost * l.qty, 0);
    const retQty = retLines.reduce((a, l) => a + l.qty, 0);
    const newCost = newQ ? newQ.lines.reduce((a, l) => a + l.unitCost * l.qty, 0) : 0;
    const newQty = newQ ? newQ.lines.reduce((a, l) => a + l.qty, 0) : 0;

    const r = run(
      `INSERT INTO sales (tenant_id, store_id, receipt_no, type, original_sale_id, customer_id, user_id, salesperson_id, register_session_id,
                          subtotal, discount_total, total, vat_total, cost_total, item_count, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      user.tenantId, storeId, receiptNo, type, orig.id, orig.customer_id, user.id,
      checkSalesperson(user.tenantId, input.salespersonId) ?? user.id, sessionId,
      (newQ?.subtotal ?? 0) - retGross, (newQ?.discountTotal ?? 0) - (retGross - refundTotal), total,
      (newQ?.vatTotal ?? 0) - retVat, newCost - retCost, newQty - retQty,
      input.reason ? 'İade nedeni: ' + input.reason : null,
    );
    const saleId = Number(r.lastInsertRowid);
    const db = getDb();
    const ins = db.prepare(
      `INSERT INTO sale_items (sale_id, variant_id, qty, unit_price, discount, line_total, vat_rate, unit_cost, original_item_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const l of retLines) {
      ins.run(saleId, l.item.variant_id, -l.qty, l.item.unit_price, -l.disc, -l.refund, l.item.vat_rate, l.item.unit_cost, l.item.id);
      db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(l.qty, l.item.id);
      changeStock({
        tenantId: user.tenantId, storeId, variantId: l.item.variant_id, qty: l.qty, type: 'return', userId: user.id,
        refType: 'sale', refId: saleId, unitCost: l.item.unit_cost, note: 'Fiş ' + orig.receipt_no,
      });
    }
    if (newQ) {
      insertItems(saleId, newQ);
      for (const l of newQ.lines) {
        changeStock({
          tenantId: user.tenantId, storeId, variantId: l.variantId, qty: -l.qty, type: 'sale', userId: user.id,
          refType: 'sale', refId: saleId, unitCost: l.unitCost, allowNegative: settings.pos.allowNegativeStock,
        });
      }
    }
    const { issuedGiftCards, pointsUsed } = total === 0
      ? { issuedGiftCards: [], pointsUsed: 0 }
      : applyPayments({ user, storeId, saleId, customer, sessionId, receiptNo, depositAvailable: 0 }, input.payments ?? [], total);
    if (total === 0 && input.payments?.some((p) => p.amount !== 0)) throw badRequest('Tutar sıfır; ödeme girilmemeli');

    if (customer && settings.loyalty.enabled) {
      const pts = Math.trunc(((total - pointsUsed) * settings.loyalty.earnPercent) / 100);
      if (pts !== 0) {
        run('UPDATE customers SET points = MAX(0, points + ?) WHERE id = ?', pts, customer.id);
        run('UPDATE sales SET points_earned = ? WHERE id = ?', pts, saleId);
      }
    }
    queueIntegrations(user, saleId, false);
    audit(user, user.tenantId, 'sale.' + type, 'sale', saleId, { receiptNo, original: orig.receipt_no, total });
    return { ...getSale(user, saleId), issuedGiftCards };
  });
}

/** Satışı iptal eder (kasa kapanmadan). Tüm etkiler geri alınır. */
export function cancelSale(user: AuthUser, saleId: number, reason: string) {
  return tx(() => {
    const s = one<{ id: number; store_id: number; status: string; customer_id: number | null; register_session_id: number | null; points_earned: number; created_at: string; einvoice_status: string | null; receipt_no: string }>(
      'SELECT * FROM sales WHERE id = ? AND tenant_id = ?', saleId, user.tenantId,
    );
    if (!s) throw notFound('Satış bulunamadı');
    assertStore(user, s.store_id);
    if (s.status !== 'completed') throw badRequest('Satış zaten iptal edilmiş');
    if (!reason?.trim()) throw badRequest('İptal nedeni yazılmalıdır');
    const hasReturns = one<{ n: number }>('SELECT COUNT(*) n FROM sales WHERE original_sale_id = ? AND status = ?', saleId, 'completed')!.n;
    if (hasReturns) throw badRequest('Bu satıştan iade yapılmış; önce iade işlemini iptal edin');
    if (s.register_session_id) {
      const sess = one<{ status: string }>('SELECT status FROM register_sessions WHERE id = ?', s.register_session_id);
      if (sess?.status !== 'open') throw badRequest('Kasası kapanmış satış iptal edilemez; iade işlemi yapın');
    } else if (s.created_at.slice(0, 10) !== today()) {
      throw badRequest('Sadece bugünkü satışlar iptal edilebilir; iade işlemi yapın');
    }
    const items = all<{ id: number; variant_id: number; qty: number; unit_cost: number; original_item_id: number | null }>(
      'SELECT * FROM sale_items WHERE sale_id = ?', saleId,
    );
    for (const it of items) {
      changeStock({
        tenantId: user.tenantId, storeId: s.store_id, variantId: it.variant_id, qty: it.qty, type: it.qty > 0 ? 'return' : 'sale',
        userId: user.id, refType: 'sale', refId: saleId, unitCost: it.unit_cost, note: 'İptal: ' + s.receipt_no,
      });
      if (it.original_item_id) run('UPDATE sale_items SET returned_qty = returned_qty - ? WHERE id = ?', -it.qty, it.original_item_id);
    }
    const pays = all<{ method: PayMethod; amount: number; ref: string | null }>('SELECT * FROM sale_payments WHERE sale_id = ?', saleId);
    let pointsBack = 0;
    for (const p of pays) {
      if (p.method === 'credit' && s.customer_id) {
        run(
          `INSERT INTO customer_ledger (tenant_id, customer_id, store_id, type, amount, ref_type, ref_id, note, user_id)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          user.tenantId, s.customer_id, s.store_id, 'adjust', -p.amount, 'sale', saleId, 'İptal: ' + s.receipt_no, user.id,
        );
      } else if (p.method === 'giftcard' && p.ref) {
        if (p.amount > 0) {
          run('UPDATE gift_cards SET balance = balance + ? WHERE tenant_id = ? AND code = ?', p.amount, user.tenantId, p.ref);
        } else {
          const g = one<{ id: number; balance: number; initial_amount: number }>('SELECT * FROM gift_cards WHERE tenant_id = ? AND code = ?', user.tenantId, p.ref);
          if (g && g.balance !== g.initial_amount) throw badRequest('İadede verilen hediye çeki kullanılmış; iptal edilemez');
          if (g) run('UPDATE gift_cards SET active = 0, balance = 0 WHERE id = ?', g.id);
        }
      } else if (p.method === 'points') {
        pointsBack += p.amount;
      }
    }
    if (s.customer_id) {
      const delta = pointsBack - s.points_earned;
      if (delta) run('UPDATE customers SET points = MAX(0, points + ?) WHERE id = ?', delta, s.customer_id);
    }
    run(
      "UPDATE sales SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = datetime('now','localtime') WHERE id = ?",
      reason.trim(), user.id, saleId,
    );
    run("UPDATE customer_orders SET status = 'arrived', sale_id = NULL WHERE sale_id = ?", saleId);
    if (s.einvoice_status === 'sent') enqueue(user.tenantId, 'einvoice', 'cancel_invoice', { saleId }, { type: 'sale', id: saleId });
    audit(user, user.tenantId, 'sale.cancel', 'sale', saleId, { receiptNo: s.receipt_no, reason });
    return getSale(user, saleId);
  });
}

export function getSale(user: AuthUser, saleId: number) {
  const s = one<Record<string, unknown> & { store_id: number; customer_id: number | null }>(
    `SELECT s.*, st.name AS store_name, st.code AS store_code, st.address AS store_address, st.phone AS store_phone,
            u.name AS user_name, sp.name AS salesperson_name, c.name AS customer_name, c.phone AS customer_phone,
            o.receipt_no AS original_receipt_no
       FROM sales s
       JOIN stores st ON st.id = s.store_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users sp ON sp.id = s.salesperson_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN sales o ON o.id = s.original_sale_id
      WHERE s.id = ? AND s.tenant_id = ?`,
    saleId, user.tenantId,
  );
  if (!s) throw notFound('Satış bulunamadı');
  if (!user.storeIds.includes(s.store_id)) throw forbidden('Bu mağazanın satışını görme yetkiniz yok');
  const items = all(
    `SELECT si.*, v.color, v.size, v.barcode, p.code, p.name, p.id AS product_id, b.name AS brand
       FROM sale_items si JOIN variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE si.sale_id = ? ORDER BY si.id`,
    saleId,
  );
  const payments = all('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY id', saleId);
  const returns = all("SELECT id, receipt_no, type, total, created_at, status FROM sales WHERE original_sale_id = ? ORDER BY id", saleId);
  const canSeeCost = hasPerm(user, 'costs.view');
  if (!canSeeCost) {
    delete s.cost_total;
    for (const it of items as Record<string, unknown>[]) delete it.unit_cost;
  }
  return { ...s, items, payments, returns };
}

export interface SaleListFilter {
  storeIds: number[];
  from: string;
  toExclusive: string;
  q?: string;
  customerId?: number;
  userId?: number;
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listSales(tenantId: number, f: SaleListFilter) {
  const where = ['s.tenant_id = ?', `s.store_id IN (${f.storeIds.join(',')})`, 's.created_at >= ?', 's.created_at < ?'];
  const params: unknown[] = [tenantId, f.from, f.toExclusive];
  if (f.q) {
    where.push(`(s.receipt_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR s.id IN (
      SELECT si.sale_id FROM sale_items si JOIN variants v ON v.id = si.variant_id WHERE v.barcode = ?))`);
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, f.q);
  }
  if (f.customerId) {
    where.push('s.customer_id = ?');
    params.push(f.customerId);
  }
  if (f.userId) {
    where.push('s.salesperson_id = ?');
    params.push(f.userId);
  }
  if (f.type) {
    where.push('s.type = ?');
    params.push(f.type);
  }
  if (f.status) {
    where.push('s.status = ?');
    params.push(f.status);
  }
  const sql = `FROM sales s JOIN stores st ON st.id = s.store_id LEFT JOIN customers c ON c.id = s.customer_id
               LEFT JOIN users sp ON sp.id = s.salesperson_id WHERE ${where.join(' AND ')}`;
  const rows = all(
    `SELECT s.id, s.receipt_no, s.type, s.status, s.total, s.discount_total, s.item_count, s.created_at, s.einvoice_status,
            st.name AS store_name, c.name AS customer_name, sp.name AS salesperson_name,
            (SELECT GROUP_CONCAT(DISTINCT method) FROM sale_payments WHERE sale_id = s.id) AS methods
     ${sql} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    ...params, Math.min(f.limit ?? 100, 1000), f.offset ?? 0,
  );
  const totals = one<{ n: number; total: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN s.status='completed' THEN s.total END),0) total ${sql}`,
    ...params,
  );
  return { rows, totals };
}

export type { PriceResult };
