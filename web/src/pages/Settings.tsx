import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, PageHead, Spinner, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDateTime } from '../util';

export default function Settings() {
  const [tab, setTab] = useState('company');
  return (
    <div>
      <PageHead title="Ayarlar" />
      <Tabs tabs={[{ key: 'company', label: 'Firma' }, { key: 'stores', label: 'Mağazalar' }, { key: 'pos', label: 'Kasa & satış kuralları' }, { key: 'receipt', label: 'Fiş & etiket' }, { key: 'messages', label: 'Otomatik mesajlar' }, { key: 'sizes', label: 'Numara serileri' }, { key: 'backup', label: 'Yedek & veri' }, { key: 'password', label: 'Şifrem' }]} value={tab} onChange={setTab} />
      {tab === 'company' && <Company />}
      {tab === 'stores' && <Stores />}
      {tab === 'pos' && <SettingsForm section="pos" />}
      {tab === 'receipt' && <SettingsForm section="receipt" />}
      {tab === 'messages' && <SettingsForm section="messages" />}
      {tab === 'sizes' && <SizeSeries />}
      {tab === 'backup' && <Backup />}
      {tab === 'password' && <Password />}
    </div>
  );
}

function Company() {
  const { toast, refresh } = useSession();
  const { data, loading } = useLoad(() => api.get('/settings'), []);
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data) setF(data.tenant); }, [data]);
  if (loading || !f) return <Spinner />;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return <div className="card" style={{ maxWidth: 700 }}>
    <div className="form">
      <label className="f full"><span>Firma unvanı</span><input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
      <label className="f"><span>VKN / TCKN</span><input value={f.tax_no ?? ''} onChange={(e) => set('tax_no', e.target.value)} /></label>
      <label className="f"><span>Vergi dairesi</span><input value={f.tax_office ?? ''} onChange={(e) => set('tax_office', e.target.value)} /></label>
      <label className="f"><span>Telefon</span><input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="f"><span>E-posta</span><input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="f full"><span>Adres</span><input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
    </div>
    <div className="small muted" style={{ marginTop: 10 }}>Firma kodu: <b>{f.code}</b> · Paket: {f.plan} · En fazla {f.max_stores} mağaza · Lisans: {f.license_until ?? 'süresiz'}</div>
    <button className="btn" style={{ marginTop: 12 }} onClick={async () => { try { await api.put('/settings', { tenant: { name: f.name, tax_no: f.tax_no, tax_office: f.tax_office, address: f.address, phone: f.phone, email: f.email } }); toast('Kaydedildi'); refresh(); } catch (e) { toast((e as Error).message, 'err'); } }}>Kaydet</button>
  </div>;
}

