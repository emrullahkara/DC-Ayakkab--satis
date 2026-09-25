# Uygulamayı Başka Firmalara Satma ve Lisans Yönetimi

Uygulama **çok kiracılı**dır: tek sunucuda istediğiniz kadar ayakkabı firması barındırabilirsiniz; her firma yalnızca kendi verisini görür.

## Yeni müşteri (firma) açma

1. `sistem / admin` ile giriş yapın → **Firmalar (Lisans)** → **Yeni firma**.
2. Doldurun: firma kodu (müşteriye vereceğiniz giriş kodu, örn. `yildiz-ayakkabi`), unvan, paket, en fazla mağaza sayısı, lisans bitiş tarihi, patron kullanıcı adı/şifresi, ilk mağaza.
3. Müşteriye üç bilgiyi verin: **adres** (https://magaza.firmaniz.com), **firma kodu**, **kullanıcı adı ve şifre**. Gerisini kendisi Ayarlar'dan yapar (mağaza ekleme, personel açma, ürün yükleme).

## Paketler (öneri)

| Paket | Mağaza | Öne çıkan |
|---|---|---|
| Başlangıç | 1 | Kasa, stok, müşteri, raporlar |
| Standart | 2–5 | + transfer, sayım, kampanya, SMS |
| Pro | 6–15 | + e-Fatura, pazaryeri, WhatsApp |
| Zincir | 16+ | Hepsi + öncelikli destek |

Paket adı bilgi amaçlıdır; sınırı **en fazla mağaza** ve **lisans bitiş** alanları uygular. Lisans dolunca firma kullanıcıları giriş yapamaz, veri silinmez; tarihi uzatınca devam eder. **Aktif** kutusunu kaldırırsanız firma anında kapanır (ödeme yapmayan müşteri için).

## Tanıtım (demo)

Sunucuda `DEMO_DATA=1` ile açılan `demo` firması 3 mağaza + depo, 12 model, 60 müşteri ve 60 günlük satış geçmişiyle gelir. Müşteri adayına `demo / patron / demo123` ile gezdirin. Her tanıtımdan sonra temizlemek isterseniz: `docker compose down`, veri biriminden `dc-ayakkabi.db` silin (dikkat: diğer firmalar da silinir — demo için ayrı bir sunucu/konteyner kullanmak daha güvenlidir).

## Her müşteriye ayrı sunucu mu, tek sunucu mu?

- **Tek sunucu, çok firma:** en ucuz ve yönetimi kolay. 2 CPU / 4 GB bir sunucu 30–50 firmayı rahat taşır.
- **Ayrı sunucu:** verisini kesinlikle ayrı isteyen büyük zincirler için; aynı kurulum adımlarını tekrar edin.

## Destek ve veri talepleri

- Şifre sıfırlama: Firmalar → **Şifre sıfırla** (kullanıcı adı + yeni şifre). Sistem yöneticisinin kendi şifresi için sunucuda: `docker compose exec app node scripts/sifre-sifirla.mjs sistem admin YeniSifre`.
- Müşteri verisini isterse: firma patronu **Ayarlar → Yedek & veri → Tüm veriyi indir** ile JSON alır.
- İşlem kayıtları (kim ne yaptı) firma patronunun **İşlem Kayıtları** ekranında; anlaşmazlıklarda kaynak budur.

## Fiyatlandırma notu

Sunucu maliyeti aylık ~5–10 € olduğundan, firma başına aylık abonelik + kurulum/eğitim ücreti modeli uygundur. Lisans bitiş tarihini abonelik dönemiyle eşleyin; ödeme gelince tarihi uzatın.
