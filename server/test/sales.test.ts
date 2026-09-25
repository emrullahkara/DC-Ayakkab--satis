import { describe, it, expect, beforeEach } from 'vitest';
import { fixture, type Fixture } from './setup.js';
import { cancelSale, createSale, quote, returnSale } from '../src/services/sales.js';
import { closeRegister, openRegister, recordCash } from '../src/services/register.js';
import { stockQty } from '../src/services/stock.js';
import { customerBalance, collectPayment } from '../src/services/customers.js';
import { one, run } from '../src/db/index.js';
import { createTransfer, receiveTransfer, createCount, countScan, applyCount, adjustStock } from '../src/services/inventory.js';
import { quickReceive, supplierBalance } from '../src/services/purchasing.js';
import { saveProduct, importProducts, bulkPrice } from '../src/services/products.js';
import { saveSettings } from '../src/services/settings.js';

let f: Fixture;
beforeEach(() => {
  f = fixture();
  openRegister(f.owner, f.storeA, 10000);
});

describe('satış', () => {
  it('stok düşer, fiş numarası artar, puan kazanılır', () => {
    const s = createSale(f.owner, { storeId: f.storeA, customerId: f.customer, items: [{ variantId: f.v38, qty: 2 }], payments: [{ method: 'cash', amount: 200000 }] }) as any;
    expect(s.receipt_no).toBe('A-000001');
    expect(s.total).toBe(200000);
    expect(stockQty(f.storeA, f.v38)).toBe(3);
    expect(s.points_earned).toBe(4000);
    const s2 = createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'card', amount: 100000, installments: 3 }] }) as any;
    expect(s2.receipt_no).toBe('A-000002');
    expect(s2.payments[0].installments).toBe(3);
  });
  it('yetersiz stokta satış yapılmaz, ayar açıksa eksiye düşer', () => {
    expect(() => createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v39, qty: 3 }], payments: [{ method: 'cash', amount: 300000 }] })).toThrow(/Yetersiz stok/);
    saveSettings(f.tenantId, { pos: { allowNegativeStock: true } });
    createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v39, qty: 3 }], payments: [{ method: 'cash', amount: 300000 }] });
    expect(stockQty(f.storeA, f.v39)).toBe(-1);
  });
  it('ödeme toplamı tutmazsa reddedilir', () => {
    expect(() => createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'cash', amount: 90000 }] })).toThrow(/eşit değil/);
  });
  it('kasa kapalıyken satış yapılmaz', () => {
    closeRegister(f.owner, f.storeA, 10000);
    expect(() => createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] })).toThrow(/Kasa açık değil/);
  });
  it('kasiyer başka mağazada satış yapamaz, indirim sınırı uygulanır', () => {
    expect(() => quote(f.cashier, { storeId: f.storeB, items: [{ variantId: f.v38, qty: 1 }] })).toThrow(/erişim/);
    expect(() => quote(f.cashier, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1, discount: 20000 }] })).toThrow(/En fazla %10/);
    expect(quote(f.cashier, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1, discount: 10000 }] }).total).toBe(90000);
    expect(quote(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1, discount: 50000 }] }).total).toBe(50000);
  });
  it('veresiye limiti kontrol edilir ve tahsilat borcu düşer', () => {
    createSale(f.owner, { storeId: f.storeA, customerId: f.customer, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'credit', amount: 100000 }] });
    expect(customerBalance(f.customer)).toBe(100000);
    expect(() => createSale(f.owner, { storeId: f.storeA, customerId: f.customer, items: [{ variantId: f.v38, qty: 2 }], payments: [{ method: 'credit', amount: 200000 }] })).toThrow(/limiti aşılıyor/);
    collectPayment(f.owner, f.customer, { storeId: f.storeA, amount: 60000, method: 'cash' });
    expect(customerBalance(f.customer)).toBe(40000);
  });
  it('iade stoğu geri alır ve fazla iade engellenir; değişim fark tutarı hesaplar', () => {
    const s = createSale(f.owner, { storeId: f.storeA, customerId: f.customer, items: [{ variantId: f.v38, qty: 2 }], payments: [{ method: 'cash', amount: 200000 }] }) as any;
    const r = returnSale(f.owner, { storeId: f.storeA, originalSaleId: s.id, returnItems: [{ saleItemId: s.items[0].id, qty: 1 }], payments: [{ method: 'cash', amount: -100000 }] }) as any;
    expect(r.total).toBe(-100000);
    expect(r.type).toBe('return');
    expect(stockQty(f.storeA, f.v38)).toBe(4);
    // Değişim: kalan 1 çifti 39 numara ile değiştir (aynı fiyat → 0 fark)
    const x = returnSale(f.owner, { storeId: f.storeA, originalSaleId: s.id, returnItems: [{ saleItemId: s.items[0].id, qty: 1 }], newItems: [{ variantId: f.v39, qty: 1 }], payments: [] }) as any;
    expect(x.type).toBe('exchange');
    expect(x.total).toBe(0);
    expect(stockQty(f.storeA, f.v38)).toBe(5);
    expect(stockQty(f.storeA, f.v39)).toBe(1);
    expect(() => returnSale(f.owner, { storeId: f.storeA, originalSaleId: s.id, returnItems: [{ saleItemId: s.items[0].id, qty: 1 }], payments: [{ method: 'cash', amount: -100000 }] })).toThrow(/en fazla 0 adet/);
    const pts = one<{ points: number }>('SELECT points FROM customers WHERE id = ?', f.customer)!.points;
    expect(pts).toBe(2000); // 4000 kazanıldı, iadede 2000 geri alındı
  });
  it('iade hediye çeki olarak verilebilir ve çekle ödeme yapılır', () => {
    const s = createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] }) as any;
    const r = returnSale(f.owner, { storeId: f.storeA, originalSaleId: s.id, returnItems: [{ saleItemId: s.items[0].id, qty: 1 }], payments: [{ method: 'giftcard', amount: -100000 }] });
    expect(r.issuedGiftCards).toHaveLength(1);
    const code = r.issuedGiftCards[0];
    const s2 = createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'giftcard', amount: 70000, ref: code }, { method: 'cash', amount: 30000 }] }) as any;
    expect(s2.total).toBe(100000);
    expect(one<{ balance: number }>('SELECT balance FROM gift_cards WHERE code = ?', code)!.balance).toBe(30000);
    expect(() => createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'giftcard', amount: 100000, ref: code }] })).toThrow(/yetersiz/);
  });
  it('iptal her şeyi geri alır; kapanmış kasada iptal edilemez', () => {
    const s = createSale(f.owner, { storeId: f.storeA, customerId: f.customer, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'credit', amount: 100000 }] }) as any;
    expect(() => cancelSale(f.owner, s.id, '')).toThrow(/neden/);
    cancelSale(f.owner, s.id, 'yanlış');
    expect(stockQty(f.storeA, f.v38)).toBe(5);
    expect(customerBalance(f.customer)).toBe(0);
    expect(one<{ points: number }>('SELECT points FROM customers WHERE id = ?', f.customer)!.points).toBe(0);
    const s2 = createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] }) as any;
    closeRegister(f.owner, f.storeA, 110000);
    expect(() => cancelSale(f.owner, s2.id, 'x')).toThrow(/kapanmış/);
  });
});

