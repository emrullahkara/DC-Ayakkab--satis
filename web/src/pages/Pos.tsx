import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Badge, Modal, MoneyInput, Search } from '../components';
import { useSession } from '../store';
import { beep, PAY, tl } from '../util';
import { CustomerPicker } from './Customers';

interface CartItem { variantId: number; qty: number; unitPrice?: number; discount?: number; key: string }
interface Payment { method: string; amount: number; installments?: number; ref?: string }

export default function Pos() {
  const { session, storeId, store, toast, can } = useSession();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [quote, setQuote] = useState<any>(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [scan, setScan] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [salesperson, setSalesperson] = useState<number | ''>('');
  const [meta, setMeta] = useState<any>({ salespeople: [], campaigns: [], settings: {} });
  const [payOpen, setPayOpen] = useState(false);
  const [register, setRegister] = useState<any>(null);
  const [lastSale, setLastSale] = useState<any>(null);
  const [order, setOrder] = useState<any>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!storeId) return;
    api.get('/pos/meta', { storeId }).then(setMeta);
    api.get(`/register/${storeId}`).then(setRegister).catch(() => setRegister(null));
    setSalesperson(session?.user.id ?? '');
  }, [storeId, session]);

  // Sepet değişince sunucudan fiyat al
  useEffect(() => {
    if (!storeId) return;
    if (!cart.length) {
      setQuote(null);
      setQuoteErr('');
      return;
    }
    api.post('/pos/quote', { storeId, items: cart.map(({ key, ...c }) => c), cartDiscount })
      .then((q) => (setQuote(q), setQuoteErr('')))
      .catch((e) => setQuoteErr(e.message));
  }, [cart, cartDiscount, storeId]);

  const addVariant = useCallback((v: any) => {
    setCart((c) => {
      const ex = c.find((x) => x.variantId === v.id && !x.discount && x.unitPrice === undefined);
      if (ex) return c.map((x) => (x === ex ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { variantId: v.id, qty: 1, key: String(Math.random()) }];
    });
    beep(true);
    setResults(null);
    setScan('');
    scanRef.current?.focus();
  }, []);

  const onScan = async () => {
    const code = scan.trim();
    if (!code || !storeId) return;
    try {
      if (/^\d{8,14}$/.test(code)) {
        const v = await api.get(`/pos/barcode/${code}`);
        if (!v.active) throw new Error('Bu ürün pasif');
        const here = v.stock.find((s: any) => s.store_id === storeId)?.qty ?? 0;
        if (here <= 0 && !meta.settings.allowNegativeStock) {
          beep(false);
          const others = v.stock.filter((s: any) => s.qty > 0).map((s: any) => `${s.store_name}: ${s.qty}`).join(', ');
          toast(`${v.code} ${v.color} ${v.size} bu mağazada stokta yok. ${others ? 'Diğer: ' + others : ''}`, 'err');
          setScan('');
          return;
        }
        addVariant(v);
      } else {
        const r = await api.get('/pos/search', { q: code, storeId });
        if (!r.length) {
          beep(false);
          toast('Ürün bulunamadı: ' + code, 'err');
        } else setResults(r);
      }
    } catch (e) {
      beep(false);
      toast((e as Error).message, 'err');
      setScan('');
    }
  };

  const setQty = (key: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((x) => x.key !== key) : c.map((x) => (x.key === key ? { ...x, qty } : x))));
  const clear = () => {
    setCart([]);
    setCartDiscount(0);
    setCustomer(null);
    setOrder(null);
    setLastSale(null);
    scanRef.current?.focus();
  };

  const complete = async (payments: Payment[], einvoice: boolean, note: string) => {
    const s = await api.post('/pos/sale', {
      storeId, customerId: customer?.id ?? null, salespersonId: salesperson || null, customerOrderId: order?.id ?? null,
      items: cart.map(({ key, ...c }) => c), cartDiscount, payments, einvoice, note: note || null,
    });
    setPayOpen(false);
    setLastSale(s);
    setCart([]);
    setCartDiscount(0);
    setCustomer(null);
    setOrder(null);
    toast(`Satış tamamlandı · Fiş ${s.receipt_no}`);
    if (session?.settings.receipt && localStorage.getItem('dc_autoprint') === '1') window.open(`/yazdir/fis/${s.id}`, '_blank', 'width=400,height=700');
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') (e.preventDefault(), scanRef.current?.focus());
      if (e.key === 'F9' && cart.length && quote) (e.preventDefault(), setPayOpen(true));
      if (e.key === 'F4') (e.preventDefault(), setPickCustomer(true));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cart, quote]);

  if (!storeId) return <div className="alert warn">Önce üst çubuktan mağaza seçin.</div>;
  const regClosed = register && !register.open && meta.settings.requireOpenRegister !== false;

  return (
    <div className="pos">
      <div className="col">
        {regClosed && <div className="alert danger">Bu mağazada kasa açık değil. <a href="/kasa-islemleri">Kasayı aç →</a></div>}
        <div className="card tight scan">
          <div className="row">
            <input ref={scanRef} autoFocus placeholder="Barkod okutun veya model / ürün adı yazıp Enter'a basın (F2)" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onScan()} className="grow" />
            <button className="btn" onClick={onScan}>Ekle</button>
          </div>
          {meta.campaigns.length > 0 && <div className="row small muted" style={{ marginTop: 6 }}>Aktif kampanyalar: {meta.campaigns.map((c: any) => <Badge key={c.id} kind="info">{c.name}</Badge>)}</div>}
        </div>

        {results && (
          <div className="card">
            <div className="row between"><b>Arama sonuçları</b><button className="btn ghost sm" onClick={() => setResults(null)}>Kapat</button></div>
            {results.map((p) => (
              <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row between"><span><b>{p.code}</b> {p.name} <span className="muted">{p.brand}</span></span><b>{tl(p.sale_price)}</b></div>
                {[...new Set(p.variants.map((v: any) => v.color))].map((color) => (
                  <div key={String(color)} className="row" style={{ marginTop: 6 }}>
                    <span className="small muted" style={{ width: 80 }}>{String(color)}</span>
                    <div className="sizes">
                      {p.variants.filter((v: any) => v.color === color).map((v: any) => (
                        <button key={v.id} className={'size' + (v.qty <= 0 ? ' out' : '')} title={v.qty <= 0 ? `Bu mağazada yok · toplam ${v.total_qty}` : ''} onClick={() => (v.qty > 0 || meta.settings.allowNegativeStock ? addVariant(v) : toast(`${v.size} numara bu mağazada yok (diğer mağazalarda ${v.total_qty})`, 'err'))}>
                          <div className="n">{v.size}</div><div className="q">{v.qty} / {v.total_qty}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="card cart" style={{ padding: 0 }}>
          {cart.length === 0 ? (
            <div className="empty">
              Sepet boş. Barkod okutun veya ürün arayın.
              <div className="small" style={{ marginTop: 8 }}><kbd>F2</kbd> barkod · <kbd>F4</kbd> müşteri · <kbd>F9</kbd> ödeme</div>
              {lastSale && <div style={{ marginTop: 16 }}>Son satış: <b>{lastSale.receipt_no}</b> · {tl(lastSale.total)} <button className="btn secondary sm" onClick={() => window.open(`/yazdir/fis/${lastSale.id}`, '_blank', 'width=400,height=700')}>🖨 Fiş yazdır</button></div>}
            </div>
          ) : (
            <table>
              <thead><tr><th>Ürün</th><th>Adet</th><th className="num">Fiyat</th><th className="num">İndirim</th><th className="num">Tutar</th><th /></tr></thead>
              <tbody>
                {cart.map((c, i) => {
                  const l = quote?.lines?.[i];
                  return (
                    <tr key={c.key}>
                      <td>{l ? <><b>{l.code}</b> {l.name}<br /><span className="small muted">{l.color} · {l.size} numara{l.campaignName && <> · <Badge kind="info">{l.campaignName}</Badge></>}</span></> : '…'}</td>
                      <td><span className="qty"><button onClick={() => setQty(c.key, c.qty - 1)}>−</button><b>{c.qty}</b><button onClick={() => setQty(c.key, c.qty + 1)}>+</button></span></td>
                      <td className="num">
                        {can('prices.edit', 'sales.discount') ? (
                          <MoneyInput value={c.unitPrice ?? l?.listPrice ?? 0} onChange={(k) => setCart((cc) => cc.map((x) => (x.key === c.key ? { ...x, unitPrice: k === (l?.listPrice ?? 0) ? undefined : k } : x)))} className="right" />
                        ) : tl(l?.unitPrice)}
                      </td>
                      <td className="num"><MoneyInput value={c.discount ?? 0} onChange={(k) => setCart((cc) => cc.map((x) => (x.key === c.key ? { ...x, discount: k || undefined } : x)))} className="right" placeholder="0" /></td>
                      <td className="num bold">{l ? tl(l.lineTotal) : ''}</td>
                      <td><button className="btn ghost sm" onClick={() => setQty(c.key, 0)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="col">
        <div className="card">
          <div className="row between">
            <span className="muted small">Müşteri (F4)</span>
            {customer && <button className="btn ghost sm" onClick={() => (setCustomer(null), setOrder(null))}>Kaldır</button>}
          </div>
          {customer ? (
            <div>
              <b>{customer.name}</b> <span className="muted small">{customer.phone}</span>
              <div className="small">Puan: <b>{tl(customer.points)}</b>{customer.balance > 0 && <> · Borç: <b className="danger">{tl(customer.balance)}</b></>}{customer.credit_limit > 0 && <> · Limit: {tl(customer.credit_limit)}</>}</div>
              {customer.orders?.filter((o: any) => o.status === 'arrived' || o.status === 'notified').map((o: any) => (
                <div key={o.id} className="alert info small" style={{ marginTop: 6 }}>
                  Bekleyen sipariş: {o.description} · kapora {tl(o.deposit)}
                  {order?.id === o.id ? <Badge kind="ok">Seçili</Badge> : <button className="btn sm secondary" onClick={() => setOrder(o)}>Teslim et</button>}
                </div>
              ))}
            </div>
          ) : <button className="btn secondary block" onClick={() => setPickCustomer(true)}>👤 Müşteri seç / kaydet</button>}
        </div>

        <div className="card">
          <label className="f"><span>Satış danışmanı</span>
            <select value={salesperson} onChange={(e) => setSalesperson(Number(e.target.value))}>
              {meta.salespeople.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        <div className="card col" style={{ flex: 1 }}>
          <div className="row between"><span>Ara toplam</span><b>{tl(quote?.subtotal)}</b></div>
          {quote?.campaignDiscount > 0 && <div className="row between ok"><span>Kampanya indirimi</span><b>−{tl(quote.campaignDiscount)}</b></div>}
          {quote?.manualDiscount > 0 && <div className="row between"><span>Diğer indirim</span><b>−{tl(quote.manualDiscount)}</b></div>}
          <div className="row between"><span>Sepet indirimi</span><MoneyInput value={cartDiscount} onChange={setCartDiscount} className="right" placeholder="0" /></div>
          {quoteErr && <div className="alert danger small">{quoteErr}</div>}
          <div className="total">{tl(quote?.total)}</div>
          <div className="small muted right">KDV dahil · {cart.reduce((a, c) => a + c.qty, 0)} çift</div>
          <button className="btn accent lg block" disabled={!cart.length || !quote || !!quoteErr || !!regClosed} onClick={() => setPayOpen(true)}>Ödeme al (F9)</button>
          <button className="btn secondary block" disabled={!cart.length} onClick={clear}>Sepeti temizle</button>
        </div>
      </div>

      {pickCustomer && <CustomerPicker onClose={() => setPickCustomer(false)} onPick={async (c) => { const full = await api.get(`/customers/${c.id}`); setCustomer(full); setPickCustomer(false); }} />}
      {payOpen && quote && <PaymentModal total={quote.total} customer={customer} order={order} onClose={() => setPayOpen(false)} onDone={complete} einvoiceAvailable={true} />}
    </div>
  );
}

/** Ödeme penceresi: bölünmüş ödeme, taksit, hediye çeki, puan, veresiye, kapora */
export function PaymentModal({ total, customer, order, onClose, onDone, einvoiceAvailable, refund }: { total: number; customer: any; order?: any; onClose: () => void; onDone: (p: Payment[], einvoice: boolean, note: string) => Promise<void>; einvoiceAvailable?: boolean; refund?: boolean }) {
  const { toast } = useSession();
  const abs = Math.abs(total);
  const sign = total < 0 ? -1 : 1;
  const [pays, setPays] = useState<Payment[]>([]);
  const [amount, setAmount] = useState(abs);
  const [inst, setInst] = useState(1);
  const [gift, setGift] = useState('');
  const [einvoice, setEinvoice] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const paid = pays.reduce((a, p) => a + p.amount, 0);
  const remain = abs - paid;
  useEffect(() => setAmount(Math.max(0, remain)), [remain]);
  const add = (method: string) => {
    if (amount <= 0) return;
    const a = Math.min(amount, remain);
    if (method === 'points' && customer && a > customer.points) return toast(`Müşteri puanı yetersiz (${tl(customer.points)})`, 'err');
    if (method === 'deposit' && order && a > order.deposit) return toast(`Kapora en fazla ${tl(order.deposit)}`, 'err');
    setPays((p) => [...p, { method, amount: a, installments: method === 'card' ? inst : 1, ref: method === 'giftcard' ? gift.trim().toUpperCase() : undefined }]);
    setGift('');
  };
  const cashGiven = pays.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);
  const finish = async () => {
    setBusy(true);
    try {
      await onDone(pays.map((p) => ({ ...p, amount: p.amount * sign })), einvoice, note);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const methods = refund ? ['cash', 'card', 'transfer', 'giftcard', 'credit'] : ['cash', 'card', 'transfer', 'credit', 'giftcard', 'points', 'deposit'];
  return (
    <Modal title={refund ? 'Müşteriye ödeme' : 'Ödeme'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn ok lg" disabled={remain !== 0 || busy} onClick={finish}>{refund ? 'İadeyi tamamla' : 'Satışı tamamla'}</button></>}>
      <div className="row between" style={{ fontSize: 22, fontWeight: 800 }}><span>{refund ? 'İade tutarı' : 'Tutar'}</span><span>{tl(abs)}</span></div>
      <div className="row between" style={{ fontSize: 18 }}><span>Kalan</span><b className={remain > 0 ? 'danger' : 'ok'}>{tl(remain)}</b></div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '12px 0' }} />
      <div className="grid c2">
        <label className="f"><span>Tutar</span><MoneyInput value={amount} onChange={setAmount} autoFocus onEnter={() => add('cash')} /></label>
        <label className="f"><span>Taksit (kart)</span><select value={inst} onChange={(e) => setInst(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 9, 12].map((n) => <option key={n} value={n}>{n === 1 ? 'Tek çekim' : n + ' taksit'}</option>)}</select></label>
      </div>
      <div className="paybtns" style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {methods.map((m) => {
          const disabled = remain <= 0 || (m === 'credit' && (!customer || (!refund && !customer.credit_limit))) || (m === 'points' && !customer) || (m === 'deposit' && !order);
          return <button key={m} className={'btn ' + (m === 'cash' ? 'ok' : 'secondary')} disabled={disabled} onClick={() => add(m)} title={m === 'credit' && !customer ? 'Müşteri seçilmeli' : ''}>{PAY[m]}</button>;
        })}
      </div>
      <div className="row" style={{ marginTop: 8 }}><input placeholder="Hediye çeki kodu (çekle ödeme için)" value={gift} onChange={(e) => setGift(e.target.value)} /></div>
      {customer && !refund && <div className="small muted" style={{ marginTop: 6 }}>Müşteri puanı: {tl(customer.points)}{customer.credit_limit > 0 && <> · Veresiye limiti: {tl(customer.credit_limit)} (borç {tl(customer.balance)})</>}</div>}
      {pays.length > 0 && (
        <table style={{ marginTop: 10 }}><tbody>
          {pays.map((p, i) => <tr key={i}><td>{PAY[p.method]}{p.installments && p.installments > 1 ? ` (${p.installments} taksit)` : ''}{p.ref ? ` · ${p.ref}` : ''}</td><td className="num">{tl(p.amount)}</td><td className="right"><button className="btn ghost sm" onClick={() => setPays((x) => x.filter((_, j) => j !== i))}>✕</button></td></tr>)}
        </tbody></table>
      )}
      {!refund && cashGiven > 0 && remain < 0 && <div className="alert info" style={{ marginTop: 8 }}>Para üstü: <b>{tl(-remain)}</b></div>}
      {!refund && <QuickCash onPick={(k) => { const change = k - remain; setPays((p) => [...p, { method: 'cash', amount: remain, installments: 1 }]); if (change > 0) toast(`Para üstü: ${tl(change)}`, 'info'); }} remain={remain} />}
      <div className="row" style={{ marginTop: 10 }}>
        {einvoiceAvailable && !refund && <label className="check"><input type="checkbox" checked={einvoice} onChange={(e) => setEinvoice(e.target.checked)} /> e-Fatura / e-Arşiv kes</label>}
      </div>
      <input placeholder="Not (isteğe bağlı)" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 8 }} />
    </Modal>
  );
}

function QuickCash({ remain, onPick }: { remain: number; onPick: (k: number) => void }) {
  const opts = useMemo(() => {
    if (remain <= 0) return [];
    const r = remain / 100;
    const set = new Set<number>();
    for (const b of [50, 100, 200, 500, 1000, 2000, 5000]) if (b >= r) set.add(b);
    set.add(Math.ceil(r / 10) * 10);
    set.add(Math.ceil(r / 50) * 50);
    return [...set].filter((x) => x >= r).sort((a, b) => a - b).slice(0, 5);
  }, [remain]);
  if (!opts.length) return null;
  return <div className="row small" style={{ marginTop: 8 }}><span className="muted">Nakit verilen:</span>{opts.map((o) => <button key={o} className="chip" onClick={() => onPick(o * 100)}>{o.toLocaleString('tr-TR')} ₺</button>)}</div>;
}
