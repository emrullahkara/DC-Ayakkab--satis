/**
 * Demo verisi: "demo" firması, 3 mağaza + depo, ürünler, müşteriler ve son 60 günün satışları.
 * Sunum ve deneme için kullanılır (DEMO_DATA=1). Var olan demo firması varsa tekrar oluşturmaz.
 */
import { one, run, tx } from './index.js';
import { hashPassword, loadUser } from '../auth.js';
import { ensureBrand, ensureCategory, newBarcode } from '../services/products.js';
import { changeStock } from '../services/stock.js';
import { addDays, today } from '../utils/dates.js';
import { createSale, quote } from '../services/sales.js';
import { openRegister, closeRegister, recordCash } from '../services/register.js';

// Belirli bir tohumla tekrarlanabilir rastgele sayı
let seed = 20260101;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const MODELS = [
  ['Kadın', 'Topuklu Stiletto', 'Derimod', 'Kadın Topuklu', 'kadin', ['Siyah', 'Bej', 'Kırmızı'], 189900, 95000],
  ['Kadın', 'Klasik Babet', 'Hotiç', 'Kadın Babet', 'kadin', ['Siyah', 'Taba', 'Pudra'], 129900, 62000],
  ['Kadın', 'Günlük Sneaker', 'Skechers', 'Kadın Spor', 'kadin', ['Beyaz', 'Gri'], 249900, 140000],
  ['Kadın', 'Kışlık Bot', 'İnci', 'Kadın Bot', 'kadin', ['Siyah', 'Kahve'], 299900, 165000],
  ['Kadın', 'Yazlık Sandalet', 'Flo', 'Kadın Sandalet', 'kadin', ['Beyaz', 'Siyah', 'Camel'], 89900, 42000],
  ['Erkek', 'Deri Klasik Ayakkabı', 'Kemal Tanca', 'Erkek Klasik', 'erkek', ['Siyah', 'Taba'], 349900, 190000],
  ['Erkek', 'Casual Loafer', 'Greyder', 'Erkek Günlük', 'erkek', ['Lacivert', 'Kahve'], 219900, 118000],
  ['Erkek', 'Koşu Ayakkabısı', 'Nike', 'Erkek Spor', 'erkek', ['Siyah', 'Beyaz'], 399900, 260000],
  ['Erkek', 'Trekking Bot', 'Lumberjack', 'Erkek Bot', 'erkek', ['Haki', 'Siyah'], 179900, 98000],
  ['Erkek', 'Deri Terlik', 'Polaris', 'Erkek Terlik', 'erkek', ['Siyah', 'Kahve'], 59900, 28000],
  ['Çocuk', 'Işıklı Spor', 'Vicco', 'Çocuk Spor', 'cocuk', ['Mavi', 'Pembe'], 79900, 38000],
  ['Çocuk', 'Okul Ayakkabısı', 'Polaris', 'Çocuk Klasik', 'cocuk', ['Siyah'], 69900, 33000],
] as const;

const SIZES: Record<string, string[]> = {
  kadin: ['36', '37', '38', '39', '40'],
  erkek: ['40', '41', '42', '43', '44'],
  cocuk: ['28', '29', '30', '31', '32'],
};

