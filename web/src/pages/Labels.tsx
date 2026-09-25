import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Barcode, Spinner } from '../components';
import { useSession } from '../store';
import { tl } from '../util';

/** Raf / kutu etiketi yazdırma: ürün(ler)in tüm varyantları için barkod + fiyat */
export default function Labels() {
  const [sp] = useSearchParams();
  const { session } = useSession();
  const [variants, setVariants] = useState<any[] | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [labels, setLabels] = useState<any[] | null>(null);
  const lab = session?.settings.label ?? { widthMm: 40, heightMm: 30, showPrice: true, showSize: true };
  useEffect(() => {
    const ids = (sp.get('products') ?? '').split(',').filter(Boolean);
    Promise.all(ids.map((id) => api.get<any>(`/products/${id}`))).then((ps: any[]) => {
      const vs = ps.flatMap((p) => p.variants.filter((v: any) => v.active).map((v: any) => ({ ...v, code: p.code, name: p.name, price: v.sale_price ?? p.sale_price, stock: p.stock.filter((s: any) => s.variant_id === v.id).reduce((a: number, s: any) => a + s.qty, 0) })));
      setVariants(vs);
      setQty(Object.fromEntries(vs.map((v: any) => [v.id, Math.max(0, v.stock)])));
    });
  }, [sp]);
  if (!variants) return <Spinner />;
  if (labels) {
    return <div style={{ padding: 4 }}>
      <div className="no-print row" style={{ marginBottom: 10 }}><button className="btn" onClick={() => window.print()}>🖨 Yazdır ({labels.length} etiket)</button><button className="btn secondary" onClick={() => setLabels(null)}>Geri</button><span className="small muted">Yazıcı ayarında kâğıt boyutunu {lab.widthMm}×{lab.heightMm} mm, kenar boşluğunu 0 yapın.</span></div>
      <div className="labels">{labels.map((v, i) => <div key={i} className="label" style={{ width: lab.widthMm + 'mm', height: lab.heightMm + 'mm' }}><div style={{ fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{v.code} {v.name}</div><div>{v.color}{lab.showSize && <> · <b style={{ fontSize: 14 }}>{v.size}</b></>}</div><Barcode value={v.barcode} height={28} />{lab.showPrice && <div className="price">{tl(v.price)}</div>}</div>)}</div>
    </div>;
  }
  return <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
    <h1>Etiket yazdır</h1>
    <p className="muted small">Her varyant için kaç etiket basılacağını girin (varsayılan: stok adedi).</p>
    <div className="row" style={{ marginBottom: 10 }}><button className="btn secondary sm" onClick={() => setQty(Object.fromEntries(variants.map((v) => [v.id, 1])))}>Hepsi 1</button><button className="btn secondary sm" onClick={() => setQty(Object.fromEntries(variants.map((v) => [v.id, Math.max(0, v.stock)])))}>Stok kadar</button><span className="grow" /><button className="btn" onClick={() => setLabels(variants.flatMap((v) => Array(Math.min(200, qty[v.id] ?? 0)).fill(v)))}>Önizle ve yazdır</button></div>
    <div className="card" style={{ padding: 0 }}><table><thead><tr><th>Ürün</th><th>Renk</th><th>No</th><th>Barkod</th><th className="num">Fiyat</th><th className="num">Stok</th><th>Adet</th></tr></thead><tbody>{variants.map((v) => <tr key={v.id}><td>{v.code} {v.name}</td><td>{v.color}</td><td className="bold">{v.size}</td><td className="mono small">{v.barcode}</td><td className="num">{tl(v.price)}</td><td className="num">{v.stock}</td><td><input type="number" min={0} value={qty[v.id] ?? 0} onChange={(e) => setQty({ ...qty, [v.id]: Number(e.target.value) })} style={{ width: 70, minHeight: 30 }} /></td></tr>)}</tbody></table></div>
  </div>;
}
