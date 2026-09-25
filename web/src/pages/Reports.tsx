import { useState } from 'react';
import { api } from '../api';
import { Bars, DateRange, Empty, PageHead, Spinner, StoreSelect, Tabs, type Range } from '../components';
import { useLoad, useSession } from '../store';
import { downloadCsv, fmtDate, num, pct, tl, today, PAY } from '../util';

const TABS = [
  { key: 'summary', label: 'Satış özeti' }, { key: 'products', label: 'Ürün performansı' }, { key: 'size', label: 'Numara analizi' },
  { key: 'stock', label: 'Stok değeri' }, { key: 'dead', label: 'Ölü stok' }, { key: 'sell', label: 'Devir hızı' }, { key: 'pnl', label: 'Kâr / Zarar' }, { key: 'vat', label: 'KDV' },
];

export default function Reports() {
  const [tab, setTab] = useState('summary');
  const [range, setRange] = useState<Range>({ from: today().slice(0, 8) + '01', to: today() });
  const [store, setStore] = useState<number | 'all'>('all');
  const p = { from: range.from, to: range.to, storeId: store === 'all' ? undefined : store };
  return (
    <div>
      <PageHead title="Raporlar" />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="card" style={{ marginBottom: 12 }}><div className="row"><StoreSelect value={store} onChange={setStore} all /><DateRange value={range} onChange={setRange} /></div></div>
      {tab === 'summary' && <Summary p={p} />}
      {tab === 'products' && <ProductPerf p={p} />}
      {tab === 'size' && <SizeCurve p={p} />}
      {tab === 'stock' && <Simple url="/reports/stock-value" p={p} cols={[['store_name', 'Mağaza'], ['models', 'Model', 'n'], ['pairs', 'Çift', 'n'], ['cost_value', 'Maliyet değeri', 'tl'], ['sale_value', 'Satış değeri', 'tl']]} note="Stoktaki ürünlerin alış (KDV hariç) ve satış (KDV dahil) fiyatı üzerinden değeri." />}
      {tab === 'dead' && <Simple url="/reports/dead-stock" p={p} cols={[['code', 'Kod'], ['name', 'Ürün'], ['brand', 'Marka'], ['season', 'Sezon'], ['qty', 'Stok', 'n'], ['sale_price', 'Fiyat', 'tl'], ['cost_value', 'Bağlı para', 'tl'], ['last_sale', 'Son satış', 'd'], ['first_in', 'İlk giriş', 'd']]} note="Ayarlardaki gün sayısı kadar süredir hiç satılmayan, stokta bekleyen modeller. İndirim veya mağazalar arası transfer düşünün." />}
      {tab === 'sell' && <SellThrough p={p} />}
      {tab === 'pnl' && <Pnl p={p} />}
      {tab === 'vat' && <Simple url="/reports/vat" p={p} cols={[['rate', 'KDV %', 'n'], ['net', 'Matrah', 'tl'], ['vat', 'KDV', 'tl'], ['gross', 'Toplam', 'tl']]} note="Satış ve iadelerin KDV oranına göre dökümü (muhasebeciniz için)." />}
    </div>
  );
}

function Summary({ p }: { p: any }) {
  const { data: s } = useLoad(() => api.get('/reports/summary', p), [p]);
  const { data: days } = useLoad(() => api.get('/reports/by-day', p), [p]);
  const { data: stores } = useLoad(() => api.get('/reports/by-store', p), [p]);
  const { data: hours } = useLoad(() => api.get('/reports/by-hour', p), [p]);
  const { data: pays } = useLoad(() => api.get('/reports/by-payment', p), [p]);
  if (!s) return <Spinner />;
  return <div className="col" style={{ gap: 14 }}>
    <div className="grid c4">
      <div className="stat accent"><div className="label">Ciro</div><div className="value">{tl(s.revenue)}</div><div className="sub">{s.receipts} fiş · {s.pairs} çift · {s.customers} kayıtlı müşteri</div></div>
      <div className="stat"><div className="label">Ortalama sepet</div><div className="value">{tl(s.avg_basket)}</div><div className="sub">fiş başına</div></div>
      <div className="stat"><div className="label">İndirim</div><div className="value">{tl(s.discount)}</div><div className="sub">İade: {tl(s.returns_amount)} ({s.returns_count} işlem)</div></div>
      {s.profit !== undefined ? <div className="stat"><div className="label">Brüt kâr</div><div className="value ok">{tl(s.profit)}</div><div className="sub">marj {pct(s.margin)} · maliyet {tl(s.cost)}</div></div> : <div className="stat"><div className="label">KDV</div><div className="value">{tl(s.vat)}</div></div>}
    </div>
    <div className="grid c2">
      <div className="card"><h2>Günlük ciro</h2>{days?.length ? <Bars data={days.map((d: any) => ({ label: fmtDate(d.day), value: d.revenue }))} /> : <Empty />}</div>
      <div className="card"><h2>Saatlere göre (yoğunluk)</h2>{hours?.length ? <Bars data={Array.from({ length: 14 }, (_, i) => i + 9).map((h) => ({ label: h + ':00', value: hours.find((x: any) => x.hour === h)?.receipts ?? 0 }))} valueLabel={(v) => v + ' fiş'} /> : <Empty />}</div>
    </div>
    <div className="grid c2">
      <div className="card"><h2>Mağazalar <button className="btn secondary sm" onClick={() => downloadCsv('magazalar', stores ?? [])}>⬇</button></h2><table><thead><tr><th>Mağaza</th><th className="num">Fiş</th><th className="num">Çift</th><th className="num">Ciro</th>{stores?.[0]?.profit !== undefined && <th className="num">Kâr</th>}</tr></thead><tbody>{(stores ?? []).map((r: any) => <tr key={r.id}><td>{r.name}</td><td className="num">{r.receipts}</td><td className="num">{r.pairs}</td><td className="num bold">{tl(r.revenue)}</td>{r.profit !== undefined && <td className="num">{tl(r.profit)}</td>}</tr>)}</tbody></table></div>
      <div className="card"><h2>Ödeme türleri</h2><table><tbody>{(pays ?? []).map((r: any) => <tr key={r.method}><td>{PAY[r.method]}</td><td className="num">{r.n} işlem</td><td className="num bold">{tl(r.amount)}</td></tr>)}</tbody></table></div>
    </div>
  </div>;
}

