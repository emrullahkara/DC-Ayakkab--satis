# DC Ayakkabı Satış

Ayakkabı mağazaları için **tek ekrandan** çok mağazalı satış, stok, müşteri, kasa ve personel yönetimi.
Tek mağazadan onlarca şubeli zincire kadar; kasada PC, mağazada tablet, patronun cebinde telefon.

> Kurulum için: [docs/KURULUM.md](docs/KURULUM.md) · Kullanım kılavuzu: [docs/KULLANIM.md](docs/KULLANIM.md) · Satış/lisans yönetimi: [docs/SATIS-VE-LISANS.md](docs/SATIS-VE-LISANS.md)

## Neleri çözer?

| Alan | Özellikler |
|---|---|
| **Kasa (POS)** | Barkod okutma, model/isim arama, renk-numara seçimi, otomatik kampanya, bölünmüş ödeme (nakit + kart + taksit + havale + veresiye + hediye çeki + puan + kapora), para üstü, fiş yazdırma (80 mm), klavye kısayolları (F2/F4/F9), stokta olmayan numarayı diğer mağazalarda gösterme |
| **İade & değişim** | Fişten satır seçerek kısmi iade, numara değişimi (fark tahsil/iade), iade süresi ve müdür onayı, hediye çekiyle iade, satış iptali (kasa kapanmadan), iade edilen adet takibi (fazla iade engeli) |
| **Kasa açma/kapama** | Açılış nakiti, gider/gelir/bankaya yatan/kasadan alınan, gün sonu kupür sayımı, kasa açığı/fazlası raporu, geçmiş gün sonları |
| **Ürün & barkod** | Model → renk × numara varyantları, otomatik EAN-13 (mağaza içi 20-29 öneki) veya üretici barkodu, numara serileri (Kadın/Erkek/Çocuk) ve asorti, etiket yazdırma, toplu fiyat (zam/indirim + x9,90 yuvarlama), Excel'den toplu aktarım, numaraya özel fiyat |
| **Stok** | Mağaza × renk × numara stok tablosu, eksik numara / kritik stok uyarısı, mağazalar arası transfer (gönder / talep et / eksik teslim), stok sayımı (barkodla, kısmi veya tam), fire/defolu, stok hareket geçmişi, ölü stok, devir hızı, numara analizi (asorti planlama) |
| **Satın alma** | Tedarikçi kartı, sipariş → kısmi/tam mal kabul → stok + son alış fiyatı güncelleme, hızlı mal kabul (irsaliye), tedarikçi cari (fatura/ödeme/iade), vade takibi |
| **Müşteri** | Telefonla hızlı kayıt, KVKK & İYS izinleri, alışveriş geçmişi, aldığı numaralar, sadakat puanı, veresiye (limit + cari + tahsilat), segmentler (borçlu, VIP, kayıp, doğum günü), toplu SMS/WhatsApp, müşteri özel siparişi (kapora → geldi → mesaj → teslim) |
| **Kampanya** | % indirim, tutar indirimi, 3 al 2 öde, 2. çifte %50; kategori/marka/sezon/ürün kapsamı; tarih ve mağaza filtresi; kasada otomatik ve müşteri lehine seçim |
| **Personel** | Roller (patron, müdür, kasiyer, depo) ve mağaza yetkileri, prim oranı ve hak ediş, satış performansı, hedefler (firma/mağaza/personel), mesai giriş-çıkış, görev/not panosu, işlem kayıtları (kim ne yaptı) |
| **Raporlar** | Günlük/saatlik ciro, mağaza & personel karşılaştırma, ödeme türleri, ürün/marka/kategori/renk/numara performansı, stok değeri, kâr/zarar (gider dahil), KDV dökümü; hepsi Excel'e aktarılır |
| **Entegrasyonlar** | e-Fatura/e-Arşiv (UBL-TR), yazarkasa POS (ÖKC köprüsü), SMS (Netgsm / genel HTTP), WhatsApp Cloud API, Trendyol / Hepsiburada / N11 stok-fiyat gönderimi ve sipariş çekme. Test modu ile risksiz deneme, kuyruk & tekrar deneme |
| **Çok firma** | Uygulama satın alan her firma ayrı "kiracı"; sistem yöneticisi firma açar, mağaza sayısı ve lisans süresi belirler, şifre sıfırlar |
| **Güvenlik & veri** | Bcrypt şifre, JWT oturum, rol bazlı yetki, kaba kuvvet koruması, denetim kaydı, otomatik SQLite yedek (6 saatte bir), tek tıkla JSON dışa aktarma |

## Teknik özet

- **Sunucu:** Node.js 22, Express 5, TypeScript, SQLite (better-sqlite3, WAL). Tek dosya veritabanı; yedeklemesi kolay, 50 mağaza / milyonlarca satıra rahat yeter.
- **Arayüz:** React 19 + Vite. Mobil uyumlu, PWA (ana ekrana eklenebilir), yazdırma görünümleri.
- **Dağıtım:** Tek Docker imajı (`docker compose up -d`) veya doğrudan Node.js. HTTPS için hazır Caddy profili.
- **Test:** 28 birim/API testi (fiyatlama motoru, satış/iade/kasa/stok akışları) + Playwright ile tarayıcı uçtan uca test.

```bash
# Geliştirme
npm install
npm run dev:server     # http://localhost:3000 (API)
npm run dev:web        # http://localhost:5173 (arayüz, API'ye proxy)
npm run seed:demo      # demo firması ve 60 günlük örnek satış
npm test               # testler
npm run build          # üretim derlemesi (web/dist + server/dist)
```

Demo giriş: firma **demo**, kullanıcı **patron**, şifre **demo123** (diğerleri: mudur, kasiyer1, kasiyer2, kasiyer3, depo — hepsi demo123).
