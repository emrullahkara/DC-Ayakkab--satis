import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Badge, Confirm, Empty, Modal, PageHead, Spinner } from '../components';
import { useLoad, useSession } from '../store';
import { beep, fmtDateTime, tl } from '../util';

export default function Counts() {
  const { storeId, store, toast } = useSession();
  const { data, loading, reload } = useLoad(() => api.get('/counts'), []);
  const [open, setOpen] = useState<number | null>(null);
  const [create, setCreate] = useState(false);
  const [scope, setScope] = useState<'partial' | 'full'>('partial');
  const [name, setName] = useState('');
  const rows: any[] = data ?? [];
  const activeHere = rows.find((c) => c.status === 'open' && c.store_id === storeId);
  const start = async () => {
    try {
      const c = await api.post('/counts', { storeId, name, scope });
      setCreate(false); reload(); setOpen(c.id);
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div>
      <PageHead title="Stok Sayımı">{activeHere ? <button className="btn ok" onClick={() => setOpen(activeHere.id)}>▶ Devam et: {activeHere.name}</button> : <button className="btn" onClick={() => setCreate(true)}>+ Yeni sayım başlat</button>}</PageHead>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty text="Henüz sayım yapılmadı" /> : <div className="table-wrap"><table>
        <thead><tr><th>Sayım</th><th>Mağaza</th><th>Kapsam</th><th>Durum</th><th>Başlatan</th><th>Tarih</th><th className="num">Satır</th><th className="num">Sayılan</th><th>Sonuç</th></tr></thead>
        <tbody>{rows.map((c) => { const r = c.result ? JSON.parse(c.result) : null; return <tr key={c.id} className="click" onClick={() => setOpen(c.id)}><td className="bold">{c.name}</td><td>{c.store_name}</td><td>{c.scope === 'full' ? 'Tam sayım' : 'Kısmi'}</td><td><Badge kind={c.status === 'open' ? 'warn' : c.status === 'applied' ? 'ok' : ''}>{{ open: 'Devam ediyor', applied: 'Uygulandı', cancelled: 'İptal' }[c.status as string]}</Badge></td><td>{c.created_by_name}</td><td>{fmtDateTime(c.created_at)}</td><td className="num">{c.lines}</td><td className="num">{c.counted_total}</td><td className="small">{r && <>+{r.plus} / −{r.minus} · {tl(r.value)}</>}</td></tr>; })}</tbody>
      </table></div>}</div>
      {create && <Modal title={`Yeni sayım — ${store?.name}`} onClose={() => setCreate(false)} narrow footer={<><button className="btn secondary" onClick={() => setCreate(false)}>Vazgeç</button><button className="btn" onClick={start}>Başlat</button></>}>
        <div className="col">
          <label className="f"><span>Sayım adı</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Eylül sonu sayımı" autoFocus /></label>
          <label className="f"><span>Kapsam</span><select value={scope} onChange={(e) => setScope(e.target.value as any)}><option value="partial">Kısmi: sadece okutulan ürünler düzeltilir</option><option value="full">Tam: okutulmayan ürünler 0 kabul edilir</option></select></label>
          <div className="alert warn small">Sayım sırasında satış yapılmaya devam edilebilir; uygularken sistemdeki güncel stokla karşılaştırılır. Tam sayımda mağazadaki HER ürünü okutmalısınız.</div>
        </div>
      </Modal>}
      {open && <CountScreen id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function CountScreen({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast } = useSession();
  const { data: c, loading, reload } = useLoad(() => api.get(`/counts/${id}`), [id]);
  const [scan, setScan] = useState('');
  const [qty, setQty] = useState(1);
  const [last, setLast] = useState<any>(null);
  const [confirm, setConfirm] = useState<'apply' | 'cancel' | null>(null);
  const [tab, setTab] = useState<'scan' | 'diff'>('scan');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), [last]);
  if (loading && !c) return <Modal title="Sayım" onClose={onClose}><Spinner /></Modal>;
  const isOpen = c.status === 'open';
  const doScan = async () => {
    if (!scan.trim()) return;
    try {
      const r = await api.post(`/counts/${id}/scan`, { barcode: scan.trim(), qty, mode: 'add' });
      setLast(r); beep(true); setScan(''); setQty(1); reload();
    } catch (e) { beep(false); toast((e as Error).message, 'err'); setScan(''); }
  };
  const setLine = async (variantId: number, q: number) => {
    try { await api.post(`/counts/${id}/scan`, { variantId, qty: q, mode: 'set' }); reload(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const p = c.preview;
  return (
    <Modal title={<>{c.name} · {c.store_name} <Badge kind={isOpen ? 'warn' : 'ok'}>{isOpen ? 'Devam ediyor' : 'Uygulandı'}</Badge></>} onClose={onClose} wide footer={<>
      {isOpen && <button className="btn danger" onClick={() => setConfirm('cancel')}>Sayımı iptal et</button>}
      <span className="grow" />
      <button className="btn secondary" onClick={onClose}>Kapat</button>
      {isOpen && <button className="btn ok" onClick={() => setConfirm('apply')}>Sayımı bitir ve stoğu güncelle</button>}
    </>}>
      {isOpen && <>
        <div className="row"><input ref={ref} placeholder="Barkod okutun (her okutma +adet)" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doScan()} autoFocus style={{ fontSize: 18, minHeight: 48 }} className="grow" /><input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 80, minHeight: 48 }} title="Adet" /></div>
        {last && <div className="alert info" style={{ marginTop: 8 }}>✔ {last.code} {last.name} · {last.color} · {last.size} → sayılan: <b>{last.counted_qty}</b></div>}
      </>}
      <div className="tabs" style={{ marginTop: 10 }}><button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>Sayılanlar ({c.items.length})</button><button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>Farklar {p && `(${p.diffs.length})`}</button></div>
      {tab === 'scan' && (c.items.length === 0 ? <Empty text="Henüz ürün okutulmadı" /> : <div className="table-wrap" style={{ maxHeight: 400, overflow: 'auto' }}><table><thead><tr><th>Ürün</th><th>Renk / No</th><th className="num">Sistem</th><th className="num">Sayılan</th><th className="num">Fark</th></tr></thead><tbody>{c.items.map((i: any) => { const sys = c.status === 'open' ? i.current_qty : i.system_qty ?? i.current_qty; return <tr key={i.variant_id}><td><b>{i.code}</b> {i.name}</td><td>{i.color} · {i.size}</td><td className="num">{sys}</td><td className="num">{isOpen ? <input type="number" min={0} value={i.counted_qty} onChange={(e) => setLine(i.variant_id, Number(e.target.value))} style={{ width: 70, minHeight: 30 }} /> : i.counted_qty}</td><td className={'num bold ' + (i.counted_qty - sys > 0 ? 'ok' : i.counted_qty - sys < 0 ? 'danger' : '')}>{i.counted_qty - sys > 0 ? '+' : ''}{i.counted_qty - sys}</td></tr>; })}</tbody></table></div>)}
      {tab === 'diff' && (p ? (p.diffs.length === 0 ? <Empty text="Fark yok — sistem ile sayım tutuyor 👍" /> : <>
        <div className="row" style={{ margin: '8px 0' }}><Badge kind="ok">Fazla: {p.plus}</Badge><Badge kind="danger">Eksik: {p.minus}</Badge><Badge>Maliyet etkisi: {tl(p.value)}</Badge></div>
        <div className="table-wrap" style={{ maxHeight: 400, overflow: 'auto' }}><table><thead><tr><th>Ürün</th><th>Renk / No</th><th className="num">Sistem</th><th className="num">Sayılan</th><th className="num">Fark</th></tr></thead><tbody>{p.diffs.map((d: any) => <tr key={d.variant_id}><td><b>{d.code}</b> {d.name}</td><td>{d.color} · {d.size}</td><td className="num">{d.system}</td><td className="num">{d.counted}</td><td className={'num bold ' + (d.counted > d.system ? 'ok' : 'danger')}>{d.counted - d.system > 0 ? '+' : ''}{d.counted - d.system}</td></tr>)}</tbody></table></div>
      </>) : <div className="muted">Uygulanmış sayım: {c.result && <>{c.result.lines} satır, +{c.result.plus} / −{c.result.minus}, {tl(c.result.value)}</>}</div>)}
      {confirm === 'apply' && <Confirm title="Sayımı uygula" text={<>Farklar stoğa işlenecek: <b>{p?.diffs.length}</b> satır (+{p?.plus} / −{p?.minus}). {c.scope === 'full' && <b className="danger">Tam sayım: okutulmayan tüm ürünler sıfırlanacak!</b>}</>} onClose={() => setConfirm(null)} onOk={async () => { try { await api.post(`/counts/${id}/apply`); toast('Sayım uygulandı'); setConfirm(null); reload(); } catch (e) { toast((e as Error).message, 'err'); } }} />}
      {confirm === 'cancel' && <Confirm title="Sayımı iptal et" danger text="Okutulan tüm veriler silinecek, stok değişmeyecek." onClose={() => setConfirm(null)} onOk={async () => { await api.post(`/counts/${id}/cancel`); toast('Sayım iptal edildi'); onClose(); }} />}
    </Modal>
  );
}