describe('kasa', () => {
  it('gün sonu beklenen nakit ve fark doğru hesaplanır', () => {
    createSale(f.owner, { storeId: f.storeA, items: [{ variantId: f.v38, qty: 1 }], payments: [{ method: 'cash', amount: 60000 }, { method: 'card', amount: 40000 }] });
    recordCash(f.owner, { storeId: f.storeA, type: 'expense', amount: 5000, category: 'Çay' });
    recordCash(f.owner, { storeId: f.storeA, type: 'deposit', amount: 20000 });
    const r = closeRegister(f.owner, f.storeA, 44000) as any;
    expect(r.expected_cash).toBe(10000 + 60000 - 5000 - 20000);
    expect(r.difference).toBe(-1000);
    expect(() => openRegister(f.owner, f.storeA, 0)).not.toThrow();
    expect(() => openRegister(f.owner, f.storeA, 0)).toThrow(/zaten açık/);
  });
});

describe('stok işlemleri', () => {
  it('transfer gönder / teslim al; eksik teslim', () => {
    const t = createTransfer(f.owner, { fromStoreId: f.storeA, toStoreId: f.storeB, items: [{ variantId: f.v38, qty: 3 }] }) as any;
    expect(stockQty(f.storeA, f.v38)).toBe(2);
    expect(stockQty(f.storeB, f.v38)).toBe(3);
    receiveTransfer(f.owner, t.id, [{ variantId: f.v38, qty: 2 }]);
    expect(stockQty(f.storeB, f.v38)).toBe(5);
    expect(one<{ note: string }>('SELECT note FROM transfers WHERE id = ?', t.id)!.note).toMatch(/Eksik teslim: 1/);
    expect(() => createTransfer(f.owner, { fromStoreId: f.storeA, toStoreId: f.storeB, items: [{ variantId: f.v38, qty: 99 }] })).toThrow(/Yetersiz/);
  });
  it('sayım farkları stoğa işlenir', () => {
    const c = createCount(f.owner, { storeId: f.storeA, scope: 'full' }) as any;
    countScan(f.owner, c.id, { variantId: f.v38, qty: 4, mode: 'set' });
    const applied = applyCount(f.owner, c.id) as any;
    expect(applied.result).toEqual({ lines: 2, plus: 0, minus: 3, value: -150000 }); // 38: 5→4, 39: 2→0 (tam sayım)
    expect(stockQty(f.storeA, f.v38)).toBe(4);
    expect(stockQty(f.storeA, f.v39)).toBe(0);
  });
  it('fire ve mal kabul; tedarikçi carisi KDV dahil yazılır', () => {
    adjustStock(f.owner, { storeId: f.storeA, type: 'damage', note: 'defolu', items: [{ variantId: f.v38, qty: 1 }] });
    expect(stockQty(f.storeA, f.v38)).toBe(4);
    const sid = Number(run("INSERT INTO suppliers (tenant_id, name, payment_term_days) VALUES (?, 'Ted', 30)", f.tenantId).lastInsertRowid);
    quickReceive(f.owner, { supplierId: sid, storeId: f.storeA, items: [{ variantId: f.v38, qty: 10, unitCost: 55000 }], invoiceNo: 'F1' });
    expect(stockQty(f.storeA, f.v38)).toBe(14);
    expect(supplierBalance(sid)).toBe(605000);
    expect(one<{ cost_price: number }>('SELECT cost_price FROM products WHERE id = ?', f.product)!.cost_price).toBe(55000);
  });
});

