import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, Confirm, DateRange, Empty, Modal, PageHead, Search, Spinner, StoreSelect, type Range } from '../components';
import { useLoad, useSession } from '../store';
import { downloadCsv, fmtDateTime, tl, today, PAY, SALE_TYPE } from '../util';
import { PaymentModal } from './Pos';

export default function Sales() {
  const [sp] = useSearchParams();
  const [range, setRange] = useState<Range>({ from: today(), to: today() });
  const [store, setStore] = useState<number | 'all'>('all');
  const [q, setQ] = useState(sp.get('fis') ?? '');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const params = q ? { q, from: '2000-01-01', to: '2100-01-01' } : { from: range.from, to: range.to };
  const { data, loading, reload } = useLoad(() => api.get('/sales', { ...params, storeId: store === 'all' ? undefined : store, type: type || undefined, limit: 500 }), [range, store, q, type]);
  useEffect(() => {
    const fis = sp.get('fis');
    if (fis) api.get(`/sales/receipt/${fis}`).then((s) => setOpen(s.id)).catch(() => {});
  }, [sp]);
  const rows: any[] = data?.rows ?? [];
  return (
    <div>
      <PageHead title="Satışlar & İade">
        <button className="btn secondary" onClick={() => downloadCsv('satislar', rows, [{ key: 'receipt_no', label: 'Fiş' }, { key: 'created_at', label: 'Tarih' }, { key: 'store_name', label: 'Mağaza' }, { key: 'type', label: 'Tür' }, { key: 'customer_name', label: 'Müşteri' }, { key: 'salesperson_name', label: 'Danışman' }, { key: 'item_count', label: 'Çift' }, { key: 'total', label: 'Tutar (kuruş)' }, { key: 'methods', label: 'Ödeme' }])}>⬇ Excel</button>
      </PageHead>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <Search value={q} onChange={setQ} placeholder="Fiş no, müşteri veya barkod" />
          <StoreSelect value={store} onChange={setStore} all />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }}><option value="">Tüm türler</option><option value="sale">Satış</option><option value="return">İade</option><option value="exchange">Değişim</option></select>
        </div>
        {!q && <div style={{ marginTop: 8 }}><DateRange value={range} onChange={setRange} /></div>}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Tarih</th><th>Fiş</th><th>Mağaza</th><th>Tür</th><th>Müşteri</th><th>Danışman</th><th>Ödeme</th><th className="num">Çift</th><th className="num">Tutar</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className="click" onClick={() => setOpen(s.id)} style={s.status === 'cancelled' ? { opacity: 0.5, textDecoration: 'line-through' } : {}}>
                <td className="nowrap">{fmtDateTime(s.created_at)}</td><td className="bold">{s.receipt_no}</td><td>{s.store_name}</td>
                <td>{s.type === 'sale' ? SALE_TYPE.sale : <Badge kind="warn">{SALE_TYPE[s.type]}</Badge>}{s.einvoice_status && <Badge kind={s.einvoice_status === 'error' ? 'danger' : 'info'}>e-F</Badge>}</td>
                <td>{s.customer_name}</td><td>{s.salesperson_name}</td><td className="small">{(s.methods ?? '').split(',').map((m: string) => PAY[m]).join(', ')}</td>
                <td className="num">{s.item_count}</td><td className="num bold">{tl(s.total)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={7}>{data.totals.n} fiş</td><td /><td className="num">{tl(data.totals.total)}</td></tr></tfoot>
          </table></div>
        )}
      </div>
      {open && <SaleDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

export function SaleDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged?: () => void }) {
  const { can, toast, storeId } = useSession();
  const { data: s, loading, reload } = useLoad(() => api.get(`/sales/${id}`), [id]);
  const [ret, setRet] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (loading && !s) return <Modal title="Satış" onClose={onClose}><Spinner /></Modal>;
  if (!s) return null;
  const returnable = s.status === 'completed' && s.type !== 'return' && s.items.some((i: any) => i.qty > 0 && i.returned_qty < i.qty);
  return (
    <Modal title={<>Fiş {s.receipt_no} {s.status === 'cancelled' && <Badge kind="danger">İPTAL</Badge>} {s.type !== 'sale' && <Badge kind="warn">{SALE_TYPE[s.type]}{s.original_receipt_no && ` · ${s.original_receipt_no}`}</Badge>}</>} onClose={onClose} wide
      footer={<>
        <button className="btn secondary" onClick={() => window.open(`/yazdir/fis/${s.id}`, '_blank', 'width=400,height=700')}>🖨 Fiş yazdır</button>
        {can('sales.cancel') && s.status === 'completed' && <button className="btn danger" onClick={() => setCancel(true)}>Satışı iptal et</button>}
        {can('sales.return') && returnable && <button className="btn warn" onClick={() => setRet(true)}>↩ İade / Değişim</button>}
        <button className="btn" onClick={onClose}>Kapat</button>
      </>}>
      <div className="grid c3 small" style={{ marginBottom: 12 }}>
        <div><span className="muted">Tarih:</span> {fmtDateTime(s.created_at)}<br /><span className="muted">Mağaza:</span> {s.store_name}</div>
        <div><span className="muted">Kasiyer:</span> {s.user_name}<br /><span className="muted">Danışman:</span> {s.salesperson_name}</div>
        <div><span className="muted">Müşteri:</span> {s.customer_name ? <Link to={`/musteriler/${s.customer_id}`}>{s.customer_name}</Link> : '—'}<br />{s.note && <><span className="muted">Not:</span> {s.note}</>}</div>
      </div>
      <table>
        <thead><tr><th>Ürün</th><th className="num">Adet</th><th className="num">Fiyat</th><th className="num">İndirim</th><th className="num">Tutar</th><th className="num">İade</th></tr></thead>
        <tbody>{s.items.map((i: any) => <tr key={i.id}><td><b>{i.code}</b> {i.name}<br /><span className="small muted">{i.color} · {i.size} · {i.barcode}{i.campaign_name && ` · ${i.campaign_name}`}</span></td><td className="num">{i.qty}</td><td className="num">{tl(i.unit_price)}</td><td className="num">{i.discount ? tl(i.discount) : ''}</td><td className="num bold">{tl(i.line_total)}</td><td className="num">{i.returned_qty || ''}</td></tr>)}</tbody>
        <tfoot>
          <tr><td colSpan={4}>Ara toplam</td><td className="num">{tl(s.subtotal)}</td><td /></tr>
          {s.discount_total !== 0 && <tr><td colSpan={4}>İndirim</td><td className="num">−{tl(s.discount_total)}</td><td /></tr>}
          <tr><td colSpan={4}>TOPLAM (KDV {tl(s.vat_total)} dahil)</td><td className="num" style={{ fontSize: 17 }}>{tl(s.total)}</td><td /></tr>
        </tfoot>
      </table>
      <div className="row" style={{ marginTop: 10 }}>{s.payments.map((p: any) => <Badge key={p.id} kind="info">{PAY[p.method]}{p.installments > 1 ? ` ${p.installments} taksit` : ''}{p.ref ? ` ${p.ref}` : ''}: {tl(p.amount)}</Badge>)}{s.points_earned > 0 && <Badge kind="ok">+{tl(s.points_earned)} puan</Badge>}{s.einvoice_no && <Badge>e-Fatura {s.einvoice_no}</Badge>}</div>
      {s.returns.length > 0 && <div className="small" style={{ marginTop: 8 }}>Bağlı işlemler: {s.returns.map((r: any) => <span key={r.id}>{r.receipt_no} ({SALE_TYPE[r.type]} {tl(r.total)}) </span>)}</div>}
      {s.cancel_reason && <div className="alert danger" style={{ marginTop: 8 }}>İptal nedeni: {s.cancel_reason}</div>}
      {ret && <ReturnModal sale={s} onClose={() => setRet(false)} onDone={() => { setRet(false); reload(); onChanged?.(); }} />}
      {cancel && <Confirm title="Satışı iptal et" danger onClose={() => setCancel(false)} text={<div className="col"><p>Bu satış tamamen geri alınır: ürünler stoğa döner, ödemeler/puanlar iptal olur. Kasa kapandıysa iptal yerine iade yapın.</p><input placeholder="İptal nedeni *" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>} onOk={async () => { try { await api.post(`/sales/${s.id}/cancel`, { reason }); toast('Satış iptal edildi'); setCancel(false); reload(); onChanged?.(); } catch (e) { toast((e as Error).message, 'err'); } }} />}
    </Modal>
  );
}

