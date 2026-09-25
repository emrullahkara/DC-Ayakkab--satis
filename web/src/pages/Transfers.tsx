import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, PageHead, Spinner, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDateTime } from '../util';

const ST: Record<string, [string, 'ok' | 'warn' | 'info' | 'danger' | '']> = { requested: ['Talep', 'warn'], sent: ['Yolda', 'info'], received: ['Teslim alındı', 'ok'], cancelled: ['İptal', 'danger'] };

export default function Transfers() {
  const { storeId, session, toast } = useSession();
  const [tab, setTab] = useState('open');
  const [open, setOpen] = useState<number | null>(null);
  const [create, setCreate] = useState<'send' | 'request' | null>(null);
  const { data, loading, reload } = useLoad(() => api.get('/transfers', {}), []);
  const rows: any[] = (data ?? []).filter((t: any) => (tab === 'open' ? ['requested', 'sent'].includes(t.status) : !['requested', 'sent'].includes(t.status)));
  return (
    <div>
      <PageHead title="Mağazalar Arası Transfer">
        <button className="btn secondary" onClick={() => setCreate('request')}>📥 Ürün talep et</button>
        <button className="btn" onClick={() => setCreate('send')}>📤 Ürün gönder</button>
      </PageHead>
      <Tabs tabs={[{ key: 'open', label: 'Bekleyen', badge: (data ?? []).filter((t: any) => ['requested', 'sent'].includes(t.status)).length }, { key: 'done', label: 'Tamamlanan' }]} value={tab} onChange={setTab} />
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>No</th><th>Tarih</th><th>Gönderen</th><th>Alan</th><th className="num">Çift</th><th>Durum</th><th>Oluşturan</th><th>Not</th></tr></thead>
        <tbody>{rows.map((t) => <tr key={t.id} className="click" onClick={() => setOpen(t.id)}><td className="bold">{t.transfer_no}</td><td>{fmtDateTime(t.created_at)}</td><td>{t.from_store}{t.from_store_id === storeId && ' (siz)'}</td><td>{t.to_store}{t.to_store_id === storeId && ' (siz)'}</td><td className="num">{t.total_qty}</td><td><Badge kind={ST[t.status][1]}>{ST[t.status][0]}</Badge></td><td>{t.created_by_name}</td><td className="small">{t.note}</td></tr>)}</tbody>
      </table></div>}</div>
      {open && <TransferDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      {create && <CreateTransfer mode={create} onClose={() => setCreate(null)} onDone={() => { setCreate(null); reload(); toast(create === 'send' ? 'Transfer gönderildi' : 'Talep oluşturuldu'); }} />}
    </div>
  );
}

function CreateTransfer({ mode, onClose, onDone }: { mode: 'send' | 'request'; onClose: () => void; onDone: () => void }) {
  const { session, storeId, toast } = useSession();
  const stores = session?.stores ?? [];
  const [from, setFrom] = useState<number>(mode === 'send' ? storeId! : stores.find((s) => s.id !== storeId)?.id ?? 0);
  const [to, setTo] = useState<number>(mode === 'send' ? stores.find((s) => s.id !== storeId)?.id ?? 0 : storeId!);
  const [items, setItems] = useState<any[]>([]);
  const [scan, setScan] = useState('');
  const [note, setNote] = useState('');
  const add = async () => {
    const term = scan.trim();
    if (!term) return;
    try {
      if (/^\d{8,14}$/.test(term)) {
        const v = await api.get(`/pos/barcode/${term}`);
        push(v);
      } else {
        const r = await api.get('/pos/search', { q: term, storeId: from });
        if (!r.length) return toast('Ürün bulunamadı', 'err');
        setResults(r);
      }
      setScan('');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const [results, setResults] = useState<any[] | null>(null);
  const push = (v: any) => {
    setItems((x) => { const ex = x.find((i) => i.id === v.id); return ex ? x.map((i) => (i.id === v.id ? { ...i, qty: i.qty + 1 } : i)) : [...x, { ...v, qty: 1, fromQty: v.stock?.find((s: any) => s.store_id === from)?.qty ?? v.qty ?? '?' }]; });
    setResults(null);
  };
  const submit = async () => {
    try {
      await api.post('/transfers', { fromStoreId: from, toStoreId: to, items: items.map((i) => ({ variantId: i.id, qty: i.qty })), note, request: mode === 'request' });
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Modal title={mode === 'send' ? 'Ürün gönder' : 'Başka mağazadan ürün talep et'} onClose={onClose} wide footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" disabled={!items.length || from === to} onClick={submit}>{mode === 'send' ? 'Gönder (stoktan düşer)' : 'Talep gönder'}</button></>}>
      <div className="grid c2">
        <label className="f"><span>Gönderen mağaza</span><select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="f"><span>Alan mağaza</span><select value={to} onChange={(e) => setTo(Number(e.target.value))}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <div className="row" style={{ marginTop: 10 }}><input placeholder="Barkod okutun veya model adı yazın" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autoFocus /><button className="btn secondary" onClick={add}>Ekle</button></div>
      {results && <div className="card tight" style={{ marginTop: 8 }}>{results.map((p) => <div key={p.id} style={{ padding: '4px 0' }}><b>{p.code}</b> {p.name}<div className="sizes" style={{ marginTop: 4 }}>{p.variants.map((v: any) => <button key={v.id} className={'size' + (v.qty <= 0 ? ' out' : '')} onClick={() => push({ ...v, code: p.code, name: p.name })}><div className="n">{v.size}</div><div className="q">{v.color} · {v.qty}</div></button>)}</div></div>)}</div>}
      {items.length > 0 && <table style={{ marginTop: 10 }}><thead><tr><th>Ürün</th><th>Renk / No</th><th className="num">Gönderende</th><th>Adet</th><th /></tr></thead><tbody>{items.map((i) => <tr key={i.id}><td><b>{i.code}</b> {i.name}</td><td>{i.color} · {i.size}</td><td className="num">{i.fromQty}</td><td><input type="number" min={1} value={i.qty} onChange={(e) => setItems((x) => x.map((y) => (y.id === i.id ? { ...y, qty: Number(e.target.value) } : y)))} style={{ width: 80 }} /></td><td><button className="btn ghost sm" onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))}>✕</button></td></tr>)}</tbody></table>}
      <input placeholder="Not" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 10 }} />
    </Modal>
  );
}

function TransferDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { storeId, toast } = useSession();
  const { data: t, loading, reload } = useLoad(() => api.get(`/transfers/${id}`), [id]);
  const [recv, setRecv] = useState<Record<number, number> | null>(null);
  if (loading && !t) return <Modal title="Transfer" onClose={onClose}><Spinner /></Modal>;
  const act = async (path: string, body?: any, msg?: string) => {
    try { await api.post(`/transfers/${id}/${path}`, body); toast(msg ?? 'Tamam'); reload(); onChanged(); setRecv(null); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const canReceive = t.status === 'sent' && t.to_store_id === storeId;
  const canSend = t.status === 'requested' && t.from_store_id === storeId;
  return (
    <Modal title={<>{t.transfer_no} <Badge kind={ST[t.status][1]}>{ST[t.status][0]}</Badge></>} onClose={onClose} footer={<>
      {['requested', 'sent'].includes(t.status) && <button className="btn danger" onClick={() => act('cancel', {}, 'Transfer iptal edildi')}>İptal et</button>}
      <span className="grow" />
      {canSend && <button className="btn" onClick={() => act('send', {}, 'Ürünler gönderildi')}>Talebi onayla ve gönder</button>}
      {canReceive && !recv && <button className="btn ok" onClick={() => act('receive', {}, 'Teslim alındı')}>Tamamını teslim al</button>}
      {canReceive && !recv && <button className="btn secondary" onClick={() => setRecv(Object.fromEntries(t.items.map((i: any) => [i.variant_id, i.qty])))}>Eksik geldi…</button>}
      {recv && <button className="btn ok" onClick={() => act('receive', { items: Object.entries(recv).map(([k, v]) => ({ variantId: Number(k), qty: v })) }, 'Teslim alındı (eksikli)')}>Girilen adetlerle teslim al</button>}
      <button className="btn secondary" onClick={() => window.print()}>🖨</button>
    </>}>
      <div className="small muted">{t.from_store} → {t.to_store} · {fmtDateTime(t.created_at)} · {t.created_by_name}{t.received_at && <> · Teslim: {fmtDateTime(t.received_at)} {t.received_by_name}</>}</div>
      {t.note && <div className="alert info" style={{ marginTop: 6 }}>{t.note}</div>}
      <table style={{ marginTop: 10 }}><thead><tr><th>Ürün</th><th>Renk / No</th><th>Barkod</th><th className="num">Adet</th>{t.status === 'received' && <th className="num">Gelen</th>}{recv && <th>Gelen adet</th>}</tr></thead>
        <tbody>{t.items.map((i: any) => <tr key={i.id}><td><b>{i.code}</b> {i.name}</td><td>{i.color} · {i.size}</td><td className="mono small">{i.barcode}</td><td className="num">{i.qty}</td>{t.status === 'received' && <td className={'num ' + (i.qty_received < i.qty ? 'danger bold' : '')}>{i.qty_received}</td>}{recv && <td><input type="number" min={0} max={i.qty} value={recv[i.variant_id]} onChange={(e) => setRecv({ ...recv, [i.variant_id]: Number(e.target.value) })} style={{ width: 80 }} /></td>}</tr>)}</tbody></table>
    </Modal>
  );
}
