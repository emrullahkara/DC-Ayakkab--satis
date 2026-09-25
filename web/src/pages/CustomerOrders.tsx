import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Empty, Modal, MoneyInput, PageHead, Search, Spinner, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, fmtDateTime, tl } from '../util';
import { CustomerPicker } from './Customers';

const ST: Record<string, [string, 'ok' | 'warn' | 'info' | 'danger' | '']> = { open: ['Yeni', 'warn'], ordered: ['Tedarikçiye sipariş verildi', 'info'], arrived: ['Mağazaya geldi', 'ok'], notified: ['Müşteriye haber verildi', 'ok'], delivered: ['Teslim edildi', ''], cancelled: ['İptal', 'danger'] };

export default function CustomerOrders() {
  const { toast } = useSession();
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const { data, loading, reload } = useLoad(() => api.get('/customer-orders', { status: tab === 'all' ? undefined : tab, q }), [tab, q]);
  const rows: any[] = data ?? [];
  const setStatus = async (o: any, status: string, extra: any = {}) => {
    try {
      const r = await api.post(`/customer-orders/${o.id}/status`, { status, ...extra });
      toast(r.messageSent ? 'Durum güncellendi, müşteriye mesaj gönderildi' : 'Durum güncellendi');
      reload(); setOpen(null);
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div>
      <PageHead title="Müşteri Siparişleri"><button className="btn" onClick={() => setCreate(true)}>+ Yeni sipariş / kapora</button></PageHead>
      <div className="alert info" style={{ marginBottom: 12 }}>"Bu numara yok, getirtelim" durumları için: sipariş açın, kapora alın, ürün gelince müşteriye haber verin, teslimatı kasadan "Teslim et" ile yapın (kapora düşülür).</div>
      <Tabs tabs={[{ key: 'active', label: 'Açık siparişler' }, { key: 'arrived', label: 'Gelenler' }, { key: 'delivered', label: 'Teslim edilen' }, { key: 'cancelled', label: 'İptal' }, { key: 'all', label: 'Hepsi' }]} value={tab} onChange={setTab} />
      <div className="row" style={{ marginBottom: 10 }}><Search value={q} onChange={setQ} placeholder="Sipariş no, müşteri, ürün" /></div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>No</th><th>Tarih</th><th>Müşteri</th><th>Ürün</th><th>Mağaza</th><th>Söz</th><th className="num">Fiyat</th><th className="num">Kapora</th><th>Durum</th></tr></thead>
        <tbody>{rows.map((o) => <tr key={o.id} className="click" onClick={() => setOpen(o)} style={o.due_date && o.due_date < new Date().toISOString().slice(0, 10) && ['open', 'ordered'].includes(o.status) ? { background: '#fff5f5' } : {}}><td className="bold">{o.order_no}</td><td>{fmtDate(o.created_at)}</td><td><Link to={`/musteriler/${o.customer_id}`} onClick={(e) => e.stopPropagation()}>{o.customer_name}</Link><br /><span className="small muted">{o.customer_phone}</span></td><td>{o.description} × {o.qty}</td><td>{o.store_name}</td><td>{fmtDate(o.due_date)}</td><td className="num">{tl(o.price)}</td><td className="num">{tl(o.deposit)}</td><td><Badge kind={ST[o.status][1]}>{ST[o.status][0]}</Badge></td></tr>)}</tbody>
      </table></div>}</div>
      {create && <CreateOrder onClose={() => setCreate(false)} onDone={() => { setCreate(false); reload(); }} />}
      {open && <Modal title={`${open.order_no} — ${open.customer_name}`} onClose={() => setOpen(null)} footer={<>
        {['open', 'ordered', 'arrived', 'notified'].includes(open.status) && <button className="btn danger" onClick={() => { const rm = open.deposit > 0 ? (confirm('Kapora nakit iade edilsin mi? (İptal = iade yok)') ? 'cash' : undefined) : undefined; setStatus(open, 'cancelled', { refundMethod: rm }); }}>İptal et</button>}
        <span className="grow" />
        {open.status === 'open' && <button className="btn secondary" onClick={() => setStatus(open, 'ordered')}>Tedarikçiye sipariş verildi</button>}
        {['open', 'ordered'].includes(open.status) && <button className="btn ok" onClick={() => setStatus(open, 'arrived', { notify: true })}>Ürün geldi (müşteriye mesaj at)</button>}
        {['open', 'ordered'].includes(open.status) && <button className="btn secondary" onClick={() => setStatus(open, 'arrived', { notify: false })}>Geldi (mesajsız)</button>}
        {open.status === 'arrived' && <button className="btn secondary" onClick={() => setStatus(open, 'notified')}>Müşteriye haber verildi</button>}
        {['arrived', 'notified'].includes(open.status) && <Link to="/kasa" className="btn">Kasadan teslim et →</Link>}
      </>}>
        <dl className="kv">
          <dt>Ürün</dt><dd>{open.description} × {open.qty}</dd><dt>Fiyat</dt><dd>{tl(open.price)}</dd><dt>Kapora</dt><dd>{tl(open.deposit)} {open.deposit_method && `(${open.deposit_method})`}</dd>
          <dt>Kalan</dt><dd>{tl(open.price * open.qty - open.deposit)}</dd><dt>Söz verilen tarih</dt><dd>{fmtDate(open.due_date) || '—'}</dd><dt>Mağaza</dt><dd>{open.store_name}</dd>
          <dt>Telefon</dt><dd>{open.customer_phone}</dd><dt>Not</dt><dd>{open.note ?? '—'}</dd><dt>Son güncelleme</dt><dd>{fmtDateTime(open.updated_at)}</dd>
          {open.receipt_no && <><dt>Teslim fişi</dt><dd>{open.receipt_no}</dd></>}
        </dl>
      </Modal>}
    </div>
  );
}