describe('ürünler', () => {
  it('renk x numara varyantları ve benzersiz barkod', () => {
    const p = saveProduct(f.owner, { code: 'M2', name: 'Model 2', sale_price: 50000, colors: ['Siyah', 'Bej'], sizes: ['36', '37', '38'] }) as any;
    expect(p.variants).toHaveLength(6);
    expect(new Set(p.variants.map((v: any) => v.barcode)).size).toBe(6);
    expect(() => saveProduct(f.owner, { code: 'M2', name: 'x' })).toThrow(/zaten kayıtlı/);
    expect(() => saveProduct(f.owner, { code: 'M3', name: 'x', variants: [{ color: 'A', size: '1', barcode: p.variants[0].barcode }] })).toThrow(/başka bir üründe/);
  });
  it('toplu aktarım hatalıysa hiçbir şey yazılmaz', () => {
    const r = importProducts(f.owner, [{ code: 'X1', name: 'X', color: 'Siyah', size: '40', qty: 3, price: 100 }, { code: 'X2', name: '', color: 'Siyah', size: '40' }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].row).toBe(3);
    expect(one('SELECT 1 FROM products WHERE code = ?', 'X1')).toBeUndefined();
    const ok = importProducts(f.owner, [{ code: 'X1', name: 'X', color: 'Siyah', size: '40', qty: 3, price: 100, store: 'A' }]);
    expect(ok.applied).toBe(true);
  });
  it('toplu fiyat yuvarlama', () => {
    const c = bulkPrice(f.owner, { productIds: [f.product], mode: 'percent', value: 15, round: '90' });
    expect(c[0].new).toBe(115990); // 1150,00 → bir üst x9,90
    expect(one<{ sale_price: number }>('SELECT sale_price FROM products WHERE id = ?', f.product)!.sale_price).toBe(115990);
  });
});