/** İade / değişim: satırlardan adet seç, istenirse yeni ürün ekle, farkı öde/iade et */
function ReturnModal({ sale, onClose, onDone }: { sale: any; onClose: () => void; onDone: () => void }) {
  const { toast, storeId } = useSession();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [newItems, setNewItems] = useState<any[]>([]);
  const [scan, setScan] = useState('');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [pay, setPay] = useState(false);
  const retLines = sale.items.filter((i: any) => i.qty > 0 && (qty[i.id] ?? 0) > 0);
  const refund = retLines.reduce((a: number, i: any) => a + Math.round((i.line_total * qty[i.id]) / i.qty), 0);
  useEffect(() => {
    if (!newItems.length) return setQuote(null);
    api.post('/pos/quote', { storeId, items: newItems.map((n) => ({ variantId: n.id, qty: n.qty })) }).then(setQuote).catch((e) => toast(e.message, 'err'));
  }, [newItems, storeId]); // eslint-disable-line
  const total = (quote?.total ?? 0) - refund;
  const addScan = async () => {
    try {
      const v = await api.get(`/pos/barcode/${scan.trim()}`);
      setNewItems((n) => [...n, { ...v, qty: 1 }]);
      setScan('');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const submit = async (payments: any[]) => {
    await api.post('/pos/return', {
      storeId, originalSaleId: sale.id, returnItems: retLines.map((i: any) => ({ saleItemId: i.id, qty: qty[i.id] })),
      newItems: newItems.map((n) => ({ variantId: n.id, qty: n.qty })), payments, reason,
    });
    toast('İade / değişim tamamlandı');
    setPay(false);
    onDone();
  };
  return (
    <Modal title={`İade / Değişim — ${sale.receipt_no}`} onClose={onClose} wide footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn warn" disabled={!retLines.length} onClick={() => { if (total === 0) submit([]).catch((e: Error) => toast(e.message, 'err')); else setPay(true); }}>{total === 0 ? 'Tamamla (fark yok)' : total > 0 ? `Fark tahsil et ${tl(total)}` : `Müşteriye öde ${tl(-total)}`}</button></>}>
      <h3>İade edilecek ürünler</h3>
      <table><tbody>{sale.items.filter((i: any) => i.qty > 0).map((i: any) => {
        const max = i.qty - i.returned_qty;
        return <tr key={i.id}><td><b>{i.code}</b> {i.name} <span className="muted small">{i.color} · {i.size}</span></td><td className="num">{tl(i.line_total)} / {i.qty}</td><td style={{ width: 160 }}>{max > 0 ? <span className="qty" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><button className="btn secondary sm" onClick={() => setQty((q) => ({ ...q, [i.id]: Math.max(0, (q[i.id] ?? 0) - 1) }))}>−</button><b>{qty[i.id] ?? 0}</b><button className="btn secondary sm" onClick={() => setQty((q) => ({ ...q, [i.id]: Math.min(max, (q[i.id] ?? 0) + 1) }))}>+</button><span className="small muted">/ {max}</span></span> : <span className="muted small">tamamı iade edildi</span>}</td></tr>;
      })}</tbody></table>
      <h3 style={{ marginTop: 14 }}>Değişim: verilecek yeni ürün (isteğe bağlı)</h3>
      <div className="row"><input placeholder="Yeni ürünün barkodunu okutun" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addScan()} /><button className="btn secondary" onClick={addScan}>Ekle</button></div>
      {newItems.length > 0 && <table style={{ marginTop: 6 }}><tbody>{newItems.map((n, i) => <tr key={i}><td><b>{n.code}</b> {n.name} <span className="muted small">{n.color} · {n.size}</span></td><td className="num">{tl(quote?.lines?.[i]?.lineTotal ?? n.price)}</td><td className="right"><button className="btn ghost sm" onClick={() => setNewItems((x) => x.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table>}
      <div className="row" style={{ marginTop: 12 }}><input placeholder="İade nedeni (numara olmadı, defolu, beğenmedi...)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="row between" style={{ marginTop: 12, fontSize: 18 }}><span>İade tutarı: <b>{tl(refund)}</b>{quote && <> · Yeni ürün: <b>{tl(quote.total)}</b></>}</span><b className={total < 0 ? 'danger' : 'ok'}>Fark: {tl(total)}</b></div>
      {pay && <PaymentModal total={total} customer={sale.customer_id ? { id: sale.customer_id, name: sale.customer_name, points: 0, credit_limit: 1, balance: 0 } : null} onClose={() => setPay(false)} onDone={(p) => submit(p)} refund={total < 0} />}
    </Modal>
  );
}
