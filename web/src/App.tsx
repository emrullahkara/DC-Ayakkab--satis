import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './store';
import { Spinner } from './components';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pos from './pages/Pos';
import Sales from './pages/Sales';
import Register from './pages/Register';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Stock from './pages/Stock';
import Transfers from './pages/Transfers';
import Counts from './pages/Counts';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import CustomerOrders from './pages/CustomerOrders';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import Campaigns from './pages/Campaigns';
import GiftCards from './pages/GiftCards';
import Staff from './pages/Staff';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Integrations from './pages/Integrations';
import Audit from './pages/Audit';
import Tasks from './pages/Tasks';
import Admin from './pages/Admin';
import Receipt from './pages/Receipt';
import Labels from './pages/Labels';

const NAV: { group: string; items: { to: string; label: string; ico: string; perm: string[] }[] }[] = [
  { group: 'Satış', items: [
    { to: '/', label: 'Kontrol Paneli', ico: '📊', perm: ['dashboard'] },
    { to: '/kasa', label: 'Kasa / Satış', ico: '🛒', perm: ['pos'] },
    { to: '/satislar', label: 'Satışlar & İade', ico: '🧾', perm: ['sales.view'] },
    { to: '/kasa-islemleri', label: 'Kasa Açma/Kapama', ico: '💵', perm: ['register', 'cash.movements'] },
    { to: '/hediye-cekleri', label: 'Hediye Çekleri', ico: '🎁', perm: ['giftcards'] },
  ] },
  { group: 'Ürün & Stok', items: [
    { to: '/urunler', label: 'Ürünler', ico: '👟', perm: ['products.view'] },
    { to: '/stok', label: 'Stok Durumu', ico: '📦', perm: ['stock.view'] },
    { to: '/transferler', label: 'Transferler', ico: '🔁', perm: ['transfers'] },
    { to: '/sayim', label: 'Stok Sayımı', ico: '📋', perm: ['counts'] },
    { to: '/satin-alma', label: 'Satın Alma / Mal Kabul', ico: '🚚', perm: ['purchases'] },
    { to: '/tedarikciler', label: 'Tedarikçiler', ico: '🏭', perm: ['suppliers'] },
    { to: '/kampanyalar', label: 'Kampanyalar', ico: '🏷️', perm: ['campaigns'] },
  ] },
  { group: 'Müşteri', items: [
    { to: '/musteriler', label: 'Müşteriler', ico: '👥', perm: ['customers'] },
    { to: '/siparisler', label: 'Müşteri Siparişleri', ico: '📝', perm: ['customer_orders'] },
  ] },
  { group: 'Yönetim', items: [
    { to: '/raporlar', label: 'Raporlar', ico: '📈', perm: ['reports'] },
    { to: '/personel', label: 'Personel & Hedefler', ico: '🧑‍💼', perm: ['staff'] },
    { to: '/gorevler', label: 'Görevler / Notlar', ico: '✅', perm: ['tasks'] },
    { to: '/ayarlar', label: 'Ayarlar', ico: '⚙️', perm: ['settings'] },
    { to: '/ayarlar/entegrasyonlar', label: 'Entegrasyonlar', ico: '🔌', perm: ['integrations'] },
    { to: '/kayitlar', label: 'İşlem Kayıtları', ico: '🗂️', perm: ['audit'] },
  ] },
];

function Layout({ children }: { children: ReactNode }) {
  const { session, logout, storeId, setStoreId, can, toasts } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!session) return null;
  const title = NAV.flatMap((g) => g.items).find((i) => i.to === loc.pathname)?.label ?? 'DC Ayakkabı';
  return (
    <div className="app">
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand"><img src="/icon.svg" alt="" />DC Ayakkabı</div>
        <div className="tenant">{session.tenant.name}</div>
        <nav>
          {NAV.map((g) => {
            const items = g.items.filter((i) => can(...i.perm));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="group">{g.group}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                    <span className="ico">{i.ico}</span>{i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
          {session.user.isSuperadmin && (
            <div><div className="group">Sistem</div><NavLink to="/sistem" className={({ isActive }) => (isActive ? 'active' : '')}><span className="ico">🏢</span>Firmalar (Lisans)</NavLink></div>
          )}
        </nav>
        <div className="foot">
          <div className="bold">{session.user.name}</div>
          <div className="small" style={{ opacity: 0.8 }}>{session.user.roleLabel}</div>
          <button className="btn ghost sm" style={{ color: '#fff', paddingLeft: 0, marginTop: 6 }} onClick={logout}>Çıkış yap</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn secondary sm hamburger" onClick={() => setOpen(!open)}>☰</button>
          <span className="title">{title}</span>
          <span className="grow" />
          {session.stores.length > 1 && (
            <select value={storeId ?? ''} onChange={(e) => setStoreId(Number(e.target.value))} style={{ width: 'auto', minHeight: 34 }}>
              {session.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {session.stores.length === 1 && <span className="muted hide-mobile">{session.stores[0].name}</span>}
        </div>
        <div className="content">{children}</div>
      </div>
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}</div>
    </div>
  );
}

function Guard({ perm, children }: { perm?: string[]; children: ReactNode }) {
  const { can } = useSession();
  if (perm && !can(...perm)) return <div className="alert warn">Bu sayfa için yetkiniz yok.</div>;
  return <>{children}</>;
}

function Shell() {
  const { session, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!session) return <Login />;
  if (loc.pathname.startsWith('/yazdir/')) {
    return (
      <Routes>
        <Route path="/yazdir/fis/:id" element={<Receipt />} />
        <Route path="/yazdir/etiket" element={<Labels />} />
      </Routes>
    );
  }
  const p = (perm: string[], el: ReactNode) => <Guard perm={perm}>{el}</Guard>;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={p(['dashboard'], <Dashboard />)} />
        <Route path="/kasa" element={p(['pos'], <Pos />)} />
        <Route path="/satislar" element={p(['sales.view'], <Sales />)} />
        <Route path="/kasa-islemleri" element={p(['register', 'cash.movements'], <Register />)} />
        <Route path="/hediye-cekleri" element={p(['giftcards'], <GiftCards />)} />
        <Route path="/urunler" element={p(['products.view'], <Products />)} />
        <Route path="/urunler/:id" element={p(['products.view'], <ProductDetail />)} />
        <Route path="/stok" element={p(['stock.view'], <Stock />)} />
        <Route path="/transferler" element={p(['transfers'], <Transfers />)} />
        <Route path="/sayim" element={p(['counts'], <Counts />)} />
        <Route path="/satin-alma" element={p(['purchases'], <Purchases />)} />
        <Route path="/tedarikciler" element={p(['suppliers'], <Suppliers />)} />
        <Route path="/kampanyalar" element={p(['campaigns'], <Campaigns />)} />
        <Route path="/musteriler" element={p(['customers'], <Customers />)} />
        <Route path="/musteriler/:id" element={p(['customers'], <CustomerDetail />)} />
        <Route path="/siparisler" element={p(['customer_orders'], <CustomerOrders />)} />
        <Route path="/raporlar" element={p(['reports'], <Reports />)} />
        <Route path="/personel" element={p(['staff'], <Staff />)} />
        <Route path="/gorevler" element={p(['tasks'], <Tasks />)} />
        <Route path="/ayarlar" element={p(['settings'], <Settings />)} />
        <Route path="/ayarlar/entegrasyonlar" element={p(['integrations'], <Integrations />)} />
        <Route path="/kayitlar" element={p(['audit'], <Audit />)} />
        <Route path="/sistem" element={session.user.isSuperadmin ? <Admin /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </SessionProvider>
  );
}