function ProductPerf({ p }: { p: any }) {
  const [groupBy, setGroupBy] = useState('product');
  const { data, loading } = useLoad(() => api.get('/reports/products', { ...p, groupBy, limit: 200 }), [p, groupBy]);
  const rows: any[] = data ?? [];
  return <div>
    <div className="row" style={{ marginBottom: 10 }}><div className="chips">{[['product', 'Ürün'], ['brand', 'Marka'], ['category', 'Kategori'], ['gender', 'Cinsiyet'], ['season', 'Sezon'], ['color', 'Renk'], ['size', 'Numara'], ['supplier', 'Tedarikçi']].map(([k, l]) => <button key={k} className={'chip' + (groupBy === k ? ' sel' : '')} onClick={() => setGroupBy(k)}>{l}</button>)}</div><span className="grow" /><button className="btn secondary sm" onClick={() => downloadCsv('urun-performans', rows)}>⬇ Excel</button></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
      <thead><tr><th>#</th><th>{groupBy === 'product' ? 'Ürün' : 'Grup'}</th><th className="num">Çift</th><th className="num">İade</th><th className="num">Ciro</th><th className="num">İndirim</th>{rows[0].profit !== undefined && <th className="num">Kâr</th>}<th style={{ width: 160 }}>Pay</th></tr></thead>
      <tbody>{rows.map((r, i) => { const max = rows[0].revenue || 1; return <tr key={i}><td className="muted">{i + 1}</td><td className="bold">{r.label}</td><td className="num">{r.pairs}</td><td className="num">{r.returned || ''}</td><td className="num bold">{tl(r.revenue)}</td><td className="num">{tl(r.discount)}</td>{r.profit !== undefined && <td className="num">{tl(r.profit)}</td>}<td><div className="hbar"><div style={{ width: (r.revenue / max) * 100 + '%' }} /></div></td></tr>; })}</tbody>
    </table></div>}</div>
  </div>;
}

function SizeCurve({ p }: { p: any }) {
  const { data, loading } = useLoad(() => api.get('/reports/size-curve', p), [p]);
  const rows: any[] = data ?? [];
  const totalSold = rows.reduce((a, r) => a + r.sold, 0) || 1;
  const totalStock = rows.reduce((a, r) => a + r.stock, 0) || 1;
  return <div className="card">
    <p className="small muted">Hangi numaralar satıyor, hangi numaralar stokta birikiyor? Satış payı stok payından belirgin yüksekse o numaradan daha fazla alın (asorti).</p>
    {loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <table><thead><tr><th>Numara</th><th className="num">Satılan</th><th className="num">Satış payı</th><th className="num">Stok</th><th className="num">Stok payı</th><th>Öneri</th></tr></thead><tbody>{rows.map((r) => { const sp = (r.sold / totalSold) * 100; const stp = (r.stock / totalStock) * 100; return <tr key={r.size}><td className="bold">{r.size}</td><td className="num">{r.sold}</td><td className="num">{pct(sp)}</td><td className="num">{r.stock}</td><td className="num">{pct(stp)}</td><td>{sp > stp * 1.5 && r.sold > 2 ? <span className="warn bold">Daha fazla al</span> : stp > sp * 2 && r.stock > 5 ? <span className="danger">Fazla stok</span> : <span className="ok">Dengeli</span>}</td></tr>; })}</tbody></table>}
  </div>;
}

