import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, Empty, Modal, MoneyInput, PageHead, Search, Spinner, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { downloadCsv, fmtDate, tl } from '../util';

const SEGMENTS = [
  { key: '', label: 'Tümü' },
  { key: 'debt', label: 'Borçlu (veresiye)' },
  { key: 'vip', label: 'VIP (10.000₺+)' },
  { key: 'birthday', label: 'Bu ay doğanlar' },
  { key: 'lost', label: 'Kayıp (6 aydır gelmeyen)' },
  { key: 'new', label: 'Yeni (30 gün)' },
];

export default function Customers() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const segment = sp.get('segment') ?? '';
  const [edit, setEdit] = useState<any | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [msg, setMsg] = useState(false);
  const nav = useNavigate();
  const { can } = useSession();
  const { data, loading, reload } = useLoad(() => api.get('/customers', { q, segment, limit: 500 }), [q, segment]);
  const rows: any[] = data ?? [];
  const allSel = rows.length > 0 && selected.length === rows.length;
  return (
    <div>
      <PageHead title="Müşteriler">
        {can('messages') && <button className="btn secondary" disabled={!selected.length} onClick={() => setMsg(true)}>✉ Mesaj gönder ({selected.length})</button>}
        <button className="btn secondary" onClick={() => downloadCsv('musteriler', rows, [{ key: 'name', label: 'Ad' }, { key: 'phone', label: 'Telefon' }, { key: 'total_spent', label: 'Toplam alışveriş (kuruş)' }, { key: 'visits', label: 'Ziyaret' }, { key: 'balance', label: 'Borç (kuruş)' }, { key: 'points', label: 'Puan' }, { key: 'last_purchase', label: 'Son alışveriş' }])}>⬇ Excel</button>
        <button className="btn" onClick={() => setEdit({})}>+ Yeni müşteri</button>
      </PageHead>
      <Tabs tabs={SEGMENTS} value={segment} onChange={(k) => setSp(k ? { segment: k } : {})} />
      <div className="row" style={{ marginBottom: 10 }}><Search value={q} onChange={setQ} placeholder="Ad veya telefon" autoFocus /></div>
      <div className="card" style={{ padding: 0 }}>
        {loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr>
              <th><input type="checkbox" checked={allSel} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])} /></th>
              <th>Müşteri</th><th>Telefon</th><th className="num">Alışveriş</th><th className="num">Ziyaret</th><th>Son alışveriş</th><th className="num">Puan</th><th className="num">Borç</th><th>Numara</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="click" onClick={() => nav('/musteriler/' + c.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} /></td>
                  <td className="bold">{c.name}{!c.sms_consent && <span className="muted small" title="İleti izni yok"> ✉︎✕</span>}</td>
                  <td>{c.phone}</td>
                  <td className="num">{tl(c.total_spent)}</td>
                  <td className="num">{c.visits}</td>
                  <td>{fmtDate(c.last_purchase)}</td>
                  <td className="num">{tl(c.points)}</td>
                  <td className="num">{c.balance > 0 ? <b className="danger">{tl(c.balance)}</b> : c.balance < 0 ? <span className="ok">{tl(c.balance)}</span> : '—'}</td>
                  <td>{c.shoe_size}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {edit && <CustomerForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {msg && <MessageModal customerIds={selected} onClose={() => setMsg(false)} />}
    </div>
  );
}

