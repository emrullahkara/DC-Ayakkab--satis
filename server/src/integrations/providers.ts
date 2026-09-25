/**
 * Entegrasyon sağlayıcıları. Arayüzdeki ayar formları bu tanımlardan otomatik oluşur.
 * "Test" modunda hiçbir dış sisteme istek atılmaz; işler kuyrukta "simüle edildi" olarak görünür.
 */
export interface ProviderField {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'select' | 'number';
  options?: { value: string; label: string }[];
  help?: string;
  secret?: boolean;
}

export interface ProviderDef {
  label: string;
  group: 'fatura' | 'pazaryeri' | 'mesaj' | 'kasa';
  description: string;
  fields: ProviderField[];
}

export const PROVIDERS: Record<string, ProviderDef> = {
  einvoice: {
    label: 'e-Fatura / e-Arşiv',
    group: 'fatura',
    description:
      'Satışlardan UBL-TR formatında e-Arşiv / e-Fatura üretir ve özel entegratörünüze gönderir. Entegratörünüzden aldığınız API bilgilerini girin.',
    fields: [
      {
        key: 'integrator', label: 'Entegratör', type: 'select',
        options: [
          { value: 'generic', label: 'Genel REST (UBL XML gönderimi)' },
          { value: 'uyumsoft', label: 'Uyumsoft' },
          { value: 'logo', label: 'Logo e-Dönüşüm' },
          { value: 'parasut', label: 'Paraşüt' },
          { value: 'edm', label: 'EDM Bilişim' },
          { value: 'izibiz', label: 'İzibiz' },
        ],
      },
      { key: 'endpoint', label: 'API adresi (URL)', help: 'Entegratörün size verdiği fatura gönderim adresi' },
      { key: 'username', label: 'Kullanıcı adı' },
      { key: 'password', label: 'Şifre / API anahtarı', type: 'password', secret: true },
      { key: 'senderVkn', label: 'Firma VKN / TCKN' },
      { key: 'senderTitle', label: 'Firma unvanı' },
      { key: 'invoicePrefix', label: 'Fatura seri öneki (3 harf)', help: 'Örn: DCA → DCA2026000000001' },
    ],
  },
  okc: {
    label: 'Yazarkasa POS (ÖKC)',
    group: 'kasa',
    description:
      'Yeni nesil yazarkasa POS cihazına (Ingenico, Beko, Hugin, Verifone, PAVO vb.) satışı gönderir. Cihaz üreticisinin mağaza bilgisayarına kurduğu yerel köprü (GMP3 servis) adresini girin.',
    fields: [
      {
        key: 'brand', label: 'Cihaz markası', type: 'select',
        options: ['Ingenico', 'Beko', 'Hugin', 'Verifone', 'PAVO', 'Profilo', 'Diğer'].map((v) => ({ value: v, label: v })),
      },
      { key: 'bridgeUrl', label: 'Yerel köprü adresi', help: 'Örn: http://192.168.1.50:8080 — her mağaza için farklıysa mağaza kodu ile {magaza} yazılabilir' },
      { key: 'terminalId', label: 'Terminal / cihaz no' },
      { key: 'apiKey', label: 'Köprü anahtarı (varsa)', type: 'password', secret: true },
    ],
  },
  sms: {
    label: 'SMS',
    group: 'mesaj',
    description: 'Sipariş geldi, doğum günü, kampanya ve borç hatırlatma SMS\'leri. İleti Yönetim Sistemi (İYS) onayı olan müşterilere gönderilir.',
    fields: [
      {
        key: 'provider', label: 'SMS firması', type: 'select',
        options: [
          { value: 'netgsm', label: 'Netgsm' },
          { value: 'generic', label: 'Genel HTTP (diğer firmalar)' },
        ],
      },
      { key: 'usercode', label: 'Kullanıcı kodu / API kullanıcı' },
      { key: 'password', label: 'Şifre / API anahtarı', type: 'password', secret: true },
      { key: 'header', label: 'Mesaj başlığı (gönderici adı)' },
      { key: 'endpoint', label: 'Genel HTTP adresi', help: 'Sadece "Genel HTTP" seçiliyse. {tel} ve {mesaj} yer tutucuları kullanılabilir.' },
    ],
  },
  whatsapp: {
    label: 'WhatsApp Business',
    group: 'mesaj',
    description: 'Meta WhatsApp Cloud API ile mesaj gönderimi. Müşteri son 24 saatte yazmadıysa onaylı şablon adı girilmelidir.',
    fields: [
      { key: 'phoneNumberId', label: 'Telefon numarası ID' },
      { key: 'accessToken', label: 'Erişim anahtarı (token)', type: 'password', secret: true },
      { key: 'templateName', label: 'Onaylı şablon adı (isteğe bağlı)' },
      { key: 'templateLang', label: 'Şablon dili', help: 'Örn: tr' },
    ],
  },
  marketplace_trendyol: {
    label: 'Trendyol',
    group: 'pazaryeri',
    description: 'Stok ve fiyatlarınızı barkod üzerinden Trendyol\'a gönderir, yeni siparişleri çekip stoktan düşer.',
    fields: [
      { key: 'sellerId', label: 'Satıcı ID (Supplier ID)' },
      { key: 'apiKey', label: 'API Key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', secret: true },
      { key: 'priceMarkup', label: 'Fiyat farkı (%)', type: 'number', help: 'Mağaza fiyatına eklenecek yüzde (komisyon için). Boş = aynı fiyat' },
    ],
  },
  marketplace_hepsiburada: {
    label: 'Hepsiburada',
    group: 'pazaryeri',
    description: 'Stok ve fiyatlarınızı satıcı stok kodu (barkod) üzerinden Hepsiburada\'ya gönderir.',
    fields: [
      { key: 'merchantId', label: 'Merchant ID' },
      { key: 'username', label: 'Kullanıcı adı' },
      { key: 'password', label: 'Şifre', type: 'password', secret: true },
      { key: 'priceMarkup', label: 'Fiyat farkı (%)', type: 'number' },
    ],
  },
  marketplace_n11: {
    label: 'N11',
    group: 'pazaryeri',
    description: 'Stok ve fiyatlarınızı N11\'e gönderir.',
    fields: [
      { key: 'appKey', label: 'App Key' },
      { key: 'appSecret', label: 'App Secret', type: 'password', secret: true },
      { key: 'endpoint', label: 'Stok/fiyat güncelleme adresi', help: 'N11 entegrasyon dokümanındaki güncel adres' },
      { key: 'priceMarkup', label: 'Fiyat farkı (%)', type: 'number' },
    ],
  },
};

export const MARKETPLACES = Object.keys(PROVIDERS).filter((k) => k.startsWith('marketplace_'));

export function maskConfig(provider: string, cfg: Record<string, unknown>) {
  const def = PROVIDERS[provider];
  const out: Record<string, unknown> = { ...cfg };
  for (const f of def?.fields ?? []) {
    if (f.secret && out[f.key]) out[f.key] = '••••••••';
  }
  return out;
}
