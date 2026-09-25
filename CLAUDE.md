# DC Ayakkabı Satış — geliştirici notları

- Monorepo (npm workspaces): `server/` (Express + SQLite, TypeScript ESM) ve `web/` (React + Vite).
- Para tutarları her yerde **kuruş cinsinden tam sayı**; satış fiyatları KDV dahil. Tarihler yerel saat (`datetime('now','localtime')`, TZ=Europe/Istanbul).
- Tüm sorgular `tenant_id` ile sınırlanır; mağaza erişimi `assertStore/storeFilter` ile kontrol edilir. Yeni uç nokta eklerken ikisini de uygula.
- Stok değişimi sadece `services/stock.ts` → `changeStock` üzerinden (hareket kaydı + pazaryeri kuyruğu).
- Dış sistemlere gidecek her şey `outbox` tablosuna yazılır; `integrations/worker.ts` işler. Test modunda gönderim yapılmaz.
- Komutlar: `npm run typecheck`, `npm test` (vitest, bellek içi DB), `npm run build`, `npm run seed:demo`.
- Arayüz metinleri Türkçe; hata mesajları kullanıcıya gösterildiği için anlaşılır yazılmalı.
