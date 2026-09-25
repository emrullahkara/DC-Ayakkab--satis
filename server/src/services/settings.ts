import { one, run } from '../db/index.js';

export const DEFAULT_SETTINGS = {
  receipt: {
    header: '',
    footer: 'Değişim ve iadelerde fişinizi saklayınız. Teşekkür ederiz.',
    showSalesperson: true,
  },
  loyalty: { enabled: true, earnPercent: 2 },
  returns: { daysLimit: 30 },
  pos: {
    allowNegativeStock: false,
    maxDiscountPercent: 10,
    requireSalesperson: false,
    requireOpenRegister: true,
  },
  label: { widthMm: 40, heightMm: 30, showPrice: true, showSize: true },
  stock: { deadStockDays: 90 },
  einvoice: { autoSend: false },
  messages: {
    birthdayEnabled: false,
    birthdayText: 'Sevgili {ad}, doğum gününüz kutlu olsun! Size özel %10 indirim mağazalarımızda sizi bekliyor.',
    orderArrivedText: 'Sayın {ad}, sipariş ettiğiniz {urun} mağazamıza ulaşmıştır. {magaza}',
    debtReminderText: 'Sayın {ad}, {tutar} tutarındaki hesap bakiyenizi hatırlatırız. {firma}',
  },
  marketplace: { storeId: null as number | null },
};

export type TenantSettings = typeof DEFAULT_SETTINGS;

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (over && typeof over === 'object') {
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      if (k in out) out[k] = deepMerge(out[k], v);
    }
  }
  return out as T;
}

export function getSettings(tenantId: number): TenantSettings {
  const row = one<{ settings: string }>('SELECT settings FROM tenants WHERE id = ?', tenantId);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row?.settings || '{}');
  } catch {
    parsed = {};
  }
  return deepMerge(DEFAULT_SETTINGS, parsed);
}

export function saveSettings(tenantId: number, patch: unknown): TenantSettings {
  const merged = deepMerge(getSettings(tenantId), patch);
  run('UPDATE tenants SET settings = ? WHERE id = ?', JSON.stringify(merged), tenantId);
  return merged;
}
