import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, MoneyInput, PageHead, Spinner, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, fmtDateTime, tl } from '../util';

export default function Suppliers() {
  const { toast } = useSession();
  const [edit, setEdit] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  const { data, loading, reload } = useLoad(() => api.get('/suppliers'), []);
  const rows: any[] = data ?? [];
  const totalDebt = rows.reduce((a, s) => a + Math.max(0, s.balance), 0);
  return (
    <div>
      <PageHead title="Tedarikçiler & Borçlar"><button className="btn" onClick={() => setEdit({})}>+ Yeni tedarikçi</button></PageHead>
      <div className="grid c3" style={{ marginBottom: 12 }}><div className="stat accent"><div className="label">Toplam tedarikçi borcu</div><div className="value">{tl(totalDebt)}</div></div><div className="stat"><div className="label">Vadesi 7 gün içinde</div><div className="value">{rows.filter((s) => s.balance > 0 && s.first_due && s.first_due <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length} tedarikçi</div></div><div className="stat"><div className="label">Aktif tedarikçi</div><div className="value">{rows.filter((s) => s.active).length}</div></div></div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>Tedarikçi</th><th>İlgili</th><th>Telefon</th><th>Vade (gün)</th><th className="num">Ürün</th><th>İlk vade</th><th className="num">Borç</th></tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id} className="click" onClick={() => setOpen(s.id)} style={s.active ? {} : { opacity: 0.5 }}><td className="bold">{s.name}</td><td>{s.contact_name}</td><td>{s.phone}</td><td>{s.payment_term_days}</td><td className="num">{s.product_count}</td><td>{s.balance > 0 && s.first_due ? <span className={s.first_due < new Date().toISOString().slice(0, 10) ? 'danger bold' : ''}>{fmtDate(s.first_due)}</span> : ''}</td><td className={'num bold ' + (s.balance > 0 ? 'danger' : '')}>{tl(s.balance)}</td></tr>)}</tbody>
      </table></div>}</div>
      {edit && <SupplierForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast('Kaydedildi'); }} />}
      {open && <SupplierDetail id={open} onClose={() => setOpen(null)} onChanged={reload} onEdit={(s) => { setOpen(null); setEdit(s); }} />}
    </div>
  );
}