const FIRST = ['Ayşe', 'Fatma', 'Mehmet', 'Ali', 'Zeynep', 'Mustafa', 'Elif', 'Ahmet', 'Hatice', 'Hüseyin', 'Emine', 'İbrahim', 'Merve', 'Yusuf', 'Selin', 'Burak', 'Derya', 'Emre', 'Gül', 'Kemal'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç'];

export function seedDemo() {
  if (one("SELECT 1 FROM tenants WHERE code = 'demo'")) return;
  console.log('Demo verisi oluşturuluyor...');
  tx(() => {
    const t = Number(
      run("INSERT INTO tenants (code, name, tax_no, tax_office, address, phone, plan, max_stores, settings) VALUES ('demo', 'Demo Ayakkabı Ltd. Şti.', '1234567890', 'Kızılbey', 'Kızılay, Çankaya / Ankara', '0312 000 00 00', 'pro', 10, ?)",
        JSON.stringify({ receipt: { header: 'DEMO AYAKKABI\nKızılay / Ankara\nTel: 0312 000 00 00' } })).lastInsertRowid,
    );
    const stores = [
      ['KZL', 'Kızılay Mağaza', 0], ['CNK', 'Çankaya AVM', 0], ['KEC', 'Keçiören Mağaza', 0], ['DEP', 'Merkez Depo', 1],
    ].map(([code, name, wh]) => Number(run('INSERT INTO stores (tenant_id, code, name, city, is_warehouse) VALUES (?,?,?,?,?)', t, code, name, 'Ankara', wh).lastInsertRowid));
    run("INSERT INTO size_series (tenant_id, name, sizes, assortment) VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?)",
      t, 'Kadın', JSON.stringify(['35', '36', '37', '38', '39', '40', '41']), JSON.stringify([1, 2, 3, 3, 2, 1, 0]),
      t, 'Erkek', JSON.stringify(['39', '40', '41', '42', '43', '44', '45']), JSON.stringify([1, 2, 3, 3, 2, 1, 0]),
      t, 'Çocuk', JSON.stringify(['26', '27', '28', '29', '30', '31', '32', '33', '34', '35']), null);
    const pw = hashPassword('demo123');
    const owner = Number(run("INSERT INTO users (tenant_id, username, name, phone, role, password_hash, all_stores) VALUES (?, 'patron', 'Demir Can', '5320000001', 'owner', ?, 1)", t, pw).lastInsertRowid);
    const mgr = Number(run("INSERT INTO users (tenant_id, username, name, role, password_hash, commission_rate) VALUES (?, 'mudur', 'Selin Aydın', 'manager', ?, 100)", t, pw).lastInsertRowid);
    const c1 = Number(run("INSERT INTO users (tenant_id, username, name, role, password_hash, commission_rate) VALUES (?, 'kasiyer1', 'Ahmet Yılmaz', 'cashier', ?, 200)", t, pw).lastInsertRowid);
    const c2 = Number(run("INSERT INTO users (tenant_id, username, name, role, password_hash, commission_rate) VALUES (?, 'kasiyer2', 'Zeynep Kaya', 'cashier', ?, 200)", t, pw).lastInsertRowid);
    const c3 = Number(run("INSERT INTO users (tenant_id, username, name, role, password_hash, commission_rate) VALUES (?, 'kasiyer3', 'Mehmet Demir', 'cashier', ?, 150)", t, pw).lastInsertRowid);
    const depo = Number(run("INSERT INTO users (tenant_id, username, name, role, password_hash) VALUES (?, 'depo', 'Hüseyin Çelik', 'warehouse', ?)", t, pw).lastInsertRowid);
    for (const [u, s] of [[mgr, stores[0]], [mgr, stores[1]], [c1, stores[0]], [c2, stores[1]], [c3, stores[2]], [depo, stores[3]]]) run('INSERT INTO user_stores VALUES (?,?)', u, s);

    const suppliers = [
      ['Anadolu Deri San. Tic.', 'Konya', 30], ['Ege Ayakkabı Toptan', 'İzmir', 45], ['Marmara Spor Dağıtım', 'İstanbul', 60],
    ].map(([n, city, term]) => Number(run('INSERT INTO suppliers (tenant_id, name, address, payment_term_days, phone) VALUES (?,?,?,?,?)', t, n, city, term, '0' + between(2120000000, 2129999999)).lastInsertRowid));

    // Ürünler
    const variants: { id: number; price: number; gender: string; pid: number }[] = [];
    MODELS.forEach((m, i) => {
      const [, name, brand, cat, gender, colors, price, cost] = m;
      const pid = Number(
        run(
          'INSERT INTO products (tenant_id, code, name, brand_id, category_id, supplier_id, gender, season, material, cost_price, sale_price, vat_rate, min_stock) VALUES (?,?,?,?,?,?,?,?,?,?,?,10,1)',
          t, `${gender.slice(0, 1).toUpperCase()}${String(1001 + i)}`, name, ensureBrand(t, brand), ensureCategory(t, cat), pick(suppliers), gender,
          i % 3 === 0 ? '2026-KIŞ' : '2026-YAZ', pick(['Hakiki deri', 'Suni deri', 'Tekstil', 'Süet']), cost, price,
        ).lastInsertRowid,
      );
      for (const color of colors) for (const size of SIZES[gender]) {
        const vid = Number(run('INSERT INTO variants (tenant_id, product_id, color, size, barcode) VALUES (?,?,?,?,?)', t, pid, color, size, newBarcode(t)).lastInsertRowid);
        variants.push({ id: vid, price, gender, pid });
        for (const s of stores) {
          const qty = s === stores[3] ? between(3, 12) : between(0, 4);
          if (qty) changeStock({ tenantId: t, storeId: s, variantId: vid, qty, type: 'opening', unitCost: cost, note: 'Demo açılış stoğu' });
        }
      }
    });

    // Müşteriler
    const customers: number[] = [];
    for (let i = 0; i < 60; i++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const gender = FIRST.indexOf(name.split(' ')[0]) % 2 === 0 ? 'kadin' : 'erkek';
      customers.push(Number(
        run(
          'INSERT INTO customers (tenant_id, name, phone, gender, shoe_size, birth_date, kvkk_consent, sms_consent, credit_limit, home_store_id, created_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)',
          t, name, '5' + String(between(300000000, 559999999)), gender, pick(SIZES[gender]), `${between(1965, 2005)}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`,
          rnd() > 0.3 ? 1 : 0, rnd() > 0.7 ? 500000 : 0, pick(stores.slice(0, 3)), addDays(today(), -between(60, 400)) + ' 12:00:00',
        ).lastInsertRowid,
      ));
    }

    // Kampanya
    run("INSERT INTO campaigns (tenant_id, name, type, value, min_qty, scope, scope_value) VALUES (?, '2. Çifte %50', 'nth_percent', 50, 2, 'category', ?)", t, String(one<{ id: number }>('SELECT id FROM categories WHERE tenant_id = ? AND name = ?', t, 'Kadın Sandalet')!.id));
    run("INSERT INTO campaigns (tenant_id, name, type, value, min_qty, scope, scope_value, active) VALUES (?, 'Sezon Sonu %20', 'percent', 20, 1, 'season', '2026-KIŞ', 1)", t);

    // Satış geçmişi (son 60 gün)
    const cashierByStore: Record<number, number> = { [stores[0]]: c1, [stores[1]]: c2, [stores[2]]: c3 };
    const users = Object.fromEntries([c1, c2, c3].map((id) => [id, loadUser(id)!]));
    for (let d = 59; d >= 0; d--) {
      const day = addDays(today(), -d);
      const isWeekend = [0, 6].includes(new Date(day + 'T12:00:00').getDay());
      for (const s of stores.slice(0, 3)) {
        const u = users[cashierByStore[s]];
        const opened = openRegister(u, s, 100000) as { session: { id: number } };
        const n = between(isWeekend ? 6 : 3, isWeekend ? 14 : 8);
        for (let k = 0; k < n; k++) {
          const hour = between(10, 21);
          const stamp = `${day} ${String(hour).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00`;
          const items: { variantId: number; qty: number }[] = [];
          const cnt = rnd() > 0.75 ? 2 : 1;
          for (let j = 0; j < cnt; j++) {
            const v = pick(variants);
            const st = one<{ qty: number }>('SELECT qty FROM stock WHERE store_id = ? AND variant_id = ?', s, v.id)?.qty ?? 0;
            if (st > 0 && !items.some((x) => x.variantId === v.id)) items.push({ variantId: v.id, qty: 1 });
          }
          if (!items.length) continue;
          const customerId = rnd() > 0.5 ? pick(customers) : null;
          try {
            const q = quote(u, { storeId: s, items });
            const r = rnd();
            const method = r < 0.45 ? 'card' : r < 0.9 ? 'cash' : 'transfer';
            const sale = createSale(u, { storeId: s, customerId, salespersonId: u.id, items, payments: [{ method, amount: q.total, installments: method === 'card' && q.total > 200000 ? 3 : 1 }] }) as unknown as { id: number };
            run('UPDATE sales SET created_at = ? WHERE id = ?', stamp, sale.id);
            run("UPDATE stock_movements SET created_at = ? WHERE ref_type = 'sale' AND ref_id = ?", stamp, sale.id);
          } catch {
            /* stok yetersiz vb. — demo için atla */
          }
        }
        if (rnd() > 0.6) recordCash(u, { storeId: s, type: 'expense', category: pick(['Yemek / çay', 'Kargo', 'Temizlik', 'Poşet / ambalaj']), amount: between(5000, 60000), note: 'Demo gider' });
        const summary = closeRegister(u, s, 0) as { summary: { expectedCash: number } };
        const diff = rnd() > 0.8 ? between(-5000, 5000) : 0;
        run('UPDATE register_sessions SET counted_cash = ?, difference = ?, opened_at = ?, closed_at = ? WHERE id = ?', summary.summary.expectedCash + diff, diff, `${day} 09:55:00`, `${day} 22:05:00`, opened.session.id);
        run('UPDATE cash_movements SET created_at = ? WHERE register_session_id = ?', `${day} 15:00:00`, opened.session.id);
      }
    }
    // Birkaç veresiye / kapora / müşteri siparişi örneği
    const cust = customers[0];
    run("UPDATE customers SET credit_limit = 1000000 WHERE id = ?", cust);
    run("INSERT INTO customer_ledger (tenant_id, customer_id, store_id, type, amount, due_date, note, user_id, created_at) VALUES (?,?,?,'sale',185000,?, 'Demo veresiye', ?, ?)", t, cust, stores[0], addDays(today(), -5), c1, addDays(today(), -35) + ' 14:00:00');
    run("INSERT INTO customer_orders (tenant_id, store_id, order_no, customer_id, description, qty, price, deposit, deposit_method, status, due_date, user_id) VALUES (?,?,'MS-000001',?,?,1,189900,50000,'cash','arrived',?,?)", t, stores[0], customers[1], 'K1001 Topuklu Stiletto - Kırmızı - 41 numara', today(), c1);
    run('INSERT INTO sequences (tenant_id, key, value) VALUES (?, ?, 1)', t, 'customer_order');
    run("INSERT INTO tasks (tenant_id, store_id, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)", t, stores[0], 'Vitrin değişimi', 'Kış koleksiyonu vitrine çıkacak', today(), owner);
    run("INSERT INTO targets (tenant_id, month, amount) VALUES (?, ?, 150000000)", t, today().slice(0, 7));
    run("INSERT INTO supplier_ledger (tenant_id, supplier_id, type, amount, due_date, doc_no, note) VALUES (?,?,'invoice',4500000,?,'A-12345','Demo alış faturası')", t, suppliers[0], addDays(today(), 3));
  });
  console.log('Demo verisi hazır. Giriş: firma "demo", kullanıcı "patron", şifre "demo123"');
}

