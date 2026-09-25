-- DC Ayakkabı Satış veritabanı şeması
-- Tüm para tutarları KURUŞ cinsinden tam sayı (INTEGER) olarak tutulur (yuvarlama hatası olmaması için).
-- Satış fiyatları KDV DAHİL tutulur.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

-- Firmalar (her ayakkabı firması bir kiracıdır)
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,              -- giriş ekranındaki firma kodu
  name TEXT NOT NULL,
  tax_no TEXT, tax_office TEXT, address TEXT, phone TEXT, email TEXT,
  plan TEXT NOT NULL DEFAULT 'standart',
  max_stores INTEGER NOT NULL DEFAULT 5,
  license_until TEXT,                     -- YYYY-MM-DD, NULL = süresiz
  active INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',    -- JSON: fiş, puan, iade kuralları vs.
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT, address TEXT, phone TEXT,
  is_warehouse INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','warehouse')),
  is_superadmin INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  commission_rate INTEGER NOT NULL DEFAULT 0,   -- binde değil, yüzde*100 (250 = %2,50)
  all_stores INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, username)
);

CREATE TABLE IF NOT EXISTS user_stores (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, store_id)
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

-- Numara serileri: Kadın 36-41, Erkek 39-45, Çocuk 26-35 ...
CREATE TABLE IF NOT EXISTS size_series (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  sizes TEXT NOT NULL,           -- JSON dizi: ["36","37",...]
  assortment TEXT,               -- JSON dizi: koli asortisi (her numaradan kaç çift) [1,2,2,2,2,1]
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  contact_name TEXT, phone TEXT, email TEXT, tax_no TEXT, tax_office TEXT,
  address TEXT, iban TEXT, payment_term_days INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,                 -- model kodu
  name TEXT NOT NULL,
  brand_id INTEGER REFERENCES brands(id),
  category_id INTEGER REFERENCES categories(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  gender TEXT,                        -- kadin / erkek / cocuk / unisex
  season TEXT,                        -- 2026-YAZ vb.
  material TEXT,                      -- hakiki deri, süet, tekstil ...
  cost_price INTEGER NOT NULL DEFAULT 0,  -- KDV hariç alış (kuruş)
  sale_price INTEGER NOT NULL DEFAULT 0,  -- KDV dahil satış (kuruş)
  vat_rate INTEGER NOT NULL DEFAULT 10,   -- ayakkabıda genellikle %10
  min_stock INTEGER NOT NULL DEFAULT 1,   -- numara başına kritik stok (mağaza bazında)
  description TEXT,
  image_url TEXT,
  marketplace_sync INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  barcode TEXT NOT NULL,
  sale_price INTEGER,                 -- NULL ise ürün fiyatı geçerli
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, barcode),
  UNIQUE (product_id, color, size)
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);