function SupplierForm({ value, onClose, onSaved }: { value: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useSession();
  const [f, setF] = useState<any>({ payment_term_days: 30, ...value });
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const body = { name: f.name, contact_name: f.contact_name, phone: f.phone, email: f.email, tax_no: f.tax_no, tax_office: f.tax_office, address: f.address, iban: f.iban, payment_term_days: Number(f.payment_term_days), notes: f.notes, active: f.active !== 0 && f.active !== false };
      if (f.id) await api.put(`/suppliers/${f.id}`, body); else await api.post('/suppliers', body);
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <Modal title={f.id ? 'Tedarikçi düzenle' : 'Yeni tedarikçi'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
    <div className="form">
      <label className="f full"><span>Firma adı *</span><input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
      <label className="f"><span>İlgili kişi</span><input value={f.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} /></label>
      <label className="f"><span>Telefon</span><input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="f"><span>E-posta</span><input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="f"><span>Vade (gün)</span><input type="number" value={f.payment_term_days ?? 30} onChange={(e) => set('payment_term_days', e.target.value)} /></label>
      <label className="f"><span>VKN</span><input value={f.tax_no ?? ''} onChange={(e) => set('tax_no', e.target.value)} /></label>
      <label className="f"><span>Vergi dairesi</span><input value={f.tax_office ?? ''} onChange={(e) => set('tax_office', e.target.value)} /></label>
      <label className="f full"><span>IBAN</span><input value={f.iban ?? ''} onChange={(e) => set('iban', e.target.value)} /></label>
      <label className="f full"><span>Adres</span><input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
      <label className="f full"><span>Notlar</span><textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></label>
      {f.id && <label className="check"><input type="checkbox" checked={f.active !== 0 && f.active !== false} onChange={(e) => set('active', e.target.checked)} /> Aktif</label>}
    </div>
  </Modal>;
}

const LT: Record<string, string> = { invoice: 'Fatura (borç)', payment: 'Ödeme', return: 'İade', adjust: 'Düzeltme' };

function SupplierDetail({ id, onClose, onChanged, onEdit }: { id: number; onClose: () => void; onChanged: () => void; onEdit: (s: any) => void }) {
  const { toast, storeId } = useSession();
  const { data: s, loading, reload } = useLoad(() => api.get(`/suppliers/${id}`), [id]);
  const [tab, setTab] = useState('ledger');
  const [entry, setEntry] = useState<string | null>(null);
  const [f, setF] = useState<any>({ amount: 0, method: 'transfer', dueDate: '', docNo: '', note: '' });
  if (loading && !s) return <Modal title="Tedarikçi" onClose={onClose}><Spinner /></Modal>;
  const save = async () => {
    try {
      await api.post(`/suppliers/${id}/entry`, { type: entry, amount: f.amount, method: f.method, storeId: entry === 'payment' ? storeId : undefined, dueDate: f.dueDate || undefined, docNo: f.docNo || undefined, note: f.note || undefined });
      toast('Kaydedildi'); setEntry(null); reload(); onChanged();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <Modal title={<>{s.name} <Badge kind={s.balance > 0 ? 'danger' : 'ok'}>Borç: {tl(s.balance)}</Badge></>} onClose={onClose} wide footer={<>
    <button className="btn secondary" onClick={() => onEdit(s)}>✎ Düzenle</button><span className="grow" />
    <button className="btn secondary" onClick={() => setEntry('invoice')}>+ Fatura gir</button><button className="btn secondary" onClick={() => setEntry('return')}>İade / iskonto</button><button className="btn ok" onClick={() => setEntry('payment')}>💸 Ödeme yap</button>
  </>}>
    <div className="small muted">{s.contact_name} · {s.phone} · {s.email} · Vade {s.payment_term_days} gün{s.iban && <> · IBAN {s.iban}</>}</div>
    <Tabs tabs={[{ key: 'ledger', label: 'Cari hareketler' }, { key: 'orders', label: 'Siparişler' }]} value={tab} onChange={setTab} />
    {tab === 'ledger' && (s.ledger.length === 0 ? <Empty /> : <table><thead><tr><th>Tarih</th><th>İşlem</th><th>Belge</th><th>Vade</th><th>Açıklama</th><th className="num">Borç</th><th className="num">Ödeme</th></tr></thead><tbody>{s.ledger.map((l: any) => <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{LT[l.type]}</td><td>{l.doc_no}</td><td>{fmtDate(l.due_date)}</td><td className="small">{l.note}{l.method && ` · ${l.method}`}</td><td className="num danger">{l.amount > 0 ? tl(l.amount) : ''}</td><td className="num ok">{l.amount < 0 ? tl(-l.amount) : ''}</td></tr>)}</tbody></table>)}
    {tab === 'orders' && (s.orders.length === 0 ? <Empty /> : <table><thead><tr><th>No</th><th>Tarih</th><th>Mağaza</th><th>Durum</th><th className="num">Tutar</th></tr></thead><tbody>{s.orders.map((o: any) => <tr key={o.id}><td>{o.order_no}</td><td>{fmtDate(o.created_at)}</td><td>{o.store_name}</td><td>{o.status}</td><td className="num">{tl(o.total)}</td></tr>)}</tbody></table>)}
    {entry && <Modal title={LT[entry]} onClose={() => setEntry(null)} narrow footer={<><button className="btn secondary" onClick={() => setEntry(null)}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
      <div className="col">
        <label className="f"><span>Tutar (KDV dahil)</span><MoneyInput value={f.amount} onChange={(k) => setF({ ...f, amount: k })} autoFocus /></label>
        {entry === 'payment' && <label className="f"><span>Ödeme şekli</span><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="transfer">Havale / EFT</option><option value="cash">Nakit (mağaza kasasından)</option><option value="card">Kart</option><option value="check">Çek / senet</option></select></label>}
        {entry === 'invoice' && <label className="f"><span>Vade tarihi (boş = firma vadesi)</span><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>}
        <label className="f"><span>Belge / fatura no</span><input value={f.docNo} onChange={(e) => setF({ ...f, docNo: e.target.value })} /></label>
        <label className="f"><span>Açıklama</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      </div>
    </Modal>}
  </Modal>;
}
