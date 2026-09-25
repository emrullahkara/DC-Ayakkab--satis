import { useState } from 'react';
import { api } from '../api';
import { Badge, DateRange, Empty, Modal, MoneyInput, PageHead, Progress, Spinner, Tabs, type Range } from '../components';
import { useLoad, useSession } from '../store';
import { addDays, fmtDateTime, pct, tl, today } from '../util';

const ROLE: Record<string, string> = { owner: 'Patron', manager: 'Mağaza müdürü', cashier: 'Kasiyer / danışman', warehouse: 'Depo' };

export default function Staff() {
  const [tab, setTab] = useState('users');
  return (
    <div>
      <PageHead title="Personel & Hedefler" />
      <Tabs tabs={[{ key: 'users', label: 'Personel' }, { key: 'perf', label: 'Performans & prim' }, { key: 'targets', label: 'Hedefler' }, { key: 'shifts', label: 'Mesai' }]} value={tab} onChange={setTab} />
      {tab === 'users' && <Users />}
      {tab === 'perf' && <Performance />}
      {tab === 'targets' && <Targets />}
      {tab === 'shifts' && <Shifts />}
    </div>
  );
}

function Users() {
  const { session, toast, can } = useSession();
  const { data, loading, reload } = useLoad(() => api.get('/users'), []);
  const [edit, setEdit] = useState<any>(null);
  const rows: any[] = data ?? [];
  return <div>
    <div className="row" style={{ marginBottom: 10, justifyContent: 'flex-end' }}><button className="btn" onClick={() => setEdit({ role: 'cashier', active: true, store_ids: [], commission_rate: 0 })}>+ Yeni personel</button></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
      <thead><tr><th>Ad</th><th>Kullanıcı adı</th><th>Rol</th><th>Mağazalar</th><th className="num">Prim %</th><th>Son giriş</th><th>Durum</th><th /></tr></thead>
      <tbody>{rows.map((u) => <tr key={u.id}><td className="bold">{u.name}<br /><span className="small muted">{u.phone}</span></td><td>{u.username}</td><td>{ROLE[u.role]}</td><td className="small">{u.role === 'owner' || u.all_stores ? 'Tümü' : u.store_ids.map((id: number) => session?.stores.find((s) => s.id === id)?.name ?? id).join(', ') || '—'}</td><td className="num">{(u.commission_rate / 100).toFixed(2)}</td><td>{fmtDateTime(u.last_login_at)}</td><td>{u.active ? <Badge kind="ok">Aktif</Badge> : <Badge>Pasif</Badge>}</td><td className="right"><button className="btn secondary sm" onClick={() => setEdit(u)}>Düzenle</button></td></tr>)}</tbody>
    </table></div>}</div>
    {edit && <UserForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast('Kaydedildi'); }} canOwner={session?.user.role === 'owner'} />}
  </div>;
}

