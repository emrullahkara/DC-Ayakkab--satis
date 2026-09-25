export type Role = 'owner' | 'manager' | 'cashier' | 'warehouse';

/**
 * Yetki listesi. Patron (owner) her şeye yetkilidir.
 * Arayüz de aynı listeyi kullanarak menüleri gösterir/gizler.
 */
export const PERMISSIONS = {
  dashboard: 'Kontrol paneli',
  pos: 'Satış yapma (kasa ekranı)',
  'sales.view': 'Satışları görme',
  'sales.return': 'İade / değişim',
  'sales.cancel': 'Satış iptali, süre dışı iade',
  'sales.discount': 'Limitsiz indirim / fiyat değiştirme',
  register: 'Kasa açma/kapama',
  'cash.movements': 'Gider / kasa hareketi girme',
  'products.view': 'Ürünleri görme',
  'products.edit': 'Ürün ekleme / düzenleme',
  'prices.edit': 'Fiyat değiştirme',
  'costs.view': 'Alış fiyatı ve kâr görme',
  'stock.view': 'Stok görme',
  'stock.adjust': 'Stok düzeltme / fire',
  transfers: 'Mağazalar arası transfer',
  counts: 'Stok sayımı',
  purchases: 'Satın alma / mal kabul',
  suppliers: 'Tedarikçi ve cari',
  customers: 'Müşteri kayıt ve görme',
  'customers.credit': 'Veresiye / müşteri cari yönetimi',
  customer_orders: 'Müşteri özel siparişi',
  campaigns: 'Kampanya yönetimi',
  giftcards: 'Hediye çeki',
  staff: 'Personel, vardiya ve hedefler',
  reports: 'Raporlar',
  tasks: 'Görevler / notlar',
  messages: 'SMS / WhatsApp gönderme',
  settings: 'Firma ayarları, mağazalar, kullanıcılar',
  integrations: 'Entegrasyon ayarları',
  audit: 'İşlem kayıtları (log)',
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => !['settings', 'integrations', 'audit'].includes(p)),
  cashier: [
    'dashboard', 'pos', 'sales.view', 'sales.return', 'register', 'cash.movements', 'products.view',
    'stock.view', 'customers', 'customer_orders', 'giftcards', 'tasks', 'transfers',
  ],
  warehouse: [
    'dashboard', 'products.view', 'products.edit', 'stock.view', 'stock.adjust', 'transfers', 'counts',
    'purchases', 'tasks',
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Patron / Firma Sahibi',
  manager: 'Mağaza Müdürü',
  cashier: 'Kasiyer / Satış Danışmanı',
  warehouse: 'Depo Sorumlusu',
};
