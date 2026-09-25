import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, Empty, ErrorBox, Modal, MoneyInput, PageHead, Spinner, Tabs } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, fmtDateTime, tl, SALE_TYPE } from '../util';
import { CustomerForm, MessageModal } from './Customers';

const ORDER_STATUS: Record<string, string> = { open: 'Yeni', ordered: 'Sipariş verildi', arrived: 'Geldi', notified: 'Haber verildi', delivered: 'Teslim', cancelled: 'İptal' };

export default function CustomerDetail() {
  const { id } = useParams();
  const { can, toast, storeId } = useSession();
  const { data: c, error, loading, reload } = useLoad(() => api.get(`/customers/${id}`), [id]);
  const [tab, setTab] = useState('sales');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [msg, setMsg] = useState(false);
  if (loading && !c) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div>
      <PageHead title={<><Link to="/musteriler">Müşteriler</Link> / {c.name}</>}>
        {can('messages') && c.phone && <button className="btn secondary" onClick={() => setMsg(true)}>✉ Mesaj</button>}
        {can('customers.credit') && c.balance > 0 && <button className="btn ok" onClick={() => setPay(true)}>💵 Tahsilat al</button>}
        {can('customers.credit') && <button className="btn secondary" onClick={() => setAdjust(true)}>Cari düzeltme</button>}
        <button className="btn" onClick={() => setEdit(true)}>✎ Düzenle</button>
      </PageHead>
      <div className="grid c4" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="label">Toplam alışveriş</div><div className="value">{tl(c.stats.total_spent)}</div><div className="sub">{c.stats.visits} ziyaret · {c.stats.pairs} çift</div></div>
        <div className="stat"><div className="label">Puan bakiyesi</div><div className="value">{tl(c.points)}</div><div className="sub">satışta kullanılabilir</div></div>
        <div className={'stat' + (c.balance > 0 ? ' accent' : '')}><div className="label">Veresiye borcu</div><div className="value">{tl(c.balance)}</div><div className="sub">limit {tl(c.credit_limit)}</div></div>
        <div className="stat"><div className="label">Son alışveriş</div><div className="value" style={{ fontSize: 18 }}>{fmtDate(c.stats.last_purchase) || '—'}</div><div className="sub">ilk: {fmtDate(c.stats.first_purchase) || '—'}</div></div>
      </div>
      <div className="grid c3" style={{ marginBottom: 14 }}>
        <div className="card">
          <dl className="kv">
            <dt>Telefon</dt><dd>{c.phone ?? '—'}</dd>
            <dt>E-posta</dt><dd>{c.email ?? '—'}</dd>
            <dt>Doğum</dt><dd>{fmtDate(c.birth_date) || '—'}</dd>
            <dt>Numara</dt><dd>{c.shoe_size ?? '—'}</dd>
            <dt>Şehir</dt><dd>{c.city ?? '—'}</dd>
            <dt>İzinler</dt><dd>{c.kvkk_consent ? <Badge kind="ok">KVKK</Badge> : <Badge>KVKK yok</Badge>} {c.sms_consent ? <Badge kind="ok">İleti izni</Badge> : <Badge>İleti izni yok</Badge>}</dd>
          </dl>
        </div>
        <div className="card"><h3>Notlar</h3><div style={{ whiteSpace: 'pre-wrap' }}>{c.notes || <span className="muted">—</span>}</div>
          {c.giftCards.length > 0 && <><h3 style={{ marginTop: 12 }}>Hediye çekleri</h3>{c.giftCards.map((g: any) => <div key={g.code}><b>{g.code}</b> · {tl(g.balance)} · {fmtDate(g.expires_at)}'e kadar</div>)}</>}
        </div>
        <div className="card"><h3>Aldığı ürünler</h3>
          {c.products.length === 0 ? <span className="muted">—</span> : <table>{c.products.slice(0, 8).map((p: any) => <tbody key={p.code + p.color + p.size}><tr><td>{p.code} {p.name}<br /><span className="small muted">{p.color} · {p.size}</span></td><td className="num">{p.qty}</td><td className="small muted">{fmtDate(p.last_date)}</td></tr></tbody>)}</table>}
        </div>
      </div>
      <Tabs tabs={[{ key: 'sales', label: 'Satışlar', badge: c.sales.length }, { key: 'ledger', label: 'Cari hareketler', badge: c.ledger.length }, { key: 'orders', label: 'Siparişler', badge: c.orders.length }]} value={tab} onChange={setTab} />
      <div className="card" style={{ padding: 0 }}>
        {tab === 'sales' && (c.sales.length === 0 ? <Empty /> : <div className="table-wrap"><table>
          <thead><tr><th>Tarih</th><th>Fiş</th><th>Tür</th><th>Mağaza</th><th className="num">Çift</th><th className="num">Tutar</th></tr></thead>
          <tbody>{c.sales.map((s: any) => <tr key={s.id}><td>{fmtDateTime(s.created_at)}</td><td><Link to={`/satislar?fis=${s.receipt_no}`}>{s.receipt_no}</Link></td><td>{SALE_TYPE[s.type]}{s.status === 'cancelled' && <Badge kind="danger">İptal</Badge>}</td><td>{s.store_name}</td><td className="num">{s.item_count}</td><td className="num bold">{tl(s.total)}</td></tr>)}</tbody>
        </table></div>)}
        {tab === 'ledger' && (c.ledger.length === 0 ? <Empty /> : <div className="table-wrap"><table>
          <thead><tr><th>Tarih</th><th>İşlem</th><th>Açıklama</th><th>Vade</th><th>Kullanıcı</th><th className="num">Borç</th><th className="num">Ödeme</th></tr></thead>
          <tbody>{c.ledger.map((l: any) => <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{{ sale: 'Veresiye satış', payment: 'Tahsilat', return: 'İade', adjust: 'Düzeltme' }[l.type as string]}</td><td>{l.note}</td><td>{fmtDate(l.due_date)}</td><td>{l.user_name}</td><td className="num danger">{l.amount > 0 ? tl(l.amount) : ''}</td><td className="num ok">{l.amount < 0 ? tl(-l.amount) : ''}</td></tr>)}</tbody>
        </table></div>)}
        {tab === 'orders' && (c.orders.length === 0 ? <Empty /> : <div className="table-wrap"><table>
          <thead><tr><th>No</th><th>Açıklama</th><th>Durum</th><th className="num">Fiyat</th><th className="num">Kapora</th><th>Tarih</th></tr></thead>
          <tbody>{c.orders.map((o: any) => <tr key={o.id}><td>{o.order_no}</td><td>{o.description}</td><td><Badge kind={o.status === 'arrived' ? 'ok' : o.status === 'cancelled' ? 'danger' : 'info'}>{ORDER_STATUS[o.status]}</Badge></td><td className="num">{tl(o.price)}</td><td className="num">{tl(o.deposit)}</td><td>{fmtDate(o.created_at)}</td></tr>)}</tbody>
        </table></div>)}
      </div>
      {edit && <CustomerForm value={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {msg && <MessageModal customerIds={[c.id]} onClose={() => setMsg(false)} />}
      {pay && <PayModal balance={c.balance} onClose={() => setPay(false)} onOk={async (amount, method, note) => { await api.post(`/customers/${c.id}/payment`, { storeId, amount, method, note }); toast('Tahsilat kaydedildi'); setPay(false); reload(); }} />}
      {adjust && <AdjustModal onClose={() => setAdjust(false)} onOk={async (amount, note) => { await api.post(`/customers/${c.id}/adjust`, { amount, note }); toast('Cari düzeltildi'); setAdjust(false); reload(); }} />}
    </div>
  );
}

function PayModal({ balance, onClose, onOk }: { balance: number; onClose: () => void; onOk: (amount: number, method: string, note: string) => Promise<void> }) {
  const { toast } = useSession();
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const go = () => onOk(amount, method, note).catch((e) => toast(e.message, 'err'));
  return (
    <Modal title="Veresiye tahsilatı" onClose={onClose} narrow footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn ok" onClick={go}>Tahsil et</button></>}>
      <div className="col">
        <div className="row between"><span>Mevcut borç</span><b>{tl(balance)}</b></div>
        <label className="f"><span>Tutar</span><MoneyInput value={amount} onChange={setAmount} autoFocus onEnter={go} /></label>
        <label className="f"><span>Ödeme şekli</span><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Nakit</option><option value="card">Kredi kartı</option><option value="transfer">Havale / EFT</option></select></label>
        <input placeholder="Not" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function AdjustModal({ onClose, onOk }: { onClose: () => void; onOk: (amount: number, note: string) => Promise<void> }) {
  const { toast } = useSession();
  const [amount, setAmount] = useState(0);
  const [dir, setDir] = useState<'debt' | 'credit'>('credit');
  const [note, setNote] = useState('');
  return (
    <Modal title="Cari düzeltme" onClose={onClose} narrow footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={() => onOk(dir === 'debt' ? amount : -amount, note).catch((e) => toast(e.message, 'err'))}>Kaydet</button></>}>
      <div className="col">
        <label className="f"><span>Yön</span><select value={dir} onChange={(e) => setDir(e.target.value as any)}><option value="credit">Borcu azalt (alacak)</option><option value="debt">Borç ekle</option></select></label>
        <label className="f"><span>Tutar</span><MoneyInput value={amount} onChange={setAmount} autoFocus /></label>
        <label className="f"><span>Açıklama *</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. eski defterden devir" /></label>
      </div>
    </Modal>
  );
}
