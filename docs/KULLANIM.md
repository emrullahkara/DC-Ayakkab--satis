# Kullanım Kılavuzu

Bu kılavuz mağaza sahipleri, müdürler ve kasiyerler içindir. Ekran adları sol menüdeki adlarla aynıdır.

## Giriş

Firma kodu + kullanıcı adı + şifre ile girilir. Üst çubuktan **hangi mağazada** çalıştığınızı seçin; kasa, stok ve satışlar o mağazaya göre işler. Patron ve "tüm mağazalar" yetkisi olanlar tüm şubeleri görür.

**Roller**

| Rol | Görür / yapar | Göremez |
|---|---|---|
| Patron | Her şey | — |
| Mağaza müdürü | Satış, iade, iptal, limitsiz indirim, stok, sayım, transfer, satın alma, müşteri, kampanya, personel, raporlar | Firma ayarları, entegrasyonlar, işlem kayıtları |
| Kasiyer / danışman | Satış, iade (süre içinde), kasa açma/kapama, gider girme, müşteri kaydı, sipariş, transfer | Alış fiyatı, kâr, ürün düzenleme, ayarlar |
| Depo | Ürün açma, stok, transfer, sayım, mal kabul | Satış, müşteri, raporlar |

## Günlük akış (kasiyer)

1. **Kasa Açma/Kapama → Kasayı aç**: kasadaki bozuk para dahil açılış nakitini yazın.
2. **Kasa / Satış**: barkodu okutun (F2 ile kutuya dönersiniz). Barkod yoksa model kodu veya adı yazıp Enter; renk ve numara kutucuklarından seçin. Kutucukta `2 / 9` = bu mağazada 2, tüm firmada 9 çift.
   - Numara bu mağazada yoksa uyarı diğer mağazalardaki stoğu söyler → **Transferler → Ürün talep et**.
   - Adet için `+ / −`; indirim kutusuna satır indirimi; alt tarafta sepet indirimi. Kasiyer en fazla ayarlardaki yüzde kadar indirim yapabilir.
   - Kampanyalar otomatik uygulanır (satırda mavi etiket).
3. **Müşteri (F4)**: telefonu yazın; yoksa "Yeni müşteri kaydet". Müşteri seçilince puan kazanır, veresiye ve puanla ödeme açılır.
4. **Ödeme al (F9)**: tutar kutusuna alınan miktarı yazıp ödeme türüne basın; birden fazla tür karıştırılabilir (örn. 500 nakit + kalan kart 3 taksit). "Nakit verilen" kısayolları para üstünü söyler. Kalan 0 olunca **Satışı tamamla**.
5. Fiş penceresi açılır (ayarlarda otomatik yazdırma). **Son satış** satırından tekrar yazdırabilirsiniz.
6. Gün sonunda **Kasa Açma/Kapama → Gün sonu**: kupürleri sayın, sistem beklenen nakiti ve farkı gösterir. Kapatınca rapor açılır.

Gider (çay, kargo…), bankaya para yatırma, kasadan para alma: **Kasa Açma/Kapama** üst butonları. Hepsi gün sonu raporuna girer.

## İade & değişim

**Satışlar & İade** → fişi bulun (fiş no, müşteri adı veya barkodla) → **İade / Değişim**.
- İade edilecek satırlarda adet seçin. Değişimse yeni ürünün barkodunu okutun. Fark tutarı otomatik hesaplanır: müşteri fark öder ya da ona ödeme yapılır (nakit, kart, hediye çeki = mağaza kredisi).
- İade süresi (varsayılan 30 gün) geçtiyse müdür/patron yapabilir.
- **Satışı iptal et**: sadece kasası hâlâ açık olan satışlar için; her şeyi geri alır. Kasa kapandıysa iade yapın.

## Ürünler

- **Yeni ürün**: model kodu, ad, marka, kategori, cinsiyet, sezon, fiyatlar, renkler (virgülle) ve numara serisi. Her renk × numara için barkod üretilir.
- Ürün sayfasındaki **tabloda** mağaza × numara stoğu görünür; kırmızı = tükenmiş. Barkod hücresine tıklayıp üretici barkodunu girebilir veya numaraya özel fiyat verebilirsiniz.
- **Etiket yazdır**: seçili ürünlerin varyantları için barkodlu fiyat etiketi.
- **Toplu fiyat**: zam/indirim yüzdesi, x9,90 yuvarlama, önizleme.
- **Excel'den aktar**: Excel'de sütunları hazırlayın (kod, ad, marka, kategori, cinsiyet, sezon, renk, numara, barkod, alış, satış, kdv, adet, mağaza), tabloyu kopyalayıp kutuya yapıştırın, **Kontrol et**, sonra **Aktar**. Hata varsa hiçbir şey yazılmaz.

## Stok

- **Stok listesi**: mağaza sütunlarıyla; Excel'e aktarılır.
- **Eksik numara / kritik**: satılan ama numarası biten ürünler; "Diğer mağazalar" sütunu varsa transfer isteyin.
- **Transferler**: *Ürün gönder* (stoktan hemen düşer) veya *Ürün talep et* (karşı mağaza onaylayıp gönderir). Alan mağaza **Teslim al**; eksik geldiyse adetleri girin, eksik kayda geçer.
- **Stok sayımı**: sayım başlatın, barkodları okutun (her okutma +1, adet kutusuyla çoklu). *Farklar* sekmesi sistemle karşılaştırır. **Sayımı bitir** → farklar stoğa işlenir. *Tam sayım* seçtiyseniz okutulmayan her şey sıfırlanır — dikkat.
- **Fire / düzeltme**: defolu, kayıp vb. için barkod okutup açıklama yazın; kayıt altına alınır.

## Satın alma & tedarikçi

