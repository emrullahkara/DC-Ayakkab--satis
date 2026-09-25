# DC Ayakkabı Satış — Ürün Sunumu

> PowerPoint sürümü: [DC-Ayakkabi-Satis-Sunum.pptx](DC-Ayakkabi-Satis-Sunum.pptx) (19 slayt). Bu dosya aynı içeriğin okunabilir özetidir.

## 1. Ayakkabıcının her gün yaşadığı sorunlar

| Sorun | Ne oluyor |
|---|---|
| Numara yok mu, var mı? | Müşteri 38 istiyor; depoda mı, öbür şubede mi belli değil. Telefon trafiği, kaçan satış. |
| Kasa tutmuyor | Gün sonunda nakit ile satış eşleşmiyor; kimin hatası, hangi fiş bilinmiyor. |
| Veresiye defteri | Kim ne kadar borçlu, vadesi geçmiş mi — defterde, akılda, kayıp. |
| Ölü stok | Sezon bitti, hangi model raflarda çürüyor, hangi numara hiç satmadı görülmüyor. |
| Personel primi | Kim ne sattı, hangi danışman iade yaptırdı; prim hesabı tartışma konusu. |
| Dağınık araçlar | Excel, WhatsApp grupları, kâğıt fişler, ayrı e-fatura programı, pazaryeri panelleri. |

## 2. Çözüm: tek uygulama, tek ekran, tüm mağazalar

Tarayıcıda çalışır, kurulum gerektirmez; her şube aynı anda aynı veriyi görür.
**14 ana modül · 7 hazır entegrasyon · 4 kullanıcı rolü · sınırsız firma & mağaza.**

## 3. Patron paneli
Bugün / dün / bu ay / geçen yıl aynı gün cirosu; uyarılar (eksik numara, gelen sipariş, veresiye, tedarikçi vadesi, kapanmamış kasa, doğum günü); mağaza karşılaştırması; aylık hedef; personel ve ürün sıralaması. Telefondan aynı görünüm.

## 4. Kasa (POS): 30 saniyede satış
- Barkod okut ya da model adı yaz → renk/numara kutucukları (bu mağazada / toplam stok)
- Numara yoksa hangi şubede olduğunu söyler
- Kampanyalar otomatik: %, tutar, 3 al 2 öde, 2. çifte %50
- Kasiyer indirim sınırı; üstü müdür yetkisi
- Ödeme: nakit + kart (taksit) + havale + veresiye + hediye çeki + puan + kapora karışık
- Para üstü hesabı, 80 mm fiş, F2 / F4 / F9 kısayolları

## 5. İade, değişim ve gün sonu
- Fişten satır seç → kısmi iade veya numara değişimi; fark otomatik. Fazla iade engellenir, süre geçince müdür onayı. İade tutarı hediye çeki (mağaza kredisi) olabilir.
- Kasa açılış nakiti, gider/gelir/bankaya yatan, kupür sayımı, beklenen nakit ve fark raporu. Kasa açık değilse satış yapılamaz (ayarlanabilir).

## 6. Ürün, barkod ve numara
- Model → renk × numara; her çift için otomatik EAN-13 barkod (veya üretici barkodu)
- Numara serileri (Kadın / Erkek / Çocuk) ve koli asortisi
- Mağaza × numara stok tablosu — kırmızı hücre tükenmiş numara
- Barkodlu fiyat etiketi, toplu zam/indirim (x9,90 yuvarlama), Excel'den toplu aktarım

## 7. Stok
Eksik numara uyarısı · mağazalar arası transfer (gönder / talep et / eksik teslim) · barkodla sayım (kısmi / tam) · fire-defolu · ölü stok & devir hızı · numara analizi ve asorti önerisi.

## 8. Satın alma ve tedarikçi carisi
Sipariş → tedarikçiye ver → (kısmi) mal kabul → stok + son alış fiyatı → cariye KDV dahil borç → vade & ödeme. Hızlı mal kabul, cari hareketler, "7 gün içinde ödenecek" uyarısı.

## 9. Müşteri
Hızlı kayıt (KVKK, İYS) · geçmiş ve aldığı numaralar · sadakat puanı · veresiye limiti ve tahsilat · segmentler (borçlu, VIP, kayıp, doğum günü, yeni) → toplu SMS/WhatsApp · özel sipariş (kapora → geldi → mesaj → teslim).