function UserForm({ value, onClose, onSaved, canOwner }: { value: any; onClose: () => void; onSaved: () => void; canOwner: boolean }) {
  const { session, toast } = useSession();
  const [f, setF] = useState<any>({ ...value, password: '' });
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const body = { username: f.username, name: f.name, phone: f.phone || undefined, role: f.role, password: f.password || undefined, commission_rate: Math.round(Number(f.commission_rate) || 0), all_stores: !!f.all_stores, store_ids: f.store_ids, active: f.active !== 0 && f.active !== false };
      if (f.id) await api.put(`/users/${f.id}`, body); else await api.post('/users', body);
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <Modal title={f.id ? 'Personel düzenle' : 'Yeni personel'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
    <div className="form">
      <label className="f"><span>Ad Soyad *</span><input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
      <label className="f"><span>Kullanıcı adı *</span><input value={f.username ?? ''} onChange={(e) => set('username', e.target.value.toLowerCase())} /></label>
      <label className="f"><span>Telefon</span><input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="f"><span>{f.id ? 'Yeni şifre (boş = değişmez)' : 'Şifre *'}</span><input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></label>
      <label className="f"><span>Rol</span><select value={f.role} onChange={(e) => set('role', e.target.value)}>{Object.entries(ROLE).filter(([k]) => canOwner || k !== 'owner').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="f"><span>Prim oranı (% — satış cirosu üzerinden)</span><input type="number" step="0.01" value={(Number(f.commission_rate) || 0) / 100} onChange={(e) => set('commission_rate', Math.round(Number(e.target.value) * 100))} /></label>
      <div className="full small muted">Roller: <b>Patron</b> her şeyi görür. <b>Müdür</b> ayarlar hariç her şey. <b>Kasiyer</b> satış, iade, kasa, müşteri. <b>Depo</b> ürün, stok, transfer, sayım, mal kabul. Kasiyer alış fiyatı ve kârı göremez.</div>
      {f.role !== 'owner' && <div className="f full"><label className="check"><input type="checkbox" checked={!!f.all_stores} onChange={(e) => set('all_stores', e.target.checked)} /> Tüm mağazalara erişebilir</label>{!f.all_stores && <div className="chips" style={{ marginTop: 6 }}>{session?.stores.map((s) => <button key={s.id} className={'chip' + (f.store_ids.includes(s.id) ? ' sel' : '')} onClick={() => set('store_ids', f.store_ids.includes(s.id) ? f.store_ids.filter((x: number) => x !== s.id) : [...f.store_ids, s.id])}>{s.name}</button>)}</div>}</div>}
      {f.id && <label className="check"><input type="checkbox" checked={f.active !== 0 && f.active !== false} onChange={(e) => set('active', e.target.checked)} /> Aktif (pasif personel giriş yapamaz)</label>}
    </div>
  </Modal>;
}

function Performance() {
  const [range, setRange] = useState<Range>({ from: today().slice(0, 8) + '01', to: today() });
  const { data, loading } = useLoad(() => api.get('/reports/by-staff', { from: range.from, to: range.to }), [range]);
  const rows: any[] = data ?? [];
  return <div>
    <div className="card" style={{ marginBottom: 12 }}><DateRange value={range} onChange={setRange} /></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
      <thead><tr><th>Personel</th><th className="num">Fiş</th><th className="num">Çift</th><th className="num">Ciro</th><th className="num">Ort. sepet</th><th className="num">İndirim</th><th className="num">İade</th>{rows[0]?.profit !== undefined && <th className="num">Kâr</th>}<th className="num">Prim %</th><th className="num">Hak edilen prim</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td className="bold">{r.name}</td><td className="num">{r.receipts}</td><td className="num">{r.pairs}</td><td className="num bold">{tl(r.revenue)}</td><td className="num">{tl(r.receipts ? r.revenue / r.receipts : 0)}</td><td className="num">{tl(r.discount)}</td><td className="num">{r.returns_count}</td>{r.profit !== undefined && <td className="num">{tl(r.profit)}</td>}<td className="num">{(r.commission_rate / 100).toFixed(2)}</td><td className="num bold ok">{tl(r.commission)}</td></tr>)}</tbody>
      <tfoot><tr><td>Toplam</td><td className="num">{rows.reduce((a, r) => a + r.receipts, 0)}</td><td className="num">{rows.reduce((a, r) => a + r.pairs, 0)}</td><td className="num">{tl(rows.reduce((a, r) => a + r.revenue, 0))}</td><td colSpan={rows[0]?.profit !== undefined ? 5 : 4} /><td className="num">{tl(rows.reduce((a, r) => a + r.commission, 0))}</td></tr></tfoot>
    </table></div>}</div>
  </div>;
}