- **Tedarikçiye sipariş** → *Siparişi ver* → mal gelince **Mal kabul** (kısmi olabilir). Stok girer, ürünün son alış fiyatı güncellenir, KDV dahil tutar tedarikçi carisine borç yazılır.
- Sipariş yapmadan mal geldiyse **Hızlı mal kabul**.
- **Tedarikçiler**: borç, ilk vade, cari hareketler; **Ödeme yap** (nakit seçilirse mağaza kasasından düşer), fatura girişi, iade/iskonto.

## Müşteri

- Segment sekmeleri: borçlu, VIP, bu ay doğanlar, kayıp (6 aydır gelmeyen), yeni.
- Müşteri sayfası: alışveriş geçmişi, aldığı numaralar (tekrar ziyarette "geçen sefer 38 almıştınız"), puan, veresiye carisi, siparişler, hediye çekleri.
- **Tahsilat al**: veresiye borcuna nakit/kart/havale; kasaya gelir olarak işlenir.
- **Mesaj**: SMS/WhatsApp (entegrasyon açıksa); sadece ileti izni olanlara gider. Liste ekranında birden fazla müşteri seçip toplu kampanya mesajı atabilirsiniz.
- **Müşteri Siparişleri**: "bu numara yok, getirtelim" — sipariş açın, kapora alın (kasaya girer), ürün gelince **Ürün geldi (müşteriye mesaj at)**, müşteri gelince kasada müşteriyi seçip **Teslim et** → kapora düşülür, kalan tahsil edilir.

## Kampanyalar

Türler: yüzde, tutar, X al Y öde, N. ürüne % (örn. 2. çifte %50). Kapsam: tüm ürünler, kategori, marka, sezon, belirli ürünler. Tarih aralığı ve mağaza seçilebilir. Bir ürüne birden fazla kampanya uyarsa müşteri için en avantajlısı otomatik seçilir.

## Hediye çekleri

**Hediye çeki sat** → kod üretilir, tutar kasaya gelir yazılır. Kasada "Hediye çeki" ödeme türü + kod ile kullanılır; kalan bakiye çekte kalır.

## Personel & hedefler

- Kullanıcı açma, rol, mağaza yetkisi, prim oranı.
- **Performans & prim**: dönem bazında fiş/çift/ciro/iade ve hak edilen prim.
- **Hedefler**: firma / mağaza / personel aylık ciro hedefi; panelde ilerleme çubuğu.
- **Mesai**: giriş/çıkış ve saat toplamı.

## Raporlar

Satış özeti (gün/saat/mağaza/ödeme), ürün performansı (marka, kategori, cinsiyet, sezon, renk, numara, tedarikçi), numara analizi (asorti önerisi), stok değeri, ölü stok, devir hızı, kâr/zarar (giderler dahil), KDV. Her tablo **Excel**'e iner.

## Ayarlar

Firma bilgileri (fatura için VKN/vergi dairesi), mağazalar & depo, kasa kuralları (kasa açık olmadan satış, eksi stok, kasiyer indirim sınırı, danışman zorunluluğu, puan yüzdesi, iade süresi, ölü stok eşiği), fiş başlık/alt yazı, etiket ölçüsü, otomatik mesaj metinleri, numara serileri, yedek alma ve tüm veriyi indirme, şifre değiştirme.

## Entegrasyonlar (Ayarlar → Entegrasyonlar)

Her sağlayıcı önce **Test** modunda açılır: dış sisteme hiçbir şey gitmez, işler *Gönderim kuyruğu*nda "simüle" olarak görünür ve içeriği incelenebilir. Sağlayıcıdan aldığınız bilgileri girip **Canlı** yapınca gerçek gönderim başlar. Hata alan işler otomatik tekrar denenir; kuyruktan elle de tekrar edilebilir.

| Sağlayıcı | Ne gerekir |
|---|---|
| e-Fatura / e-Arşiv | Özel entegratörünüzden (Uyumsoft, Logo, Paraşüt, EDM, İzibiz…) API adresi, kullanıcı, şifre; firma VKN ve unvanı; fatura seri öneki. Kasada "e-Fatura kes" kutusu veya ayarlardan her satışa otomatik. |
| Yazarkasa POS (ÖKC) | Cihaz üreticisinin mağaza PC'sine kurduğu yerel köprü servisinin adresi ve terminal no. Her satış cihaza gönderilir, mali fişi cihaz keser. |
| SMS | Netgsm kullanıcı kodu/şifre/başlık veya başka firmanın HTTP adresi. İYS onaylı başlık gerekir. |
| WhatsApp | Meta WhatsApp Business Cloud API telefon numarası ID ve erişim anahtarı; 24 saat kuralı için onaylı şablon adı. |
| Trendyol / Hepsiburada / N11 | Satıcı paneli API bilgileri. "Pazaryeri stok mağazası" seçin; ürün kartında "Pazaryerlerine stok gönder" işaretli ürünlerin stoğu/fiyatı barkod üzerinden gider, yeni siparişler 5 dakikada bir çekilip stoktan düşer. |

## Sık sorulanlar

- **Fiyat neden KDV dahil?** Perakende etiket fiyatı KDV dahildir; raporlarda KDV ayrıştırılır (ayakkabıda %10).
- **Alış fiyatı nereden gelir?** Mal kabulde girilen son birim alış; kâr hesapları satış anındaki maliyetle yapılır.
- **Aynı ürün iki barkodla mı var?** Her renk-numara tek barkod. Üretici barkodu varsa ürün sayfasından o barkodu yazın; iç barkod gerekmez.
- **İnternet kesilirse?** Uygulama sunucuda çalıştığı için kasa internet ister. Mobil hotspot yedeği bulundurun; entegrasyon gönderimleri kuyrukta beklediği için kaybolmaz.
