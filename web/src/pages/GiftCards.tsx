import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, MoneyInput, PageHead, Search, Spinner } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, tl } from '../util';
import { CustomerPicker } from './Customers';

export default function GiftCards() {
  const { toast, storeId } = useSession();
  const [q, setQ] = useState('');
  const [sell, setSell] = useState(false);
  const { data, loading, reload } = useLoad(() => api.get('/giftcards', { q }), [q]);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHead title="Hediye Çekleri"><button className="btn" onClick={() => setSell(true)}>+ Hediye çeki sat</button></PageHead>
      <div className="alert info" style={{ marginBottom: 12 }}>Hediye çeki satışı kasaya gelir olarak girer; çek kasada "Hediye çeki" ödeme türüyle kullanılır. İadelerde de müşteriye mağaza kredisi olarak çek verilebilir.</div>
      <div className="row" style={{ marginBottom: 10 }}><Search value={q} onChange={setQ} placeholder="Çek kodu veya müşteri" /></div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>Kod</th><th>Müşteri</th><th className="num">Yüklenen</th><th className="num">Bakiye</th><th>Son kullanma</th><th>Oluşturma</th><th>Not</th><th>Durum</th></tr></thead>
        <tbody>{rows.map((g) => { const expired = g.expires_at && g.expires_at < new Date().toISOString().slice(0, 10); return <tr key={g.id}><td className="bold mono">{g.code}</td><td>{g.customer_name}</td><td className="num">{tl(g.initial_amount)}</td><td className="num bold">{tl(g.balance)}</td><td>{fmtDate(g.expires_at)}</td><td>{fmtDate(g.created_at)}</td><td className="small">{g.note}</td><td>{!g.active ? <Badge kind="danger">İptal</Badge> : expired ? <Badge kind="danger">Süresi doldu</Badge> : g.balance === 0 ? <Badge>Kullanıldı</Badge> : <Badge kind="ok">Geçerli</Badge>}</td></tr>; })}</tbody>
      </table></div>}</div>
      {sell && <SellModal onClose={() => setSell(false)} onDone={(g) => { setSell(false); reload(); toast(`Hediye çeki oluşturuldu: ${g.code}`); }} storeId={storeId!} />}
    </div>
  );
}

function SellModal({ storeId, onClose, onDone }: { storeId: number; onClose: () => void; onDone: (g: any) => void }) {
  const { toast } = useSession();
  const [amount, setAmount] = useState(50000);
  const [method, setMethod] = useState('cash');
  const [days, setDays] = useState(365);
  const [customer, setCustomer] = useState<any>(null);
  const [pick, setPick] = useState(false);
  const [note, setNote] = useState('');
  const save = async () => {
    try { onDone(await api.post('/giftcards/sell', { storeId, amount, method, validDays: days, customerId: customer?.id ?? null, note: note || undefined })); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return <Modal title="Hediye çeki sat" onClose={onClose} narrow footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn ok" onClick={save}>Sat ve kod üret</button></>}>
    <div className="col">
      <label className="f"><span>Tutar</span><MoneyInput value={amount} onChange={setAmount} autoFocus /></label>
      <div className="chips">{[250, 500, 1000, 2000].map((v) => <button key={v} className="chip" onClick={() => setAmount(v * 100)}>{v} ₺</button>)}</div>
      <label className="f"><span>Ödeme</span><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Nakit</option><option value="card">Kart</option><option value="transfer">Havale</option></select></label>
      <label className="f"><span>Geçerlilik (gün)</span><input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
      <div className="row between"><span>Müşteri: <b>{customer?.name ?? 'Belirtilmedi'}</b></span><button className="btn secondary sm" onClick={() => setPick(true)}>Seç</button></div>
      <input placeholder="Not (kime hediye vb.)" value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
    {pick && <CustomerPicker onClose={() => setPick(false)} onPick={(c) => { setCustomer(c); setPick(false); }} />}
  </Modal>;
}