## 10. Kampanya, hediye çeki, personel
- Kampanya türleri: yüzde, tutar, X al Y öde, N. çifte %; kapsam: tüm ürünler / kategori / marka / sezon / ürün; tarih ve mağaza filtresi; müşteri lehine otomatik seçim.
- Hediye çeki: satışı kasaya gelir, benzersiz kod, kısmi kullanım, iade karşılığı çek.
- Personel: Patron / Müdür / Kasiyer / Depo rolleri, mağaza yetkisi, prim hak edişi, hedefler, mesai, görev panosu, işlem kayıtları.

## 11. Raporlar
Satış özeti (gün, saat, mağaza, personel, ödeme) · ürün performansı (model, marka, kategori, cinsiyet, sezon, renk, numara, tedarikçi) · numara analizi · stok değeri · ölü stok · devir hızı · kâr/zarar · KDV dökümü · hepsi Excel'e.

## 12. Entegrasyonlar
| Sağlayıcı | Kapsam |
|---|---|
| e-Fatura / e-Arşiv | UBL-TR 1.2; Uyumsoft, Logo, Paraşüt, EDM, İzibiz veya genel REST |
| Yazarkasa POS (ÖKC) | Ingenico, Beko, Hugin, Verifone, PAVO yerel köprüsü |
| SMS | Netgsm veya genel HTTP |
| WhatsApp | Meta Cloud API, onaylı şablon |
| Trendyol / Hepsiburada / N11 | Stok & fiyat gönderimi, sipariş çekme |

Kuyruk mantığı: internet kesilse de kaybolmaz, hata alırsa 10 kez tekrar dener; test modunda dış sisteme hiçbir şey gitmez.

## 13. Uygulamayı diğer ayakkabıcılara satmak
Çok kiracılı mimari; paketler: Başlangıç (1 mağaza), Standart (2–5), Pro (6–15), Zincir (16+). Lisans bitiş tarihi, mağaza sınırı, şifre sıfırlama, firma kapatma tek ekranda. Sunucu maliyeti aylık ~5–10 €. Hazır demo firması.

## 14. Her cihazda çalışır
Kasa PC (Chrome, USB barkod okuyucu), 80 mm fiş yazıcı, 40×30 mm etiket yazıcı, tablet & telefon (PWA).

## 15. Teknik altyapı ve güvenlik
Node.js 22 + Express 5 + TypeScript + SQLite (WAL); React 19 + Vite. Bcrypt, JWT, rol/mağaza yetkisi, kaba kuvvet koruması, denetim kaydı, HTTPS. 6 saatte bir yedek, JSON dışa aktarma, kuruş hassasiyeti. 28 otomatik test + tarayıcı uçtan uca test + CI.

## 16. Kurulum: 10 dakika, 5 komut
1. Ubuntu sunucu (2 GB RAM)
2. `curl -fsSL https://get.docker.com | sh`
3. `git clone … && cp .env.example .env`
4. `.env`: `ADMIN_PASSWORD` ve (varsa) `DOMAIN`
5. `docker compose up -d --build` (HTTPS: `--profile https`)

İlk giriş: firma `sistem`, kullanıcı `admin`. Ayrıntı: [KURULUM.md](KURULUM.md), [KULLANIM.md](KULLANIM.md), [SATIS-VE-LISANS.md](SATIS-VE-LISANS.md).

## 17. Proje durumu
**Tamamlandı:** sunucu (14 modül, fiyatlama motoru, entegrasyon kuyruğu, raporlar), web (25 ekran), Docker + compose + HTTPS, CI, Türkçe kılavuzlar, demo verisi, şifre sıfırlama aracı; PR #1 yeşil CI ile `main`'e birleştirildi.
**Sizin tarafınızda:** sunucu kiralama ve kurulum; entegrasyon hesapları (e-fatura entegratörü, SMS/WhatsApp, pazaryeri API, ÖKC köprüsü); fiş başlığı, mağazalar, personel, ürün Excel'i.
**Önerilen sonraki adımlar:** ilk mağazada 1 hafta paralel kullanım; sahadan gelen isteklerle 1.1 sürümü (doğrudan XLSX yükleme, çevrimdışı kasa modu).