function CreateOrder({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { storeId, toast } = useSession();
  const [customer, setCustomer] = useState<any>(null);
  const [pick, setPick] = useState(false);
  const [variant, setVariant] = useState<any>(null);
  const [scan, setScan] = useState('');
  const [f, setF] = useState<any>({ description: '', qty: 1, price: 0, deposit: 0, depositMethod: 'cash', dueDate: '', note: '' });
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const find = async () => {
    try { const v = await api.get(`/pos/barcode/${scan.trim()}`); setVariant(v); set('price', v.price); set('description', `${v.code} ${v.name} - ${v.color} - ${v.size} numara`); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const save = async () => {
    if (!customer) return toast('Müşteri seçin', 'err');
    try {
      await api.post('/customer-orders', { storeId, customerId: customer.id, variantId: variant?.id ?? null, ...f, dueDate: f.dueDate || undefined });
      toast('Sipariş oluşturuldu' + (f.deposit ? ', kapora kasaya işlendi' : ''));
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Modal title="Yeni müşteri siparişi" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
      <div className="col">
        <div className="row between"><span>Müşteri: <b>{customer ? `${customer.name} (${customer.phone ?? ''})` : '—'}</b></span><button className="btn secondary sm" onClick={() => setPick(true)}>Müşteri seç</button></div>
        <div className="row"><input placeholder="Varsa ürünün barkodunu okutun (başka mağazada / katalogda olan)" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} /><button className="btn secondary" onClick={find}>Bul</button></div>
        <label className="f"><span>Sipariş açıklaması (model / renk / numara) *</span><input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Örn. Derimod stiletto siyah 41 numara" /></label>
        <div className="grid c3">
          <label className="f"><span>Adet</span><input type="number" min={1} value={f.qty} onChange={(e) => set('qty', Number(e.target.value))} /></label>
          <label className="f"><span>Fiyat</span><MoneyInput value={f.price} onChange={(k) => set('price', k)} /></label>
          <label className="f"><span>Söz verilen tarih</span><input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></label>
          <label className="f"><span>Alınan kapora</span><MoneyInput value={f.deposit} onChange={(k) => set('deposit', k)} /></label>
          <label className="f"><span>Kapora ödeme şekli</span><select value={f.depositMethod} onChange={(e) => set('depositMethod', e.target.value)}><option value="cash">Nakit</option><option value="card">Kart</option><option value="transfer">Havale</option></select></label>
        </div>
        <textarea placeholder="Not" value={f.note} onChange={(e) => set('note', e.target.value)} />
      </div>
      {pick && <CustomerPicker onClose={() => setPick(false)} onPick={(c) => { setCustomer(c); setPick(false); }} />}
    </Modal>
  );
}
