import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, DateRange, Empty, Modal, PageHead, Search, Spinner, StoreSelect, Tabs, type Range } from '../components';
import { useLoad, useSession } from '../store';
import { addDays, downloadCsv, fmtDateTime, tl, today } from '../util';

export default function Stock() {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('filtre') === 'kritik' ? 'low' : 'list');
  return (
    <div>
      <PageHead title="Stok Durumu" />
      <Tabs tabs={[{ key: 'list', label: 'Stok listesi' }, { key: 'low', label: 'Eksik numara / kritik' }, { key: 'moves', label: 'Stok hareketleri' }, { key: 'adjust', label: 'Fire / düzeltme' }]} value={tab} onChange={setTab} />
      {tab === 'list' && <StockList />}
      {tab === 'low' && <LowStock />}
      {tab === 'moves' && <Movements />}
      {tab === 'adjust' && <Adjust />}
    </div>
  );
}

function StockList() {
  const { session } = useSession();
  const [q, setQ] = useState('');
  const [store, setStore] = useState<number | 'all'>('all');
  const [positive, setPositive] = useState(true);
  const { data, loading } = useLoad(() => api.get('/stock', { q, storeId: store === 'all' ? undefined : store, positive: positive ? '1' : '0', limit: 3000 }), [q, store, positive]);
  const rows: any[] = data ?? [];
  const stores = session?.stores.filter((s) => store === 'all' || s.id === store) ?? [];
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}><div className="row"><Search value={q} onChange={setQ} placeholder="Kod, ad, barkod, renk" autoFocus /><StoreSelect value={store} onChange={setStore} all /><label className="check"><input type="checkbox" checked={positive} onChange={(e) => setPositive(e.target.checked)} /> Sadece stokta olanlar</label><span className="grow" /><button className="btn secondary" onClick={() => downloadCsv('stok', rows.map((r) => ({ ...r, ...Object.fromEntries(stores.map((s) => [s.code, r.stores[s.id] ?? 0])) })), [{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'color', label: 'Renk' }, { key: 'size', label: 'Numara' }, { key: 'barcode', label: 'Barkod' }, ...stores.map((s) => ({ key: s.code, label: s.name })), { key: 'total', label: 'Toplam' }, { key: 'price', label: 'Fiyat (kuruş)' }])}>⬇ Excel</button></div></div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>Kod</th><th>Ürün</th><th>Renk</th><th>No</th><th>Barkod</th>{stores.map((s) => <th key={s.id} className="num">{s.code}</th>)}<th className="num">Toplam</th><th className="num">Fiyat</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="bold"><Link to={`/urunler/${r.product_id}`}>{r.code}</Link></td><td>{r.name} <span className="muted small">{r.brand}</span></td><td>{r.color}</td><td className="bold">{r.size}</td><td className="mono small">{r.barcode}</td>{stores.map((s) => <td key={s.id} className="num">{r.stores[s.id] ?? 0}</td>)}<td className="num bold">{r.total}</td><td className="num">{tl(r.price)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={5}>{rows.length} varyant</td>{stores.map((s) => <td key={s.id} className="num">{rows.reduce((a, r) => a + (r.stores[s.id] ?? 0), 0)}</td>)}<td className="num">{rows.reduce((a, r) => a + r.total, 0)}</td><td /></tr></tfoot>
      </table></div>}</div>
    </div>
  );
}

function LowStock() {
  const [store, setStore] = useState<number | 'all'>('all');
  const { data, loading } = useLoad(() => api.get('/reports/low-stock', { storeId: store === 'all' ? undefined : store }), [store]);
  const rows: any[] = data ?? [];
  return (
    <div>
      <div className="alert info" style={{ marginBottom: 12 }}>Mağazada satılan ama numarası tükenen/azalan ürünler. "Diğer mağazalar" sütununda stok varsa transfer isteyin; yoksa tedarikçiye sipariş verin.</div>
      <div className="card" style={{ marginBottom: 12 }}><div className="row"><StoreSelect value={store} onChange={setStore} all includeWarehouse={false} /><span className="grow" /><Link to="/transferler" className="btn secondary">Transfer talebi →</Link><Link to="/satin-alma" className="btn secondary">Sipariş ver →</Link></div></div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty text="Kritik stok yok 👍" /> : <div className="table-wrap"><table>
        <thead><tr><th>Mağaza</th><th>Kod</th><th>Ürün</th><th>Renk</th><th>No</th><th className="num">Stok</th><th className="num">Kritik</th><th className="num">30 gün satış</th><th className="num">Diğer mağazalar</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.store_name}</td><td className="bold"><Link to={`/urunler/${r.product_id}`}>{r.code}</Link></td><td>{r.name}</td><td>{r.color}</td><td className="bold">{r.size}</td><td className="num"><Badge kind={r.qty <= 0 ? 'danger' : 'warn'}>{r.qty}</Badge></td><td className="num muted">{r.min_stock}</td><td className="num">{r.sold30}</td><td className="num">{r.other_stores_qty > 0 ? <Badge kind="ok">{r.other_stores_qty} var</Badge> : <span className="muted">yok</span>}</td></tr>)}</tbody>
      </table></div>}</div>
    </div>
  );
}

