import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, PageHead, Spinner, StoreSelect, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDateTime } from '../util';

const GROUP: Record<string, string> = { fatura: 'e-Fatura', kasa: 'Yazarkasa POS', mesaj: 'SMS / WhatsApp', pazaryeri: 'Pazaryerleri' };
const STATUS: Record<string, [string, 'ok' | 'warn' | 'danger' | 'info' | '']> = { pending: ['Bekliyor', 'warn'], done: ['Gönderildi', 'ok'], error: ['Hata', 'danger'], simulated: ['Test (simüle)', 'info'] };

export default function Integrations() {
  const { toast, session, refresh } = useSession();
  const [tab, setTab] = useState('providers');
  const { data, loading, reload } = useLoad(() => api.get('/integrations'), []);
  const [edit, setEdit] = useState<any>(null);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHead title="Entegrasyonlar" />
      <Tabs tabs={[{ key: 'providers', label: 'Sağlayıcılar' }, { key: 'outbox', label: 'Gönderim kuyruğu' }, { key: 'mp', label: 'Pazaryeri siparişleri' }]} value={tab} onChange={setTab} />
      {tab === 'providers' && <>
        <div className="alert info" style={{ marginBottom: 12 }}><div><b>Test modu</b>nda dış sisteme hiçbir şey gönderilmez; işler kuyrukta "simüle" olarak görünür, içeriğini inceleyebilirsiniz. Gerçek bağlantı için sağlayıcıdan aldığınız bilgileri girip <b>Canlı</b> moda alın.</div></div>
        {loading ? <Spinner /> : Object.entries(GROUP).map(([g, label]) => <div key={g} style={{ marginBottom: 16 }}><h3>{label}</h3><div className="grid c2">{rows.filter((r) => r.group === g).map((r) => <div key={r.key} className="card"><div className="row between"><b>{r.label}</b><span>{r.enabled ? <Badge kind={r.mode === 'live' ? 'ok' : 'info'}>{r.mode === 'live' ? 'Canlı' : 'Test'}</Badge> : <Badge>Kapalı</Badge>}</span></div><p className="small muted" style={{ margin: '6px 0 10px' }}>{r.description}</p><button className="btn secondary sm" onClick={() => setEdit(r)}>Ayarla</button></div>)}</div></div>)}
        <div className="card"><b>Pazaryeri stok mağazası</b><p className="small muted">Pazaryerlerine hangi mağazanın/deponun stoğu gönderilsin, gelen siparişler nereden düşülsün?</p><div className="row"><StoreSelect value={session?.settings.marketplace.storeId ?? null} onChange={async (v) => { await api.put('/settings', { settings: { marketplace: { storeId: v } } }); refresh(); toast('Kaydedildi'); }} /></div></div>
      </>}
      {tab === 'outbox' && <Outbox />}
      {tab === 'mp' && <MpOrders />}
      {edit && <ProviderForm p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast('Kaydedildi'); }} />}
    </div>
  );
}

