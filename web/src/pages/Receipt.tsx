import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Spinner } from '../components';
import { useLoad } from '../store';
import { fmtDateTime, tl, PAY, SALE_TYPE } from '../util';

/** 80mm termal yazıcı için fiş görünümü */
export default function Receipt() {
  const { id } = useParams();
  const { data, loading } = useLoad(() => api.get(`/receipts/${id}/print`), [id]);
  useEffect(() => { if (data) setTimeout(() => window.print(), 300); }, [data]);
  if (loading || !data) return <Spinner />;
  const { sale: s, tenant, receipt, payLabels } = data;
  const header = receipt.header || `${tenant.name}\n${s.store_address ?? ''}\n${s.store_phone ?? ''}`;
  return (
    <div style={{ padding: 10 }}>
      <div className="receipt">
        <div className="c bold" style={{ whiteSpace: 'pre-line' }}>{header}</div>
        {tenant.tax_no && <div className="c">VD: {tenant.tax_office} · VKN: {tenant.tax_no}</div>}
        <hr />
        <div>{s.store_name} · {SALE_TYPE[s.type]?.toUpperCase()} FİŞİ</div>
        <div>Fiş: <b>{s.receipt_no}</b> · {fmtDateTime(s.created_at)}</div>
        {s.original_receipt_no && <div>İlgili fiş: {s.original_receipt_no}</div>}
        {s.customer_name && <div>Müşteri: {s.customer_name}</div>}
        {receipt.showSalesperson && s.salesperson_name && <div>Danışman: {s.salesperson_name}</div>}
        <hr />
        <table>
          <tbody>{s.items.map((i: any) => <tr key={i.id}><td colSpan={3}>{i.code} {i.name}<br />{i.color} · {i.size} no · {i.qty} x {tl(i.unit_price)}{i.discount ? ` · ind. ${tl(Math.abs(i.discount))}` : ''}</td><td className="right" style={{ verticalAlign: 'bottom' }}>{tl(i.line_total)}</td></tr>)}</tbody>
        </table>
        <hr />
        <table><tbody>
          {s.discount_total !== 0 && <tr><td>Ara toplam</td><td className="right">{tl(s.subtotal)}</td></tr>}
          {s.discount_total !== 0 && <tr><td>İndirim</td><td className="right">−{tl(s.discount_total)}</td></tr>}
          <tr><td className="bold" style={{ fontSize: 14 }}>TOPLAM</td><td className="right bold" style={{ fontSize: 14 }}>{tl(s.total)}</td></tr>
          <tr><td>KDV (dahil)</td><td className="right">{tl(s.vat_total)}</td></tr>
          {s.payments.map((p: any) => <tr key={p.id}><td>{payLabels?.[p.method] ?? PAY[p.method]}{p.installments > 1 ? ` (${p.installments} taksit)` : ''}</td><td className="right">{tl(p.amount)}</td></tr>)}
          {s.points_earned > 0 && <tr><td>Kazanılan puan</td><td className="right">{tl(s.points_earned)}</td></tr>}
        </tbody></table>
        <hr />
        {s.einvoice_no && <div className="c">e-Arşiv: {s.einvoice_no}</div>}
        <div className="c" style={{ whiteSpace: 'pre-line' }}>{receipt.footer}</div>
        <div className="c" style={{ marginTop: 6 }}>{s.item_count} çift · Bu belge mali değer taşımaz</div>
        <div className="c" style={{ marginTop: 6, fontSize: 10 }}>{s.receipt_no}</div>
      </div>
      <div className="no-print c" style={{ marginTop: 16 }}><button className="btn" onClick={() => window.print()}>🖨 Yazdır</button> <button className="btn secondary" onClick={() => window.close()}>Kapat</button></div>
    </div>
  );
}