const MOVE: Record<string, string> = { purchase: 'Mal kabul', sale: 'Satış', return: 'İade', transfer_out: 'Transfer çıkış', transfer_in: 'Transfer giriş', count: 'Sayım farkı', damage: 'Fire / defolu', manual: 'Elle düzeltme', opening: 'Açılış stoğu', marketplace: 'Pazaryeri satışı' };

function Movements() {
  const [range, setRange] = useState<Range>({ from: addDays(today(), -6), to: today() });
  const [store, setStore] = useState<number | 'all'>('all');
  const [type, setType] = useState('');
  const { data, loading } = useLoad(() => api.get('/stock/movements', { from: range.from, to: range.to, storeId: store === 'all' ? undefined : store, type: type || undefined, limit: 2000 }), [range, store, type]);
  const rows: any[] = data ?? [];
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}><div className="row"><StoreSelect value={store} onChange={setStore} all /><select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }}><option value="">Tüm hareketler</option>{Object.entries(MOVE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><DateRange value={range} onChange={setRange} /></div></div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Mağaza</th><th>Hareket</th><th>Ürün</th><th>Renk / No</th><th className="num">Adet</th><th>Not</th><th>Kullanıcı</th></tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}><td className="nowrap">{fmtDateTime(m.created_at)}</td><td>{m.store_name}</td><td>{MOVE[m.type] ?? m.type}</td><td><b>{m.code}</b> {m.name}</td><td>{m.color} · {m.size}</td><td className={'num bold ' + (m.qty > 0 ? 'ok' : 'danger')}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td className="small">{m.note}</td><td>{m.user_name}</td></tr>)}</tbody>
      </table></div>}</div>
    </div>
  );
}

/** Fire / elle düzeltme / açılış stoğu girişi: barkod okutarak liste oluştur */
function Adjust() {
  const { storeId, store, toast, can } = useSession();
  const [type, setType] = useState<'damage' | 'manual' | 'opening'>('damage');
  const [items, setItems] = useState<any[]>([]);
  const [scan, setScan] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  if (!can('stock.adjust')) return <div className="alert warn">Stok düzeltme yetkiniz yok.</div>;
  const add = async () => {
    try {
      const v = await api.get(`/pos/barcode/${scan.trim()}`);
      setItems((x) => { const ex = x.find((i) => i.id === v.id); return ex ? x.map((i) => (i.id === v.id ? { ...i, qty: i.qty + 1 } : i)) : [...x, { ...v, qty: 1, here: v.stock.find((s: any) => s.store_id === storeId)?.qty ?? 0 }]; });
      setScan('');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const submit = async () => {
    try {
      await api.post('/stock/adjust', { storeId, type, note, items: items.map((i) => ({ variantId: i.id, qty: i.qty })) });
      toast('Stok güncellendi');
      setItems([]); setNote(''); setConfirm(false);
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div className="card">
      <div className="row">
        <label className="f"><span>İşlem</span><select value={type} onChange={(e) => setType(e.target.value as any)} style={{ width: 'auto' }}><option value="damage">Fire / defolu (stoktan düş)</option><option value="manual">Elle düzeltme (+ / −)</option><option value="opening">Açılış stoğu (+)</option></select></label>
        <label className="f grow"><span>Mağaza: <b>{store?.name}</b> — barkod okutun</span><input value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autoFocus /></label>
      </div>
      {items.length > 0 && <table style={{ marginTop: 10 }}><thead><tr><th>Ürün</th><th>Renk / No</th><th className="num">Mevcut</th><th>Adet {type === 'manual' && '(eksi girilebilir)'}</th><th /></tr></thead><tbody>{items.map((i) => <tr key={i.id}><td><b>{i.code}</b> {i.name}</td><td>{i.color} · {i.size}</td><td className="num">{i.here}</td><td><input type="number" value={i.qty} onChange={(e) => setItems((x) => x.map((y) => (y.id === i.id ? { ...y, qty: Number(e.target.value) } : y)))} style={{ width: 90 }} /></td><td><button className="btn ghost sm" onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))}>✕</button></td></tr>)}</tbody></table>}
      <div className="row" style={{ marginTop: 10 }}><input placeholder="Açıklama (zorunlu: örn. topuğu kırık, kayıp)" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn" disabled={!items.length} onClick={() => setConfirm(true)}>Uygula</button></div>
      {confirm && <Modal title="Stok düzeltmesini onayla" onClose={() => setConfirm(false)} narrow footer={<><button className="btn secondary" onClick={() => setConfirm(false)}>Vazgeç</button><button className="btn danger" onClick={submit}>Uygula</button></>}>{items.length} kalem, {store?.name} mağazasında {type === 'damage' ? 'stoktan düşülecek' : 'güncellenecek'}. Bu işlem kayıt altına alınır.</Modal>}
    </div>
  );
}
