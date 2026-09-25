import { useState } from 'react';
import { api } from '../api';
import { Badge, Confirm, Empty, Modal, MoneyInput, PageHead, Spinner } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, tl } from '../util';

const TYPE: Record<string, string> = { percent: 'Yüzde indirim', amount: 'Tutar indirimi', buy_x_pay_y: 'X al Y öde', nth_percent: 'N. ürüne % indirim' };
const SCOPE: Record<string, string> = { all: 'Tüm ürünler', category: 'Kategori', brand: 'Marka', product: 'Belirli ürünler', season: 'Sezon' };

export default function Campaigns() {
  const { toast, session } = useSession();
  const { data, loading, reload } = useLoad(() => api.get('/campaigns'), []);
  const { data: meta } = useLoad(() => api.get('/catalog/meta'), []);
  const [edit, setEdit] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const rows: any[] = data ?? [];
  const desc = (c: any) => {
    switch (c.type) {
      case 'percent': return `%${c.value} indirim`;
      case 'amount': return `${tl(c.value)} indirim`;
      case 'buy_x_pay_y': return `${c.min_qty} al ${c.value} öde`;
      case 'nth_percent': return `${c.min_qty}. ürüne %${c.value}`;
    }
  };
  const scopeName = (c: any) => {
    if (c.scope === 'category') return 'Kategori: ' + (meta?.categories.find((x: any) => String(x.id) === c.scope_value)?.name ?? c.scope_value);
    if (c.scope === 'brand') return 'Marka: ' + (meta?.brands.find((x: any) => String(x.id) === c.scope_value)?.name ?? c.scope_value);
    if (c.scope === 'season') return 'Sezon: ' + c.scope_value;
    if (c.scope === 'product') return 'Ürünler: ' + c.scope_value;
    return 'Tüm ürünler';
  };
  return (
    <div>
      <PageHead title="Kampanyalar"><button className="btn" onClick={() => setEdit({ type: 'percent', value: 10, min_qty: 1, scope: 'all', active: true, priority: 0 })}>+ Yeni kampanya</button></PageHead>
      <div className="alert info" style={{ marginBottom: 12 }}>Kampanyalar kasada otomatik uygulanır. Bir ürüne birden fazla kampanya uyuyorsa müşteri lehine en avantajlısı seçilir. "2. çifte %50" için "N. ürüne % indirim" türünü N=2, %=50 ile kullanın.</div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>Kampanya</th><th>Kural</th><th>Kapsam</th><th>Mağazalar</th><th>Tarih</th><th>Öncelik</th><th>Durum</th><th /></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.id}><td className="bold">{c.name}</td><td>{desc(c)}</td><td>{scopeName(c)}</td><td className="small">{c.store_ids ? c.store_ids.map((id: number) => session?.stores.find((s) => s.id === id)?.name ?? id).join(', ') : 'Hepsi'}</td><td className="small">{c.start_date || c.end_date ? `${fmtDate(c.start_date) || '…'} – ${fmtDate(c.end_date) || '…'}` : 'Süresiz'}</td><td>{c.priority}</td><td>{c.active ? <Badge kind="ok">Aktif</Badge> : <Badge>Pasif</Badge>}</td><td className="right nowrap"><button className="btn secondary sm" onClick={() => setEdit(c)}>Düzenle</button> {c.active ? <button className="btn ghost sm" onClick={() => setDel(c)}>Kapat</button> : null}</td></tr>)}</tbody>
      </table></div>}</div>
      {edit && meta && <CampaignForm value={edit} meta={meta} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast('Kampanya kaydedildi'); }} />}
      {del && <Confirm title="Kampanyayı kapat" text={`"${del.name}" kampanyası pasife alınacak.`} onClose={() => setDel(null)} onOk={async () => { await api.del(`/campaigns/${del.id}`); setDel(null); reload(); }} />}
    </div>
  );
}

