import { describe, it, expect } from 'vitest';
import { priceCart, type CampaignRow, type PriceLineInput } from '../src/services/pricing.js';
import { allocate, vatFromGross } from '../src/utils/money.js';
import { ean13CheckDigit, internalEan13, isValidEan13 } from '../src/utils/barcode.js';

const line = (p: Partial<PriceLineInput> = {}): PriceLineInput => ({ variantId: 1, qty: 1, unitPrice: 100000, vatRate: 10, productId: 1, categoryId: 1, brandId: 1, season: '2026-YAZ', ...p });
const camp = (p: Partial<CampaignRow>): CampaignRow => ({ id: 1, name: 'K', type: 'percent', value: 10, min_qty: 1, scope: 'all', scope_value: null, store_ids: null, priority: 0, ...p });

describe('fiyatlama motoru', () => {
  it('kampanyasız sepet toplamları tutar', () => {
    const r = priceCart([line({ qty: 2 }), line({ variantId: 2, unitPrice: 59900 })], []);
    expect(r.subtotal).toBe(259900);
    expect(r.total).toBe(259900);
    expect(r.vatTotal).toBe(r.lines.reduce((a, l) => a + l.vat, 0));
    expect(vatFromGross(110000, 10)).toBe(10000);
  });
  it('yüzde kampanya uygular', () => {
    const r = priceCart([line({ qty: 2 })], [camp({ type: 'percent', value: 20 })]);
    expect(r.campaignDiscount).toBe(40000);
    expect(r.total).toBe(160000);
    expect(r.lines[0].campaignName).toBe('K');
  });
  it('2. çifte %50: en ucuza uygulanır', () => {
    const r = priceCart([line({ unitPrice: 100000 }), line({ variantId: 2, unitPrice: 60000 })], [camp({ type: 'nth_percent', value: 50, min_qty: 2 })]);
    expect(r.campaignDiscount).toBe(30000);
    expect(r.total).toBe(130000);
  });
  it('3 al 2 öde: en ucuz bedava, tek ürünlerde uygulanmaz', () => {
    const r = priceCart([line({ unitPrice: 100000 }), line({ variantId: 2, unitPrice: 80000 }), line({ variantId: 3, unitPrice: 50000 })], [camp({ type: 'buy_x_pay_y', value: 2, min_qty: 3 })]);
    expect(r.campaignDiscount).toBe(50000);
    const r2 = priceCart([line()], [camp({ type: 'buy_x_pay_y', value: 2, min_qty: 3 })]);
    expect(r2.campaignDiscount).toBe(0);
  });
  it('kapsam dışı ürüne kampanya uygulanmaz ve en iyi kampanya seçilir', () => {
    const r = priceCart(
      [line({ categoryId: 5 })],
      [camp({ id: 1, type: 'percent', value: 50, scope: 'category', scope_value: '9' }), camp({ id: 2, type: 'percent', value: 10 }), camp({ id: 3, type: 'amount', value: 25000 })],
    );
    expect(r.campaignDiscount).toBe(25000);
    expect(r.campaigns[0].id).toBe(3);
  });
  it('sepet indirimi kuruş kaybı olmadan dağıtılır', () => {
    const r = priceCart([line({ unitPrice: 33333 }), line({ variantId: 2, unitPrice: 33333 }), line({ variantId: 3, unitPrice: 33334 })], [], 10000);
    expect(r.lines.reduce((a, l) => a + l.cartDiscount, 0)).toBe(10000);
    expect(r.total).toBe(90000);
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(100);
  });
  it('satır indirimi brütü aşamaz', () => {
    const r = priceCart([line({ manualDiscount: 999999 })], []);
    expect(r.total).toBe(0);
  });
});

describe('barkod', () => {
  it('EAN-13 kontrol hanesi', () => {
    expect(ean13CheckDigit('869000000000')).toBe(5);
    expect(isValidEan13('8690000000005')).toBe(true);
    expect(isValidEan13('8690000000004')).toBe(false);
    expect(isValidEan13(internalEan13(7, 42))).toBe(true);
    expect(internalEan13(7, 42).startsWith('2007')).toBe(true);
  });
});