function Stores() {
  const { toast, refresh } = useSession();
  const { data, loading, reload } = useLoad(() => api.get('/stores'), []);
  const [edit, setEdit] = useState<any>(null);
  const rows: any[] = data ?? [];
  const save = async () => {
    try {
      const body = { code: edit.code, name: edit.name, city: edit.city || null, address: edit.address || null, phone: edit.phone || null, is_warehouse: !!edit.is_warehouse, active: edit.active !== 0 && edit.active !== false };
      if (edit.id) await api.put(`/stores/${edit.id}`, body); else await api.post('/stores', body);
      setEdit(null); reload(); refresh(); toast('Kaydedildi');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <div>
    <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}><button className="btn" onClick={() => setEdit({ code: '', name: '', active: true })}>+ Mağaza / depo ekle</button></div>
    <div className="card" style={{ padding: 0 }}>{loading ? <Spinner /> : <table><thead><tr><th>Kod</th><th>Ad</th><th>Şehir</th><th>Telefon</th><th>Tür</th><th>Durum</th><th /></tr></thead><tbody>{rows.map((s) => <tr key={s.id}><td className="bold">{s.code}</td><td>{s.name}</td><td>{s.city}</td><td>{s.phone}</td><td>{s.is_warehouse ? 'Depo' : 'Mağaza'}</td><td>{s.active ? <Badge kind="ok">Aktif</Badge> : <Badge>Pasif</Badge>}</td><td className="right"><button className="btn secondary sm" onClick={() => setEdit(s)}>Düzenle</button></td></tr>)}</tbody></table>}</div>
    <div className="small muted" style={{ marginTop: 8 }}>Mağaza kodu fiş numaralarında kullanılır (örn. KZL-000123). Depo, satış yapılmayan merkez stok alanıdır.</div>
    {edit && <Modal title={edit.id ? 'Mağaza düzenle' : 'Yeni mağaza'} onClose={() => setEdit(null)} narrow footer={<><button className="btn secondary" onClick={() => setEdit(null)}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
      <div className="col">
        <label className="f"><span>Kod (2-4 harf) *</span><input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} maxLength={10} /></label>
        <label className="f"><span>Ad *</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <label className="f"><span>Şehir</span><input value={edit.city ?? ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></label>
        <label className="f"><span>Adres (fişte görünür)</span><input value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
        <label className="f"><span>Telefon</span><input value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={!!edit.is_warehouse} onChange={(e) => setEdit({ ...edit, is_warehouse: e.target.checked })} /> Depo (satış yapılmaz)</label>
        {edit.id && <label className="check"><input type="checkbox" checked={edit.active !== 0 && edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Aktif</label>}
      </div>
    </Modal>}
  </div>;
}

const FIELDS: Record<string, { key: string; label: string; type: 'bool' | 'number' | 'text' | 'textarea' | 'store'; help?: string }[]> = {
  pos: [
    { key: 'requireOpenRegister', label: 'Satış için kasanın açık olması zorunlu', type: 'bool', help: 'Kapalıysa gün sonu raporu ve kasa farkı takibi yapılamaz' },
    { key: 'allowNegativeStock', label: 'Stokta görünmeyen ürün satılabilsin (eksi stok)', type: 'bool', help: 'Açıksa stok hataları için uyarı verilmez; önerilmez' },
    { key: 'maxDiscountPercent', label: 'Kasiyerin yapabileceği en yüksek indirim (%)', type: 'number', help: 'Üzeri için müdür/patron yetkisi gerekir' },
    { key: 'requireSalesperson', label: 'Satışta danışman seçimi zorunlu', type: 'bool' },
  ],
  receipt: [
    { key: 'header', label: 'Fiş başlığı (firma adı, adres, telefon)', type: 'textarea' },
    { key: 'footer', label: 'Fiş alt yazısı', type: 'textarea' },
    { key: 'showSalesperson', label: 'Fişte danışman adı görünsün', type: 'bool' },
  ],
  messages: [
    { key: 'birthdayEnabled', label: 'Doğum günü mesajı otomatik gönderilsin', type: 'bool', help: 'SMS/WhatsApp entegrasyonu açık ve müşterinin ileti izni olmalı' },
    { key: 'birthdayText', label: 'Doğum günü mesajı', type: 'textarea', help: '{ad} {adsoyad} {firma}' },
    { key: 'orderArrivedText', label: '"Siparişiniz geldi" mesajı', type: 'textarea', help: '{ad} {urun} {magaza}' },
    { key: 'debtReminderText', label: 'Veresiye hatırlatma mesajı', type: 'textarea', help: '{ad} {tutar} {firma}' },
  ],
};

function SettingsForm({ section }: { section: string }) {
  const { toast, refresh } = useSession();
  const { data, loading } = useLoad(() => api.get('/settings'), []);
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  if (loading || !f) return <Spinner />;
  const s = f[section];
  const set = (k: string, v: unknown) => setF({ ...f, [section]: { ...s, [k]: v } });
  const extra = section === 'pos' ? <>
    <label className="f"><span>Sadakat puanı: harcamanın %'si puan olarak birikir (0 = kapalı)</span><input type="number" min={0} max={100} value={f.loyalty.earnPercent} onChange={(e) => setF({ ...f, loyalty: { ...f.loyalty, earnPercent: Number(e.target.value), enabled: Number(e.target.value) > 0 } })} /><span className="small muted">1 puan = 1 kuruş; müşteri kasada puanla ödeme yapabilir.</span></label>
    <label className="f"><span>İade süresi (gün)</span><input type="number" min={0} value={f.returns.daysLimit} onChange={(e) => setF({ ...f, returns: { ...f.returns, daysLimit: Number(e.target.value) } })} /><span className="small muted">Süre geçince iade için müdür/patron yetkisi gerekir.</span></label>
    <label className="f"><span>Ölü stok eşiği (gün)</span><input type="number" min={7} value={f.stock.deadStockDays} onChange={(e) => setF({ ...f, stock: { ...f.stock, deadStockDays: Number(e.target.value) } })} /></label>
    <label className="check"><input type="checkbox" checked={!!f.einvoice.autoSend} onChange={(e) => setF({ ...f, einvoice: { ...f.einvoice, autoSend: e.target.checked } })} /> Her satış için otomatik e-Arşiv fatura kes (entegrasyon açıksa)</label>
  </> : section === 'receipt' ? <>
    <div className="grid c2"><label className="f"><span>Etiket genişliği (mm)</span><input type="number" value={f.label.widthMm} onChange={(e) => setF({ ...f, label: { ...f.label, widthMm: Number(e.target.value) } })} /></label><label className="f"><span>Etiket yüksekliği (mm)</span><input type="number" value={f.label.heightMm} onChange={(e) => setF({ ...f, label: { ...f.label, heightMm: Number(e.target.value) } })} /></label></div>
    <label className="check"><input type="checkbox" defaultChecked={localStorage.getItem('dc_autoprint') === '1'} onChange={(e) => localStorage.setItem('dc_autoprint', e.target.checked ? '1' : '0')} /> Bu bilgisayarda satış sonrası fiş penceresi otomatik açılsın</label>
  </> : null;
  return <div className="card" style={{ maxWidth: 700 }}>
    <div className="col">
      {FIELDS[section].map((fd) => fd.type === 'bool' ? <label key={fd.key} className="check"><input type="checkbox" checked={!!s[fd.key]} onChange={(e) => set(fd.key, e.target.checked)} /> {fd.label}{fd.help && <span className="small muted"> — {fd.help}</span>}</label>
        : <label key={fd.key} className="f"><span>{fd.label}</span>{fd.type === 'textarea' ? <textarea value={s[fd.key] ?? ''} onChange={(e) => set(fd.key, e.target.value)} /> : <input type={fd.type === 'number' ? 'number' : 'text'} value={s[fd.key] ?? ''} onChange={(e) => set(fd.key, fd.type === 'number' ? Number(e.target.value) : e.target.value)} />}{fd.help && <span className="small muted">{fd.help}</span>}</label>)}
      {extra}
    </div>
    <button className="btn" style={{ marginTop: 14 }} onClick={async () => { try { await api.put('/settings', { settings: f }); toast('Ayarlar kaydedildi'); refresh(); } catch (e) { toast((e as Error).message, 'err'); } }}>Kaydet</button>
  </div>;
}

function SizeSeries() {
  const { toast } = useSession();
  const { data, loading, reload } = useLoad(() => api.get('/catalog/meta'), []);
  const [edit, setEdit] = useState<any>(null);
  if (loading || !data) return <Spinner />;
  const save = async () => {
    try { await api.post('/catalog/size-series', { id: edit.id, name: edit.name, sizes: edit.sizes.split(/[\s,]+/).filter(Boolean), assortment: edit.assortment ? edit.assortment.split(/[\s,]+/).filter(Boolean).map(Number) : null }); setEdit(null); reload(); toast('Kaydedildi'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <div>
    <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}><button className="btn" onClick={() => setEdit({ name: '', sizes: '', assortment: '' })}>+ Seri ekle</button></div>
    <div className="card" style={{ padding: 0 }}><table><thead><tr><th>Seri</th><th>Numaralar</th><th>Koli asortisi</th><th /></tr></thead><tbody>{data.sizeSeries.map((s: any) => <tr key={s.id}><td className="bold">{s.name}</td><td>{s.sizes.join(' ')}</td><td className="muted">{s.assortment?.join(' ') ?? '—'}</td><td className="right nowrap"><button className="btn secondary sm" onClick={() => setEdit({ ...s, sizes: s.sizes.join(' '), assortment: s.assortment?.join(' ') ?? '' })}>Düzenle</button> <button className="btn ghost sm" onClick={async () => { await api.del(`/catalog/size-series/${s.id}`); reload(); }}>Sil</button></td></tr>)}</tbody></table></div>
    <div className="small muted" style={{ marginTop: 8 }}>Yeni ürün açarken seri seçilince numaralar otomatik gelir. Asorti: her numaradan kaç çift geldiği (sipariş planlaması için).</div>
    {edit && <Modal title="Numara serisi" onClose={() => setEdit(null)} narrow footer={<><button className="btn secondary" onClick={() => setEdit(null)}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}><div className="col"><label className="f"><span>Ad</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label><label className="f"><span>Numaralar (boşlukla)</span><input value={edit.sizes} onChange={(e) => setEdit({ ...edit, sizes: e.target.value })} placeholder="36 37 38 39 40" /></label><label className="f"><span>Asorti (isteğe bağlı)</span><input value={edit.assortment} onChange={(e) => setEdit({ ...edit, assortment: e.target.value })} placeholder="1 2 3 2 1" /></label></div></Modal>}
  </div>;
}

function Backup() {
  const { toast } = useSession();
  const { data, reload } = useLoad(() => api.get('/backups'), []);
  return <div className="grid c2">
    <div className="card"><h2>Yedekler</h2><p className="small muted">Sunucu her 6 saatte bir otomatik yedek alır; son 14 yedek saklanır. Yedek dosyaları sunucudaki <code>data/backups</code> klasöründedir.</p>
      <button className="btn" onClick={async () => { try { await api.post('/backups'); toast('Yedek alındı'); reload(); } catch (e) { toast((e as Error).message, 'err'); } }}>Şimdi yedek al</button>
      {data && data.length > 0 ? <table style={{ marginTop: 10 }}><tbody>{data.map((b: any) => <tr key={b.file}><td className="mono small">{b.file}</td><td className="num small">{(b.size / 1048576).toFixed(1)} MB</td><td className="small">{fmtDateTime(b.created.replace('T', ' '))}</td></tr>)}</tbody></table> : <Empty text="Henüz yedek yok" />}
    </div>
    <div className="card"><h2>Veri dışa aktarma</h2><p className="small muted">Tüm firma verinizi (ürün, stok, müşteri, satış, cari) JSON olarak indirin. Muhasebe, taşınma veya KVKK talepleri için.</p>
      <button className="btn secondary" onClick={() => { const t = localStorage.getItem('dc_token'); fetch('/api/export', { headers: { Authorization: 'Bearer ' + t } }).then((r) => r.blob()).then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'dc-ayakkabi-veri.json'; a.click(); }); }}>⬇ Tüm veriyi indir (JSON)</button>
    </div>
  </div>;
}

function Password() {
  const { toast } = useSession();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  return <div className="card" style={{ maxWidth: 400 }}><div className="col">
    <label className="f"><span>Mevcut şifre</span><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
    <label className="f"><span>Yeni şifre (en az 6 karakter)</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
    <label className="f"><span>Yeni şifre (tekrar)</span><input type="password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
    <button className="btn" disabled={!cur || next.length < 6 || next !== again} onClick={async () => { try { const r = await api.post('/auth/change-password', { current: cur, next }); localStorage.setItem('dc_token', r.token); toast('Şifre değiştirildi'); setCur(''); setNext(''); setAgain(''); } catch (e) { toast((e as Error).message, 'err'); } }}>Şifreyi değiştir</button>
  </div></div>;
}