function CampaignForm({ value, meta, onClose, onSaved }: { value: any; meta: any; onClose: () => void; onSaved: () => void }) {
  const { toast, session } = useSession();
  const [f, setF] = useState<any>({ ...value, store_ids: value.store_ids ?? [] });
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const body = { name: f.name, type: f.type, value: Number(f.value), min_qty: Number(f.min_qty ?? 1), scope: f.scope, scope_value: f.scope === 'all' ? null : String(f.scope_value ?? ''), store_ids: f.store_ids?.length ? f.store_ids : null, start_date: f.start_date || null, end_date: f.end_date || null, priority: Number(f.priority ?? 0), active: !!f.active };
      if (f.id) await api.put(`/campaigns/${f.id}`, body); else await api.post('/campaigns', body);
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <Modal title={f.id ? 'Kampanya düzenle' : 'Yeni kampanya'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
    <div className="form">
      <label className="f full"><span>Kampanya adı *</span><input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Örn. Sezon sonu %30" /></label>
      <label className="f"><span>Tür</span><select value={f.type} onChange={(e) => set('type', e.target.value)}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {f.type === 'amount' ? <label className="f"><span>İndirim tutarı (ürün başına)</span><MoneyInput value={Number(f.value) || 0} onChange={(k) => set('value', k)} /></label>
        : f.type === 'buy_x_pay_y' ? <label className="f"><span>Y: ödenecek adet</span><input type="number" min={1} value={f.value} onChange={(e) => set('value', e.target.value)} /></label>
        : <label className="f"><span>Yüzde</span><input type="number" min={0} max={100} value={f.value} onChange={(e) => set('value', e.target.value)} /></label>}
      {f.type === 'buy_x_pay_y' && <label className="f"><span>X: alınacak adet</span><input type="number" min={2} value={f.min_qty} onChange={(e) => set('min_qty', e.target.value)} /></label>}
      {f.type === 'nth_percent' && <label className="f"><span>N: kaçıncı ürün (en ucuza uygulanır)</span><input type="number" min={2} value={f.min_qty} onChange={(e) => set('min_qty', e.target.value)} /></label>}
      {(f.type === 'percent' || f.type === 'amount') && <label className="f"><span>En az adet</span><input type="number" min={1} value={f.min_qty} onChange={(e) => set('min_qty', e.target.value)} /></label>}
      <label className="f"><span>Kapsam</span><select value={f.scope} onChange={(e) => (set('scope', e.target.value), set('scope_value', ''))}>{Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {f.scope === 'category' && <label className="f"><span>Kategori</span><select value={f.scope_value ?? ''} onChange={(e) => set('scope_value', e.target.value)}><option value="">Seçin</option>{meta.categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {f.scope === 'brand' && <label className="f"><span>Marka</span><select value={f.scope_value ?? ''} onChange={(e) => set('scope_value', e.target.value)}><option value="">Seçin</option>{meta.brands.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {f.scope === 'season' && <label className="f"><span>Sezon</span><select value={f.scope_value ?? ''} onChange={(e) => set('scope_value', e.target.value)}><option value="">Seçin</option>{meta.seasons.map((s: string) => <option key={s}>{s}</option>)}</select></label>}
      {f.scope === 'product' && <label className="f full"><span>Ürün ID'leri (virgülle; ürün sayfasındaki numara)</span><input value={f.scope_value ?? ''} onChange={(e) => set('scope_value', e.target.value)} placeholder="12, 15, 40" /></label>}
      <label className="f"><span>Başlangıç</span><input type="date" value={f.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} /></label>
      <label className="f"><span>Bitiş (dahil)</span><input type="date" value={f.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} /></label>
      <label className="f"><span>Öncelik (eşitlikte yüksek olan)</span><input type="number" value={f.priority ?? 0} onChange={(e) => set('priority', e.target.value)} /></label>
      <div className="f full"><span className="bold small muted">Mağazalar (hiçbiri seçili değilse hepsi)</span><div className="chips" style={{ marginTop: 4 }}>{session?.stores.map((s) => <button key={s.id} className={'chip' + (f.store_ids.includes(s.id) ? ' sel' : '')} onClick={() => set('store_ids', f.store_ids.includes(s.id) ? f.store_ids.filter((x: number) => x !== s.id) : [...f.store_ids, s.id])}>{s.name}</button>)}</div></div>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked)} /> Aktif</label>
    </div>
  </Modal>;
}
