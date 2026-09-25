import { all } from '../db/index.js';
import { allocate, vatFromGross } from '../utils/money.js';
import { today } from '../utils/dates.js';

export interface PriceLineInput {
  variantId: number;
  qty: number;
  unitPrice: number; // KDV dahil liste fiyatı
  vatRate: number;
  productId: number;
  categoryId: number | null;
  brandId: number | null;
  season: string | null;
  manualDiscount?: number; // satıra elle verilen indirim (kuruş)
}

export interface CampaignRow {
  id: number;
  name: string;
  type: 'percent' | 'amount' | 'buy_x_pay_y' | 'nth_percent';
  value: number;
  min_qty: number;
  scope: 'all' | 'category' | 'brand' | 'product' | 'season';
  scope_value: string | null;
  store_ids: string | null;
  priority: number;
}

export interface PricedLine extends PriceLineInput {
  gross: number;
  campaignDiscount: number;
  campaignId: number | null;
  campaignName: string | null;
  manualDiscount: number;
  cartDiscount: number;
  discount: number;
  lineTotal: number;
  vat: number;
}

export interface PriceResult {
  lines: PricedLine[];
  subtotal: number;
  campaignDiscount: number;
  manualDiscount: number;
  discountTotal: number;
  total: number;
  vatTotal: number;
  campaigns: { id: number; name: string; discount: number }[];
}

export function activeCampaigns(tenantId: number, storeId: number, date = today()): CampaignRow[] {
  const rows = all<CampaignRow>(
    `SELECT * FROM campaigns WHERE tenant_id = ? AND active = 1
       AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)
     ORDER BY priority DESC, id`,
    tenantId, date, date,
  );
  return rows.filter((c) => {
    if (!c.store_ids) return true;
    try {
      const ids = JSON.parse(c.store_ids) as number[];
      return !ids.length || ids.includes(storeId);
    } catch {
      return true;
    }
  });
}

function eligible(c: CampaignRow, l: PriceLineInput): boolean {
  switch (c.scope) {
    case 'all':
      return true;
    case 'category':
      return String(l.categoryId) === c.scope_value;
    case 'brand':
      return String(l.brandId) === c.scope_value;
    case 'product':
      return (c.scope_value ?? '').split(',').map((s) => s.trim()).includes(String(l.productId));
    case 'season':
      return !!l.season && l.season === c.scope_value;
  }
}

interface Unit {
  line: number;
  price: number;
  taken: boolean;
}

/** Kampanyanın kalan birimlere uygulanması: hangi birime ne kadar indirim düştüğünü döner. */
function evaluate(c: CampaignRow, units: Unit[], lines: PriceLineInput[]): { consumed: number[]; discounts: Map<number, number> } {
  const idx = units.map((u, i) => i).filter((i) => !units[i].taken && eligible(c, lines[units[i].line]));
  const discounts = new Map<number, number>();
  const consumed: number[] = [];
  if (!idx.length) return { consumed, discounts };
  if (c.type === 'percent' || c.type === 'amount') {
    if (idx.length < Math.max(1, c.min_qty)) return { consumed, discounts };
    for (const i of idx) {
      const d = c.type === 'percent' ? Math.round((units[i].price * Math.min(c.value, 100)) / 100) : Math.min(c.value, units[i].price);
      discounts.set(i, d);
      consumed.push(i);
    }
    return { consumed, discounts };
  }
  // Grup kampanyaları: pahalıdan ucuza sırala, gruplar halinde uygula
  const n = Math.max(2, c.min_qty);
  const sorted = [...idx].sort((a, b) => units[b].price - units[a].price);
  const groups = Math.floor(sorted.length / n);
  for (let g = 0; g < groups; g++) {
    const grp = sorted.slice(g * n, g * n + n);
    grp.forEach((i) => consumed.push(i));
    if (c.type === 'buy_x_pay_y') {
      const free = Math.max(0, n - Math.max(0, Math.min(c.value, n)));
      grp.slice(n - free).forEach((i) => discounts.set(i, units[i].price));
    } else {
      const cheapest = grp[grp.length - 1];
      discounts.set(cheapest, Math.round((units[cheapest].price * Math.min(c.value, 100)) / 100));
    }
  }
  return { consumed, discounts };
}