CREATE TABLE IF NOT EXISTS stock (
  store_id INTEGER NOT NULL REFERENCES stores(id),
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (store_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_variant ON stock(variant_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL,               -- + giriş, - çıkış
  type TEXT NOT NULL,                 -- purchase, sale, return, transfer_out, transfer_in, count, damage, manual, opening
  ref_type TEXT, ref_id INTEGER,
  unit_cost INTEGER,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sm_variant ON stock_movements(variant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sm_tenant ON stock_movements(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  birth_date TEXT,
  gender TEXT,
  shoe_size TEXT,
  city TEXT, address TEXT,
  tax_no TEXT, tax_office TEXT,       -- kurumsal fatura için VKN / TCKN
  notes TEXT,
  kvkk_consent INTEGER NOT NULL DEFAULT 0,
  sms_consent INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,  -- sadakat puanı (kuruş karşılığı)
  credit_limit INTEGER NOT NULL DEFAULT 0, -- veresiye limiti (kuruş) 0 = veresiye kapalı
  home_store_id INTEGER REFERENCES stores(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);

-- Müşteri cari hareketleri: + borç (veresiye satış), - ödeme
CREATE TABLE IF NOT EXISTS customer_ledger (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  store_id INTEGER REFERENCES stores(id),
  type TEXT NOT NULL,                 -- sale, payment, return, adjust
  amount INTEGER NOT NULL,
  method TEXT,
  due_date TEXT,
  ref_type TEXT, ref_id INTEGER,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cl_customer ON customer_ledger(customer_id);

CREATE TABLE IF NOT EXISTS register_sessions (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  opening_cash INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  expected_cash INTEGER,
  counted_cash INTEGER,
  difference INTEGER,
  summary TEXT,                       -- JSON gün sonu özeti
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_register ON register_sessions(store_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  receipt_no TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'sale' CHECK (type IN ('sale','return','exchange')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  original_sale_id INTEGER REFERENCES sales(id),
  customer_id INTEGER REFERENCES customers(id),
  user_id INTEGER NOT NULL REFERENCES users(id),       -- kasiyer
  salesperson_id INTEGER REFERENCES users(id),         -- satış danışmanı (prim için)
  register_session_id INTEGER REFERENCES register_sessions(id),
  subtotal INTEGER NOT NULL,          -- indirimsiz brüt (KDV dahil)
  discount_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,             -- ödenecek (KDV dahil, negatif = iade)
  vat_total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  einvoice_status TEXT,               -- NULL, pending, sent, error
  einvoice_no TEXT,
  okc_status TEXT,
  cancel_reason TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_store_date ON sales(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL,               -- iade satırlarında negatif
  unit_price INTEGER NOT NULL,        -- liste fiyatı (KDV dahil)
  discount INTEGER NOT NULL DEFAULT 0,-- satır toplam indirimi
  line_total INTEGER NOT NULL,        -- qty*unit_price - discount
  vat_rate INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  campaign_id INTEGER,
  campaign_name TEXT,
  returned_qty INTEGER NOT NULL DEFAULT 0,  -- bu satırdan sonradan iade edilen adet
  original_item_id INTEGER REFERENCES sale_items(id)
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_variant ON sale_items(variant_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('cash','card','transfer','credit','giftcard','points','deposit')),
  amount INTEGER NOT NULL,
  installments INTEGER NOT NULL DEFAULT 1,
  ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

-- Kasa hareketleri: gider, gelir, bankaya yatan, kasadan alınan, veresiye tahsilatı
CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  register_session_id INTEGER REFERENCES register_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('expense','income','deposit','withdraw','collection','supplier_payment')),
  method TEXT NOT NULL DEFAULT 'cash',
  category TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  ref_type TEXT, ref_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cash_store_date ON cash_movements(store_id, created_at);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  order_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  expected_date TEXT,
  invoice_no TEXT,
  note TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, order_no)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0
);

-- Tedarikçi cari: + borcumuz artar (fatura), - ödeme / iade
CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  type TEXT NOT NULL,                 -- invoice, payment, return, adjust
  amount INTEGER NOT NULL,
  method TEXT,
  due_date TEXT,
  doc_no TEXT,
  ref_type TEXT, ref_id INTEGER,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sl_supplier ON supplier_ledger(supplier_id);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  transfer_no TEXT NOT NULL,
  from_store_id INTEGER NOT NULL REFERENCES stores(id),
  to_store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('requested','sent','received','cancelled')),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sent_at TEXT,
  received_by INTEGER REFERENCES users(id),
  received_at TEXT,
  UNIQUE (tenant_id, transfer_no)
);

CREATE TABLE IF NOT EXISTS transfer_items (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  qty_received INTEGER
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'partial' CHECK (scope IN ('partial','full')), -- full: sayılmayan ürün 0 kabul edilir
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  applied_by INTEGER REFERENCES users(id),
  applied_at TEXT,
  result TEXT                          -- JSON fark özeti
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  counted_qty INTEGER NOT NULL DEFAULT 0,
  system_qty INTEGER,
  PRIMARY KEY (count_id, variant_id)
);

-- Müşteri özel siparişi: "Bu numara yok, getirtelim"
CREATE TABLE IF NOT EXISTS customer_orders (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  order_no TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  variant_id INTEGER REFERENCES variants(id),
  description TEXT NOT NULL,          -- model / renk / numara açıklaması
  qty INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  deposit INTEGER NOT NULL DEFAULT 0, -- alınan kapora
  deposit_method TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ordered','arrived','notified','delivered','cancelled')),
  due_date TEXT,
  note TEXT,
  sale_id INTEGER REFERENCES sales(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, order_no)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent','amount','buy_x_pay_y','nth_percent')),
  value INTEGER NOT NULL,             -- percent: yüzde, amount: kuruş, buy_x_pay_y: Y, nth_percent: yüzde
  min_qty INTEGER NOT NULL DEFAULT 1, -- buy_x_pay_y: X, nth_percent: N (N. ürün)
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','category','brand','product','season')),
  scope_value TEXT,
  store_ids TEXT,                     -- JSON dizi, NULL = tüm mağazalar
  start_date TEXT, end_date TEXT,     -- YYYY-MM-DD dahil
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS gift_cards (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  initial_amount INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  clock_in TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  clock_out TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id, clock_in);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL,                -- YYYY-MM
  store_id INTEGER REFERENCES stores(id),
  user_id INTEGER REFERENCES users(id),
  amount INTEGER NOT NULL,
  UNIQUE (tenant_id, month, store_id, user_id)
);

-- Pazaryeri siparişleri (tekrar işlenmesin diye)
CREATE TABLE IF NOT EXISTS marketplace_orders (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,
  order_no TEXT NOT NULL,
  sale_id INTEGER REFERENCES sales(id),
  status TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (tenant_id, provider, order_no)
);

-- Mağaza içi görev / not / duyuru panosu
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  store_id INTEGER REFERENCES stores(id),
  assigned_to INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  detail TEXT,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  done_at TEXT
);

CREATE TABLE IF NOT EXISTS integration_settings (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,             -- einvoice, marketplace_trendyol, marketplace_hepsiburada, marketplace_n11, sms, whatsapp, okc
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  config TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (tenant_id, provider)
);

-- Dış sistemlere gidecek işler kuyruğu (internet kesilse de kaybolmaz, tekrar denenir)
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','error','simulated')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  response TEXT,
  ref_type TEXT, ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status, next_try_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS sequences (
  tenant_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, key)
);