function ProviderForm({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useSession();
  const [enabled, setEnabled] = useState(p.enabled);
  const [mode, setMode] = useState(p.mode);
  const [cfg, setCfg] = useState<Record<string, string>>({ ...p.config });
  const save = async () => { try { await api.put(`/integrations/${p.key}`, { enabled, mode, config: cfg }); onSaved(); } catch (e) { toast((e as Error).message, 'err'); } };
  return <Modal title={p.label} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
    <p className="small muted">{p.description}</p>
    <div className="row" style={{ marginBottom: 12 }}><label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Etkin</label><label className="check"><input type="radio" checked={mode === 'test'} onChange={() => setMode('test')} /> Test modu</label><label className="check"><input type="radio" checked={mode === 'live'} onChange={() => setMode('live')} /> Canlı</label></div>
    {mode === 'live' && <div className="alert warn small" style={{ marginBottom: 10 }}>Canlı modda gerçek fatura kesilir / gerçek mesaj gider / gerçek stok güncellenir.</div>}
    <div className="col">{p.fields.map((f: any) => <label key={f.key} className="f"><span>{f.label}</span>{f.type === 'select' ? <select value={cfg[f.key] ?? ''} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })}><option value="">Seçin</option>{f.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'} value={cfg[f.key] ?? ''} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} autoComplete="off" />}{f.help && <span className="small muted">{f.help}</span>}</label>)}</div>
  </Modal>;
}

function Outbox() {
  const { toast } = useSession();
  const [status, setStatus] = useState('');
  const { data, loading, reload } = useLoad(() => api.get('/integrations/outbox', { status: status || undefined, limit: 300 }), [status]);
  const [open, setOpen] = useState<any>(null);
  const rows: any[] = data ?? [];
  return <div>
    <div className="row" style={{ marginBottom: 10 }}><select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}><option value="">Hepsi</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select><span className="grow" /><button className="btn secondary sm" onClick={reload}>↻</button><button className="btn sm" onClick={async () => { const r = await api.post('/integrations/outbox/run'); toast(`${r.processed} iş işlendi`); reload(); }}>Kuyruğu şimdi çalıştır</button></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty text="Kuyruk boş" /> : <div className="table-wrap"><table><thead><tr><th>Tarih</th><th>Sağlayıcı</th><th>İş</th><th>Kayıt</th><th>Durum</th><th className="num">Deneme</th><th>Sonuç</th><th /></tr></thead><tbody>{rows.map((o) => <tr key={o.id} className="click" onClick={() => setOpen(o)}><td className="nowrap">{fmtDateTime(o.created_at)}</td><td>{o.provider}</td><td>{o.action}</td><td className="small">{o.ref_type} #{o.ref_id}</td><td><Badge kind={STATUS[o.status]?.[1]}>{STATUS[o.status]?.[0]}</Badge></td><td className="num">{o.attempts}</td><td className="small muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.response}</td><td>{['error', 'simulated'].includes(o.status) && <button className="btn secondary sm" onClick={async (e) => { e.stopPropagation(); await api.post(`/integrations/outbox/${o.id}/retry`); reload(); }}>Tekrar</button>}</td></tr>)}</tbody></table></div>}</div>
    {open && <Modal title={`İş #${open.id} · ${open.provider} / ${open.action}`} onClose={() => setOpen(null)} wide><h3>Gönderilen veri</h3><pre style={{ background: '#f5f7fb', padding: 10, borderRadius: 8, overflow: 'auto', maxHeight: 200, fontSize: 12 }}>{open.payload}</pre><h3>Sonuç</h3><pre style={{ background: '#f5f7fb', padding: 10, borderRadius: 8, overflow: 'auto', maxHeight: 300, fontSize: 12, whiteSpace: 'pre-wrap' }}>{(() => { try { return JSON.stringify(JSON.parse(open.response), null, 2); } catch { return open.response; } })()}</pre></Modal>}
  </div>;
}

function MpOrders() {
  const { data, loading } = useLoad(() => api.get('/integrations/marketplace-orders'), []);
  const rows: any[] = data ?? [];
  return <div className="card" style={{ padding: 0 }}>{loading ? <Spinner /> : rows.length === 0 ? <Empty text="Pazaryeri siparişi yok" /> : <table><thead><tr><th>Tarih</th><th>Pazaryeri</th><th>Sipariş no</th><th>Durum</th><th>Fiş</th></tr></thead><tbody>{rows.map((o) => <tr key={o.id}><td>{fmtDateTime(o.created_at)}</td><td>{o.provider.replace('marketplace_', '')}</td><td className="bold">{o.order_no}</td><td>{o.status === 'imported' ? <Badge kind="ok">İşlendi</Badge> : <Badge kind="warn">Barkod eşleşmedi</Badge>}</td><td>{o.receipt_no}</td></tr>)}</tbody></table>}</div>;
}
