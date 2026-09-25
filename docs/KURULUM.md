# Kurulum Kılavuzu

Bu kılavuz, uygulamayı bir bulut sunucusuna (Hetzner, DigitalOcean, Turhost, Natro, AWS Lightsail vb.) 10–15 dakikada kurmanız içindir. Teknik bilgi gerektirmez; komutları sırasıyla kopyalayıp yapıştırın.

## 1. Sunucu kiralayın

- **İşletim sistemi:** Ubuntu 22.04 veya 24.04
- **Boyut:** 1 CPU / 2 GB RAM / 20 GB disk, 10 mağazaya kadar fazlasıyla yeter (aylık ~5–8 €). Zincirler için 2 CPU / 4 GB.
- Sunucunun **IP adresini** ve **root şifresini/anahtarını** not edin.
- (İsteğe bağlı ama önerilir) Bir alan adı alın ve `magaza.firmaniz.com` gibi bir alt alan adını sunucu IP'sine yönlendirin (A kaydı). Böylece HTTPS otomatik kurulur.

## 2. Sunucuya bağlanın

Windows'ta **PowerShell**, Mac'te **Terminal** açın:

```bash
ssh root@SUNUCU_IP
```

## 3. Docker'ı kurun (tek komut)

```bash
curl -fsSL https://get.docker.com | sh
```

## 4. Uygulamayı indirin

```bash
apt-get install -y git
git clone https://github.com/emrullahkara/DC-Ayakkab--satis.git dc-ayakkabi
cd dc-ayakkabi
cp .env.example .env
nano .env
```

`.env` dosyasında en az şunu değiştirin:

```
ADMIN_PASSWORD=BurayaGucluBirSifre!2026
```

Alan adınız varsa:

```
DOMAIN=magaza.firmaniz.com
COOKIE_SECURE=1
```

Kaydetmek için `Ctrl+O`, `Enter`, çıkmak için `Ctrl+X`.

## 5. Başlatın

Alan adı **yoksa** (IP ile kullanacaksanız):

```bash
docker compose up -d --build
```

Tarayıcıda `http://SUNUCU_IP:3000` adresine gidin.

Alan adı **varsa** (otomatik HTTPS):

```bash
docker compose --profile https up -d --build
```

Tarayıcıda `https://magaza.firmaniz.com` adresine gidin. İlk sertifika 1–2 dakika içinde alınır.

## 6. İlk giriş ve firma açma

1. Giriş ekranında: firma kodu **sistem**, kullanıcı **admin**, şifre `.env` dosyasındaki `ADMIN_PASSWORD`.
2. Sol menüden **Firmalar (Lisans)** → **Yeni firma**. Firma kodu (örn. `kara-ayakkabi`), firma adı, mağaza sayısı, lisans bitiş tarihi, ilk patron kullanıcısı ve ilk mağazayı girin.
3. Çıkış yapıp o firmanın koduyla, patron kullanıcısıyla giriş yapın.
4. **Ayarlar → Mağazalar**'dan diğer şubeleri ve depoyu ekleyin; **Personel**'den kullanıcıları açın.
5. Ürünleri **Ürünler → Excel'den aktar** ile ya da tek tek girin; açılış stoklarını **Stok → Fire / düzeltme → Açılış stoğu** ile veya Excel'deki `adet` sütunuyla yükleyin.

Uygulamayı **tanıtım amaçlı** görmek için `.env` içinde `DEMO_DATA=1` yapıp yeniden başlatın: `demo / patron / demo123` ile örnek verili bir firma açılır.

## 7. Günlük kullanım için cihazlar

- **Kasa bilgisayarı:** Herhangi bir tarayıcı (Chrome önerilir). Sayfayı tam ekran (F11) yapın.
- **Barkod okuyucu:** USB "klavye modu" okuyucular ek ayar gerektirmez; kasa ekranında barkod kutusuna okutun. Enter göndermesi açık olmalı (çoğunda varsayılan).
- **Fiş yazıcı:** 80 mm termal yazıcı. Windows'ta yazıcı sürücüsünü kurun; ilk yazdırmada Chrome'un yazdırma penceresinde yazıcıyı seçip "kenar boşluğu: yok" yapın. **Ayarlar → Fiş & etiket** → "satış sonrası fiş penceresi otomatik açılsın" işaretleyin.
- **Etiket yazıcı:** 40×30 mm (veya ayarlardan başka ölçü) etiket; Ürünler → seçim → **Etiket**.
- **Tablet / telefon:** Aynı adresi açın; Chrome menüsünden **Ana ekrana ekle** deyin, uygulama gibi çalışır.

