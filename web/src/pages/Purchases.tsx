import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, MoneyInput, PageHead, Spinner, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, fmtDateTime, tl } from '../util';

const ST: Record<string, [string, 'ok' | 'warn' | 'info' | 'danger' | '']> = { draft: ['Taslak', ''], ordered: ['Sipariş verildi', 'info'], partial: ['Kısmen geldi', 'warn'], received: ['Teslim alındı', 'ok'], cancelled: ['İptal', 'danger'] };

export default function Purchases() {
  const { toast } = useSession();
  const [tab, setTab] = useState('open');
  const [open, setOpen] = useState<number | null>(null);
  const [create, setCreate] = useState<'po' | 'quick' | null>(null);
  const { data, loading, reload } = useLoad(() => api.get('/purchase-orders'), []);
  const rows: any[] = (data ?? []).filter((p: any) => (tab === 'open' ? ['draft', 'ordered', 'partial'].includes(p.status) : ['received', 'cancelled'].includes(p.status)));
  return (
    <div>
      <PageHead title="Satın Alma & Mal Kabul"><button className="btn secondary" onClick={() => setCreate('quick')}>📦 Hızlı mal kabul (irsaliye ile gelen)</button><button className="btn" onClick={() => setCreate('po')}>+ Tedarikçiye sipariş</button></PageHead>
      <Tabs tabs={[{ key: 'open', label: 'Açık siparişler' }, { key: 'done', label: 'Tamamlanan' }]} value={tab} onChange={setTab} />
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>No</th><th>Tarih</th><th>Tedarikçi</th><th>Mağaza</th><th>Beklenen</th><th className="num">Sipariş</th><th className="num">Gelen</th><th className="num">Tutar</th><th>Durum</th></tr></thead>
        <tbody>{rows.map((p) => <tr key={p.id} className="click" onClick={() => setOpen(p.id)}><td className="bold">{p.order_no}</td><td>{fmtDate(p.created_at)}</td><td>{p.supplier_name}</td><td>{p.store_name}</td><td>{fmtDate(p.expected_date)}</td><td className="num">{p.qty_ordered}</td><td className="num">{p.qty_received}</td><td className="num">{tl(p.total)}</td><td><Badge kind={ST[p.status][1]}>{ST[p.status][0]}</Badge></td></tr>)}</tbody>
      </table></div>}</div>
      {create && <POForm quick={create === 'quick'} onClose={() => setCreate(null)} onDone={() => { setCreate(null); reload(); toast(create === 'quick' ? 'Mal kabul yapıldı, stok ve cari güncellendi' : 'Sipariş oluşturuldu'); }} />}
      {open && <PODetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function ItemPicker({ items, setItems, storeId }: { items: any[]; setItems: (f: (x: any[]) => any[]) => void; storeId: number }) {
  const { toast, can } = useSession();
  const [scan, setScan] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const push = (v: any) => { setItems((x) => (x.find((i) => i.id === v.id) ? x.map((i) => (i.id === v.id ? { ...i, qty: i.qty + 1 } : i)) : [...x, { ...v, qty: 1, unitCost: v.cost_price ?? 0 }])); setResults(null); setScan(''); };
  const add = async () => {
    const term = scan.trim();
    if (!term) return;
    try {
      if (/^\d{8,14}$/.test(term)) push(await api.get(`/pos/barcode/${term}`));
      else { const r = await api.get('/pos/search', { q: term, storeId }); if (!r.length) toast('Ürün bulunamadı', 'err'); else setResults(r); }
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const addAllSizes = (p: any, color: string) => { for (const v of p.variants.filter((v: any) => v.color === color)) push({ ...v, code: p.code, name: p.name }); };
  return <>
    <div className="row"><input placeholder="Barkod okutun veya model yazın" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autoFocus /><button className="btn secondary" onClick={add}>Ekle</button></div>
    {results && <div className="card tight" style={{ marginTop: 8 }}>{results.map((p) => <div key={p.id} style={{ padding: '4px 0' }}><b>{p.code}</b> {p.name}{[...new Set(p.variants.map((v: any) => v.color))].map((c) => <div key={String(c)} className="row" style={{ marginTop: 4 }}><span className="small" style={{ width: 70 }}>{String(c)}</span><div className="sizes">{p.variants.filter((v: any) => v.color === c).map((v: any) => <button key={v.id} className="size" onClick={() => push({ ...v, code: p.code, name: p.name })}><div className="n">{v.size}</div><div className="q">{v.total_qty}</div></button>)}</div><button className="btn sm secondary" onClick={() => addAllSizes(p, String(c))}>Tüm numaralar</button></div>)}</div>)}</div>}
    {items.length > 0 && <table style={{ marginTop: 10 }}><thead><tr><th>Ürün</th><th>Renk / No</th><th>Adet</th>{can('costs.view') && <th>Birim alış (KDV hariç)</th>}<th /></tr></thead><tbody>{items.map((i) => <tr key={i.id}><td><b>{i.code}</b> {i.name}</td><td>{i.color} · {i.size}</td><td><input type="number" min={0} value={i.qty} onChange={(e) => setItems((x) => x.map((y) => (y.id === i.id ? { ...y, qty: Number(e.target.value) } : y)))} style={{ width: 70 }} /></td>{can('costs.view') && <td><MoneyInput value={i.unitCost} onChange={(k) => setItems((x) => x.map((y) => (y.id === i.id ? { ...y, unitCost: k } : y)))} /></td>}<td><button className="btn ghost sm" onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))}>✕</button></td></tr>)}</tbody>
      <tfoot><tr><td colSpan={2}>Toplam</td><td>{items.reduce((a, i) => a + i.qty, 0)} çift</td>{can('costs.view') && <td>{tl(items.reduce((a, i) => a + i.qty * i.unitCost, 0))} (KDV hariç)</td>}<td /></tr></tfoot></table>}
  </>;
}

function POForm({ quick, onClose, onDone }: { quick: boolean; onClose: () => void; onDone: () => void }) {
  const { session, storeId, toast } = useSession();
  const { data: suppliers } = useLoad(() => api.get('/suppliers'), []);
  const [supplierId, setSupplierId] = useState<number>(0);
  const [store, setStore] = useState<number>(storeId!);
  const [items, setItems] = useState<any[]>([]);
  const [expected, setExpected] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [ledger, setLedger] = useState(true);
  const submit = async (status: 'draft' | 'ordered') => {
    if (!supplierId) return toast('Tedarikçi seçin', 'err');
    const list = items.filter((i) => i.qty > 0).map((i) => ({ variantId: i.id, qty: i.qty, unitCost: i.unitCost }));
    if (!list.length) return toast('Ürün ekleyin', 'err');
    try {
      if (quick) await api.post('/purchase-orders/quick-receive', { supplierId, storeId: store, invoiceNo: invoiceNo || undefined, items: list, addToLedger: ledger });
      else await api.post('/purchase-orders', { supplierId, storeId: store, expectedDate: expected || undefined, note: note || undefined, items: list, status });
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <Modal title={quick ? 'Hızlı mal kabul' : 'Tedarikçiye sipariş'} onClose={onClose} wide footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button>{quick ? <button className="btn ok" onClick={() => submit('ordered')}>Mal kabul et (stoğa gir)</button> : <><button className="btn secondary" onClick={() => submit('draft')}>Taslak kaydet</button><button className="btn" onClick={() => submit('ordered')}>Siparişi ver</button></>}</>}>
    <div className="grid c3">
      <label className="f"><span>Tedarikçi *</span><select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}><option value={0}>Seçin…</option>{(suppliers ?? []).filter((s: any) => s.active).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="f"><span>Teslim mağazası / depo</span><select value={store} onChange={(e) => setStore(Number(e.target.value))}>{session?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {quick ? <label className="f"><span>Fatura / irsaliye no</span><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></label> : <label className="f"><span>Beklenen teslim</span><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>}
    </div>
    <div style={{ marginTop: 10 }}><ItemPicker items={items} setItems={setItems} storeId={store} /></div>
    {quick ? <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={ledger} onChange={(e) => setLedger(e.target.checked)} /> Tutarı tedarikçi carisine borç olarak yaz (KDV dahil)</label> : <input placeholder="Not" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 10 }} />}
  </Modal>;
}

function PODetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { toast, can } = useSession();
  const { data: p, loading, reload } = useLoad(() => api.get(`/purchase-orders/${id}`), [id]);
  const [recv, setRecv] = useState<Record<number, number> | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [ledger, setLedger] = useState(true);
  if (loading && !p) return <Modal title="Sipariş" onClose={onClose}><Spinner /></Modal>;
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); reload(); onChanged(); setRecv(null); } catch (e) { toast((e as Error).message, 'err'); } };
  const receivable = ['ordered', 'partial', 'draft'].includes(p.status);
  return <Modal title={<>{p.order_no} · {p.supplier_name} <Badge kind={ST[p.status][1]}>{ST[p.status][0]}</Badge></>} onClose={onClose} wide footer={<>
    {['draft', 'ordered'].includes(p.status) && <button className="btn danger" onClick={() => act(() => api.post(`/purchase-orders/${id}/status`, { status: 'cancelled' }), 'Sipariş iptal edildi')}>İptal et</button>}
    <span className="grow" />
    <button className="btn secondary" onClick={() => window.print()}>🖨 Yazdır</button>
    {p.status === 'draft' && <button className="btn" onClick={() => act(() => api.post(`/purchase-orders/${id}/status`, { status: 'ordered' }), 'Sipariş verildi')}>Siparişi ver</button>}
    {receivable && !recv && <button className="btn ok" onClick={() => setRecv(Object.fromEntries(p.items.map((i: any) => [i.variant_id, Math.max(0, i.qty_ordered - i.qty_received)])))}>📦 Mal kabul</button>}
    {recv && <button className="btn ok" onClick={() => act(() => api.post(`/purchase-orders/${id}/receive`, { items: Object.entries(recv).filter(([, v]) => v > 0).map(([k, v]) => ({ variantId: Number(k), qty: v })), invoiceNo: invoiceNo || undefined, addToLedger: ledger }), 'Mal kabul edildi')}>Girilen adetleri stoğa al</button>}
  </>}>
    <div className="small muted">{p.store_name} · {fmtDateTime(p.created_at)} · {p.created_by_name}{p.expected_date && <> · Beklenen: {fmtDate(p.expected_date)}</>}{p.invoice_no && <> · Fatura: {p.invoice_no}</>}</div>
    {p.note && <div className="alert info" style={{ marginTop: 6 }}>{p.note}</div>}
    {recv && <div className="row" style={{ marginTop: 8 }}><input placeholder="Fatura / irsaliye no" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} style={{ maxWidth: 240 }} /><label className="check"><input type="checkbox" checked={ledger} onChange={(e) => setLedger(e.target.checked)} /> Cariye borç yaz</label></div>}
    <table style={{ marginTop: 10 }}><thead><tr><th>Ürün</th><th>Renk / No</th><th>Barkod</th><th className="num">Sipariş</th><th className="num">Gelen</th>{can('costs.view') && <th className="num">Birim alış</th>}{recv && <th>Şimdi gelen</th>}</tr></thead>
      <tbody>{p.items.map((i: any) => <tr key={i.id}><td><b>{i.code}</b> {i.name}</td><td>{i.color} · {i.size}</td><td className="mono small">{i.barcode}</td><td className="num">{i.qty_ordered}</td><td className={'num ' + (i.qty_received < i.qty_ordered && p.status !== 'draft' ? 'warn bold' : '')}>{i.qty_received}</td>{can('costs.view') && <td className="num">{tl(i.unit_cost)}</td>}{recv && <td><input type="number" min={0} value={recv[i.variant_id]} onChange={(e) => setRecv({ ...recv, [i.variant_id]: Number(e.target.value) })} style={{ width: 80 }} /></td>}</tr>)}</tbody>
      {can('costs.view') && <tfoot><tr><td colSpan={3}>Toplam (KDV hariç)</td><td className="num">{p.items.reduce((a: number, i: any) => a + i.qty_ordered, 0)}</td><td className="num">{p.items.reduce((a: number, i: any) => a + i.qty_received, 0)}</td><td className="num">{tl(p.total)}</td>{recv && <td />}</tr></tfoot>}
    </table>
  </Modal>;
}