function SellThrough({ p }: { p: any }) {
  const [groupBy, setGroupBy] = useState('season');
  const { data, loading } = useLoad(() => api.get('/reports/sell-through', { ...p, groupBy }), [p, groupBy]);
  const rows: any[] = data ?? [];
  return <div>
    <div className="row" style={{ marginBottom: 10 }}><div className="chips">{[['season', 'Sezon'], ['brand', 'Marka'], ['category', 'Kategori'], ['supplier', 'Tedarikçi']].map(([k, l]) => <button key={k} className={'chip' + (groupBy === k ? ' sel' : '')} onClick={() => setGroupBy(k)}>{l}</button>)}</div></div>
    <div className="card" style={{ padding: 0 }}><div className="small muted" style={{ padding: 10 }}>Devir (sell-through) = satılan ÷ (satılan + kalan stok). Düşükse ürün yavaş dönüyor; yüksekse yeniden sipariş zamanı.</div>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <table><thead><tr><th>Grup</th><th className="num">Satılan</th><th className="num">Ciro</th><th className="num">Kalan stok</th><th className="num">Devir</th><th style={{ width: 160 }} /></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td className="bold">{r.label}</td><td className="num">{r.pairs}</td><td className="num">{tl(r.revenue)}</td><td className="num">{r.stock}</td><td className="num bold">{pct(r.sell_through)}</td><td><div className={'hbar' + (r.sell_through < 30 ? ' warn' : '')}><div style={{ width: r.sell_through + '%' }} /></div></td></tr>)}</tbody></table>}</div>
  </div>;
}

function Pnl({ p }: { p: any }) {
  const { can } = useSession();
  const { data: d, loading } = useLoad(() => api.get('/reports/pnl', p), [p]);
  if (!can('costs.view')) return <div className="alert warn">Kâr/zarar raporu için maliyet görme yetkisi gerekir.</div>;
  if (loading || !d) return <Spinner />;
  const row = (l: string, v: number, cls = '', bold = false) => <tr className={bold ? 'bold' : ''}><td>{l}</td><td className={'num ' + cls}>{tl(v)}</td></tr>;
  return <div className="grid c2">
    <div className="card"><h2>Kâr / Zarar</h2><table><tbody>
      {row('Satış (KDV dahil)', d.revenue)}{row('KDV', -d.vat, 'muted')}{row('Net satış', d.revenueNet, '', true)}{row('Satılan malın maliyeti', -d.cost, 'danger')}{row('Brüt kâr', d.grossProfit, 'ok', true)}{row('Diğer gelirler', d.otherIncome)}{row('Giderler', -d.expenseTotal, 'danger')}{row('NET KÂR', d.netProfit, d.netProfit >= 0 ? 'ok' : 'danger', true)}
    </tbody></table><div className="small muted" style={{ marginTop: 8 }}>Personel maaşı, kira gibi giderleri kasadan "Gider" olarak girdiğinizde burada görünür. Marj: {pct(d.revenue ? ((d.revenue - d.cost) / d.revenue) * 100 : 0)}</div></div>
    <div className="card"><h2>Gider dağılımı</h2>{d.expenses.length === 0 ? <Empty text="Gider girilmemiş" /> : <table><tbody>{d.expenses.map((e: any) => <tr key={e.category}><td>{e.category}</td><td className="num">{tl(e.amount)}</td><td style={{ width: 120 }}><div className="hbar warn"><div style={{ width: (e.amount / d.expenseTotal) * 100 + '%' }} /></div></td></tr>)}</tbody></table>}</div>
  </div>;
}

function Simple({ url, p, cols, note }: { url: string; p: any; cols: [string, string, string?][]; note?: string }) {
  const { data, loading } = useLoad(() => api.get(url, p), [p, url]);
  const rows: any[] = data ?? [];
  const fmt = (v: any, t?: string) => (t === 'tl' ? tl(v) : t === 'n' ? num(v) : t === 'd' ? fmtDate(v) : v);
  return <div>
    {note && <div className="alert info" style={{ marginBottom: 10 }}>{note}<button className="btn secondary sm" style={{ marginLeft: 'auto' }} onClick={() => downloadCsv('rapor', rows, cols.map(([k, l]) => ({ key: k, label: l })))}>⬇ Excel</button></div>}
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table><thead><tr>{cols.filter(([k]) => rows[0][k] !== undefined).map(([k, l, t]) => <th key={k} className={t && t !== 'd' ? 'num' : ''}>{l}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{cols.filter(([k]) => rows[0][k] !== undefined).map(([k, , t]) => <td key={k} className={t && t !== 'd' ? 'num' : ''}>{fmt(r[k], t)}</td>)}</tr>)}</tbody>
      <tfoot><tr>{cols.filter(([k]) => rows[0][k] !== undefined).map(([k, , t], i) => <td key={k} className="num">{i === 0 ? 'Toplam' : t === 'tl' || t === 'n' ? fmt(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0), t) : ''}</td>)}</tr></tfoot></table></div>}</div>
  </div>;
}