## 8. Yedekleme

- Uygulama **her 6 saatte bir** otomatik yedek alır (son 14 yedek saklanır). Ayrıca **Ayarlar → Yedek & veri → Şimdi yedek al**.
- Yedekler sunucudaki Docker biriminde: `/var/lib/docker/volumes/dc-ayakkabi_dc-data/_data/backups/`
- Sunucu dışına kopyalamak için (kendi bilgisayarınızdan):

  ```bash
  scp -r root@SUNUCU_IP:/var/lib/docker/volumes/dc-ayakkabi_dc-data/_data/backups ./yedekler
  ```

- Bir yedeği geri yüklemek için: uygulamayı durdurun (`docker compose down`), yedek dosyasını `.../_data/dc-ayakkabi.db` üzerine kopyalayın, tekrar başlatın.

## 9. Güncelleme

```bash
cd dc-ayakkabi
git pull
docker compose up -d --build        # (https kullanıyorsanız --profile https ekleyin)
```

Veriler Docker biriminde kalır, silinmez.

## 10. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Sayfa açılmıyor | `docker compose ps` ile "running" olduğuna bakın; `docker compose logs -f app` ile hatayı görün. Sunucu güvenlik duvarında 3000 (veya 80/443) portu açık olmalı. |
| "ADMIN_PASSWORD tanımlanmalı" | `.env` dosyasında `ADMIN_PASSWORD=` satırını doldurun. |
| Şifre unutuldu | Firma kullanıcıları için: sistem yöneticisi → Firmalar → **Şifre sıfırla**. Admin dahil herhangi biri için sunucuda: `docker compose exec app node scripts/sifre-sifirla.mjs <firma-kodu> <kullanici> <yeni-sifre>` (örn. `sistem admin YeniSifre123`). |
| HTTPS sertifikası alınmıyor | DNS A kaydı sunucu IP'sini göstermeli ve 80/443 portları açık olmalı. `docker compose logs caddy`. |
| Saat/tarih yanlış | Konteyner `Europe/Istanbul` saatinde çalışır; sunucu saati NTP ile doğru olmalı (`timedatectl`). |

## Docker olmadan (doğrudan Node.js) kurulum

```bash
# Node.js 22 kurulu bir makinede
git clone https://github.com/emrullahkara/DC-Ayakkab--satis.git && cd DC-Ayakkab--satis
npm ci
npm run build
cd server
ADMIN_PASSWORD=GucluSifre DATA_DIR=/var/dc-ayakkabi PORT=3000 node dist/index.js
```

Sürekli çalışması için `pm2` veya bir `systemd` servisi kullanın:

```ini
# /etc/systemd/system/dc-ayakkabi.service
[Unit]
Description=DC Ayakkabi Satis
After=network.target
[Service]
WorkingDirectory=/opt/dc-ayakkabi/server
Environment=NODE_ENV=production ADMIN_PASSWORD=GucluSifre DATA_DIR=/var/dc-ayakkabi PORT=3000 TZ=Europe/Istanbul
ExecStart=/usr/bin/node dist/index.js
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```

## Ortam değişkenleri

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `ADMIN_PASSWORD` | İlk kurulumda sistem yöneticisi şifresi | (verilmezse üretilir ve konsola yazılır) |
| `JWT_SECRET` | Oturum imza anahtarı | `DATA_DIR/.jwt-secret` içinde üretilir |
| `DATA_DIR` | Veritabanı ve yedek klasörü | `./data` (Docker: `/data`) |
| `PORT` | Dinlenen port | `3000` |
| `DEMO_DATA` | `1` ise demo firması oluşturur | `0` |
| `COOKIE_SECURE` | HTTPS arkasında `1` | `0` |
| `BACKUP_KEEP` | Saklanacak yedek sayısı | `14` |
| `TZ` | Saat dilimi | `Europe/Istanbul` |