export function CustomerForm({ value, onClose, onSaved }: { value: any; onClose: () => void; onSaved: (c: any) => void }) {
  const { toast, can, session } = useSession();
  const [f, setF] = useState<any>({ kvkk_consent: true, sms_consent: true, ...value, credit_limit: value.credit_limit ?? 0 });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f };
      delete body.id;
      const r = f.id ? await api.put(`/customers/${f.id}`, body) : await api.post('/customers', body);
      toast('Müşteri kaydedildi');
      onSaved(r);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={f.id ? 'Müşteri düzenle' : 'Yeni müşteri'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" disabled={busy} onClick={save}>Kaydet</button></>}>
      <div className="form">
        <label className="f full"><span>Ad Soyad *</span><input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        <label className="f"><span>Telefon</span><input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="5xx xxx xx xx" inputMode="tel" /></label>
        <label className="f"><span>E-posta</span><input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
        <label className="f"><span>Doğum tarihi</span><input type="date" value={f.birth_date ?? ''} onChange={(e) => set('birth_date', e.target.value)} /></label>
        <label className="f"><span>Cinsiyet</span><select value={f.gender ?? ''} onChange={(e) => set('gender', e.target.value)}><option value="">—</option><option value="kadin">Kadın</option><option value="erkek">Erkek</option></select></label>
        <label className="f"><span>Ayakkabı numarası</span><input value={f.shoe_size ?? ''} onChange={(e) => set('shoe_size', e.target.value)} /></label>
        <label className="f"><span>Şehir</span><input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></label>
        <label className="f"><span>Bağlı mağaza</span><select value={f.home_store_id ?? ''} onChange={(e) => set('home_store_id', e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{session?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="f full"><span>Adres</span><input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
        <label className="f"><span>VKN / TCKN (fatura için)</span><input value={f.tax_no ?? ''} onChange={(e) => set('tax_no', e.target.value)} /></label>
        <label className="f"><span>Vergi dairesi</span><input value={f.tax_office ?? ''} onChange={(e) => set('tax_office', e.target.value)} /></label>
        {can('customers.credit') && <label className="f"><span>Veresiye limiti (0 = kapalı)</span><MoneyInput value={f.credit_limit ?? 0} onChange={(k) => set('credit_limit', k)} /></label>}
        <label className="f full"><span>Notlar</span><textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Tercihleri, geniş kalıp sever vb." /></label>
        <label className="check"><input type="checkbox" checked={!!f.kvkk_consent} onChange={(e) => set('kvkk_consent', e.target.checked)} /> KVKK aydınlatma metni okundu / onaylandı</label>
        <label className="check"><input type="checkbox" checked={!!f.sms_consent} onChange={(e) => set('sms_consent', e.target.checked)} /> SMS / WhatsApp ileti izni (İYS)</label>
      </div>
    </Modal>
  );
}

/** Kasa ekranı için hızlı müşteri seçici (telefonla ara veya yeni kaydet) */
export function CustomerPicker({ onClose, onPick }: { onClose: () => void; onPick: (c: any) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [create, setCreate] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => api.get('/customers', { q, limit: 30 }).then(setRows), 250);
    return () => clearTimeout(id);
  }, [q]);
  if (create) return <CustomerForm value={{ name: /^\d/.test(q) ? '' : q, phone: /^\d/.test(q) ? q : '' }} onClose={() => setCreate(false)} onSaved={onPick} />;
  return (
    <Modal title="Müşteri seç" onClose={onClose} footer={<button className="btn" onClick={() => setCreate(true)}>+ Yeni müşteri kaydet</button>}>
      <input autoFocus placeholder="Telefon veya ad yazın" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rows[0] && onPick(rows[0])} />
      <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 10 }}>
        {rows.map((c) => (
          <div key={c.id} className="row between" style={{ padding: '8px 4px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => onPick(c)}>
            <span><b>{c.name}</b> <span className="muted small">{c.phone}</span></span>
            <span className="small">{c.balance > 0 && <Badge kind="danger">Borç {tl(c.balance)}</Badge>} Puan {tl(c.points)}</span>
          </div>
        ))}
        {rows.length === 0 && <Empty text="Müşteri bulunamadı — yeni kaydedebilirsiniz" />}
      </div>
    </Modal>
  );
}

export function MessageModal({ customerIds, onClose, defaultText }: { customerIds: number[]; onClose: () => void; defaultText?: string }) {
  const { toast } = useSession();
  const [channels, setChannels] = useState<string[]>([]);
  const [channel, setChannel] = useState('sms');
  const [text, setText] = useState(defaultText ?? 'Sevgili {ad}, yeni sezon ürünlerimiz mağazamızda! Sizi bekliyoruz. {firma}');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/messages/channels').then((c) => { setChannels(c); if (c[0]) setChannel(c[0]); }); }, []);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/customers/message', { channel, customerIds, text });
      toast(`${r.sent} mesaj kuyruğa alındı${r.skipped.length ? `, ${r.skipped.length} müşteride izin/telefon yok` : ''}`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Mesaj gönder (${customerIds.length} müşteri)`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" disabled={busy || !channels.length} onClick={send}>Gönder</button></>}>
      {!channels.length && <div className="alert warn">SMS veya WhatsApp entegrasyonu açık değil. <Link to="/ayarlar/entegrasyonlar">Entegrasyonlar →</Link></div>}
      <label className="f"><span>Kanal</span><select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c} value={c}>{c === 'sms' ? 'SMS' : 'WhatsApp'}</option>)}</select></label>
      <label className="f" style={{ marginTop: 10 }}><span>Mesaj</span><textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} /></label>
      <div className="small muted" style={{ marginTop: 6 }}>Yer tutucular: {'{ad}'} {'{adsoyad}'} {'{puan}'} {'{firma}'} · Sadece ileti izni olan müşterilere gönderilir. {text.length} karakter.</div>
    </Modal>
  );
}