function Targets() {
  const { session, toast } = useSession();
  const [month, setMonth] = useState(today().slice(0, 7));
  const { data, loading, reload } = useLoad(() => api.get('/targets', { month }), [month]);
  const { data: users } = useLoad(() => api.get('/users'), []);
  const [f, setF] = useState<any>({ kind: 'company', storeId: '', userId: '', amount: 0 });
  const rows: any[] = data ?? [];
  const save = async () => {
    try {
      await api.post('/targets', { month, storeId: f.kind === 'store' ? Number(f.storeId) : null, userId: f.kind === 'user' ? Number(f.userId) : null, amount: f.amount });
      toast('Hedef kaydedildi'); reload();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <div>
    <div className="card" style={{ marginBottom: 12 }}><div className="row">
      <label className="f"><span>Ay</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      <label className="f"><span>Hedef türü</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="company">Firma geneli</option><option value="store">Mağaza</option><option value="user">Personel</option></select></label>
      {f.kind === 'store' && <label className="f"><span>Mağaza</span><select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Seçin</option>{session?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {f.kind === 'user' && <label className="f"><span>Personel</span><select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Seçin</option>{(users ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
      <label className="f"><span>Hedef ciro (0 = sil)</span><MoneyInput value={f.amount} onChange={(k) => setF({ ...f, amount: k })} /></label>
      <button className="btn" onClick={save} style={{ alignSelf: 'flex-end' }}>Kaydet</button>
    </div></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty text="Bu ay için hedef yok" /> : <div className="table-wrap"><table>
      <thead><tr><th>Hedef</th><th className="num">Hedef</th><th className="num">Gerçekleşen</th><th style={{ width: 200 }}>İlerleme</th><th className="num">%</th></tr></thead>
      <tbody>{rows.map((t) => <tr key={t.id}><td className="bold">{t.user_name ?? t.store_name ?? 'Firma geneli'}</td><td className="num">{tl(t.amount)}</td><td className="num">{tl(t.actual)}</td><td><Progress value={t.actual} max={t.amount} warn={t.percent < 50} /></td><td className={'num bold ' + (t.percent >= 100 ? 'ok' : '')}>{pct(t.percent)}</td></tr>)}</tbody>
    </table></div>}</div>
  </div>;
}

function Shifts() {
  const { session, storeId, toast, refresh } = useSession();
  const [range, setRange] = useState<Range>({ from: addDays(today(), -13), to: today() });
  const { data, loading, reload } = useLoad(() => api.get('/shifts', { from: range.from, to: range.to }), [range]);
  const rows: any[] = data ?? [];
  const shift = session?.shift;
  const act = async () => {
    try { if (shift) await api.post('/shifts/out'); else await api.post('/shifts/in', { storeId }); toast(shift ? 'Mesai çıkışı yapıldı' : 'Mesai başladı'); await refresh(); reload(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <div>
    <div className="card" style={{ marginBottom: 12 }}><div className="row between"><div>{shift ? <>Mesaideyim: <b>{shift.store_name}</b> · {fmtDateTime(shift.clock_in)}</> : 'Mesaide değilsiniz'}</div><button className={'btn ' + (shift ? 'danger' : 'ok')} onClick={act}>{shift ? 'Mesai çıkışı' : 'Mesai girişi'}</button></div></div>
    <div className="card" style={{ marginBottom: 12 }}><DateRange value={range} onChange={setRange} /></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
      <thead><tr><th>Personel</th><th>Mağaza</th><th>Giriş</th><th>Çıkış</th><th className="num">Saat</th></tr></thead>
      <tbody>{rows.map((s) => <tr key={s.id}><td className="bold">{s.user_name}</td><td>{s.store_name}</td><td>{fmtDateTime(s.clock_in)}</td><td>{s.clock_out ? fmtDateTime(s.clock_out) : <Badge kind="ok">Devam</Badge>}</td><td className="num">{s.hours}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={4}>Toplam</td><td className="num">{rows.reduce((a, r) => a + r.hours, 0).toFixed(1)} saat</td></tr></tfoot>
    </table></div>}</div>
  </div>;
}