/**
 * Sepet fiyatlama motoru: otomatik kampanyalar (her birime en fazla bir kampanya, müşteri lehine en iyi kombinasyon açgözlü seçilir),
 * satır indirimi ve sepet indirimi. Sonuç kuruş hassasiyetinde ve toplamlar birbirini tutar.
 */
export function priceCart(lines: PriceLineInput[], campaigns: CampaignRow[], cartDiscount = 0): PriceResult {
  const units: Unit[] = [];
  lines.forEach((l, li) => {
    for (let k = 0; k < l.qty; k++) units.push({ line: li, price: l.unitPrice, taken: false });
  });
  const unitDiscount = new Array(units.length).fill(0);
  const unitCampaign: (CampaignRow | null)[] = new Array(units.length).fill(null);
  const remaining = [...campaigns];
  // Açgözlü seçim: her turda en çok indirim sağlayan kampanyayı uygula
  while (remaining.length) {
    let best: { c: CampaignRow; k: number; r: ReturnType<typeof evaluate>; total: number } | null = null;
    remaining.forEach((c, k) => {
      const r = evaluate(c, units, lines);
      const total = [...r.discounts.values()].reduce((a, b) => a + b, 0);
      if (total > 0 && (!best || total > best.total || (total === best.total && c.priority > best.c.priority))) best = { c, k, r, total };
    });
    if (!best) break;
    const b = best as { c: CampaignRow; k: number; r: ReturnType<typeof evaluate>; total: number };
    for (const i of b.r.consumed) {
      units[i].taken = true;
      unitCampaign[i] = b.c;
      unitDiscount[i] = b.r.discounts.get(i) ?? 0;
    }
    remaining.splice(b.k, 1);
  }

  const campaignTotals = new Map<number, { id: number; name: string; discount: number }>();
  const priced: PricedLine[] = lines.map((l, li) => {
    const gross = l.unitPrice * l.qty;
    let campaignDiscount = 0;
    let campaign: CampaignRow | null = null;
    units.forEach((u, i) => {
      if (u.line !== li) return;
      campaignDiscount += unitDiscount[i];
      if (unitCampaign[i] && unitDiscount[i] > 0) campaign = campaign ?? unitCampaign[i];
    });
    units.forEach((u, i) => {
      if (u.line !== li || !unitCampaign[i] || !unitDiscount[i]) return;
      const c = unitCampaign[i]!;
      const t = campaignTotals.get(c.id) ?? { id: c.id, name: c.name, discount: 0 };
      t.discount += unitDiscount[i];
      campaignTotals.set(c.id, t);
    });
    const manual = Math.max(0, Math.min(Math.round(l.manualDiscount ?? 0), gross - campaignDiscount));
    const c = campaign as CampaignRow | null;
    return {
      ...l,
      gross,
      campaignDiscount,
      campaignId: c?.id ?? null,
      campaignName: c?.name ?? null,
      manualDiscount: manual,
      cartDiscount: 0,
      discount: 0,
      lineTotal: 0,
      vat: 0,
    };
  });

  const netBeforeCart = priced.map((p) => p.gross - p.campaignDiscount - p.manualDiscount);
  const maxCart = netBeforeCart.reduce((a, b) => a + b, 0);
  const cart = Math.max(0, Math.min(Math.round(cartDiscount), maxCart));
  const shares = allocate(cart, netBeforeCart);
  priced.forEach((p, i) => {
    p.cartDiscount = shares[i];
    p.discount = p.campaignDiscount + p.manualDiscount + p.cartDiscount;
    p.lineTotal = p.gross - p.discount;
    p.vat = vatFromGross(p.lineTotal, p.vatRate);
  });

  const subtotal = priced.reduce((a, p) => a + p.gross, 0);
  const campaignDiscount = priced.reduce((a, p) => a + p.campaignDiscount, 0);
  const discountTotal = priced.reduce((a, p) => a + p.discount, 0);
  return {
    lines: priced,
    subtotal,
    campaignDiscount,
    manualDiscount: discountTotal - campaignDiscount,
    discountTotal,
    total: subtotal - discountTotal,
    vatTotal: priced.reduce((a, p) => a + p.vat, 0),
    campaigns: [...campaignTotals.values()],
  };
}
