import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Badge, ErrorBox, Modal, MoneyInput, PageHead, Spinner } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, tl, GENDER } from '../util';
import { ProductForm } from './Products';

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, toast } = useSession();
  const { data: p, error, loading, reload } = useLoad(() => api.get(`/products/${id}`), [id]);
  const { data: meta } = useLoad(() => api.get('/catalog/meta'), []);
  const [edit, setEdit] = useState(false);
  const [editVar, setEditVar] = useState<any>(null);
  const [addVar, setAddVar] = useState(false);
  if (loading && !p) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const colors: string[] = [...new Set(p.variants.map((v: any) => v.color))] as string[];
  const sizes: string[] = [...new Set(p.variants.map((v: any) => v.size))].sort((a: any, b: any) => Number(a) - Number(b)) as string[];
  const stockOf = (storeId: number, variantId: number) => p.stock.find((s: any) => s.store_id === storeId && s.variant_id === variantId)?.qty ?? 0;
  const totalOf = (variantId: number) => p.stock.filter((s: any) => s.variant_id === variantId).reduce((a: number, s: any) => a + s.qty, 0);
  const sold30 = (variantId: number) => p.sales30.find((s: any) => s.variant_id === variantId)?.qty ?? 0;
  return (
    <div>
      <PageHead title={<><Link to="/urunler">Ürünler</Link> / {p.code} — {p.name}</>}>
        <button className="btn secondary" onClick={() => nav('/yazdir/etiket?products=' + p.id)}>🏷 Etiket yazdır</button>
        {can('products.edit') && <><button className="btn secondary" onClick={() => setAddVar(true)}>+ Renk / numara ekle</button><button className="btn" onClick={() => setEdit(true)}>✎ Düzenle</button></>}
      </PageHead>
      <div className="grid c3" style={{ marginBottom: 14 }}>
        <div className="card">
          {p.image_url && <img src={p.image_url} alt="" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, marginBottom: 8 }} />}
          <dl className="kv">
            <dt>Marka</dt><dd>{p.brand ?? '—'}</dd><dt>Kategori</dt><dd>{p.category ?? '—'}</dd>
            <dt>Cinsiyet</dt><dd>{GENDER[p.gender] ?? '—'}</dd><dt>Sezon</dt><dd>{p.season ?? '—'}</dd>
            <dt>Malzeme</dt><dd>{p.material ?? '—'}</dd><dt>Tedarikçi</dt><dd>{p.supplier ?? '—'}</dd>
            <dt>Durum</dt><dd>{p.active ? <Badge kind="ok">Aktif</Badge> : <Badge>Pasif</Badge>} {p.marketplace_sync ? <Badge kind="info">Pazaryeri</Badge> : null}</dd>
          </dl>
        </div>
        <div className="stat"><div className="label">Satış fiyatı (KDV %{p.vat_rate} dahil)</div><div className="value">{tl(p.sale_price)}</div>{can('costs.view') && <div className="sub">Alış: {tl(p.cost_price)} · Kâr marjı: %{p.sale_price ? Math.round(((p.sale_price / (1 + p.vat_rate / 100) - p.cost_price) / (p.sale_price / (1 + p.vat_rate / 100))) * 100) : 0}</div>}</div>
        <div className="stat"><div className="label">Toplam stok</div><div className="value">{p.stock.reduce((a: number, s: any) => a + s.qty, 0)} çift</div><div className="sub">Son 30 gün: {p.sales30.reduce((a: number, s: any) => a + s.qty, 0)} çift satıldı · Son satış: {fmtDate(p.lastSale) || '—'}</div></div>
      </div>
      <div className="card">
        <h2>Renk / numara / mağaza stok tablosu</h2>
        <div className="table-wrap">
          {colors.map((color) => (
            <table key={color} style={{ marginBottom: 16 }}>
              <thead><tr><th style={{ width: 160 }}>{color}</th>{sizes.map((s) => <th key={s} className="center">{s}</th>)}<th className="num">Toplam</th></tr></thead>
              <tbody>
                {p.stores.map((st: any) => (
                  <tr key={st.id}>
                    <td className={st.is_warehouse ? 'muted' : ''}>{st.name}</td>
                    {sizes.map((s) => {
                      const v = p.variants.find((x: any) => x.color === color && x.size === s);
                      const q = v ? stockOf(st.id, v.id) : null;
                      return <td key={s} className="center" style={{ background: q === 0 ? '#fde2e2' : q && q > 0 ? '#e6f4f1' : '#f4f4f4' }}>{v ? (q === 0 ? <span className="danger bold">0</span> : q) : '·'}</td>;
                    })}
                    <td className="num bold">{p.variants.filter((v: any) => v.color === color).reduce((a: number, v: any) => a + stockOf(st.id, v.id), 0)}</td>
                  </tr>
                ))}
                <tr style={{ background: '#fafbfd' }}>
                  <td className="bold">Toplam / 30 gün satış</td>
                  {sizes.map((s) => { const v = p.variants.find((x: any) => x.color === color && x.size === s); return <td key={s} className="center small">{v ? <><b>{totalOf(v.id)}</b> <span className="muted">/ {sold30(v.id)}</span></> : '·'}</td>; })}
                  <td className="num bold">{p.variants.filter((v: any) => v.color === color).reduce((a: number, v: any) => a + totalOf(v.id), 0)}</td>
                </tr>
                <tr>
                  <td className="small muted">Barkod</td>
                  {sizes.map((s) => { const v = p.variants.find((x: any) => x.color === color && x.size === s); return <td key={s} className="center small" style={{ cursor: can('products.edit') ? 'pointer' : 'default' }} onClick={() => can('products.edit') && v && setEditVar(v)} title="Düzenle">{v ? <span className="mono" style={{ fontSize: 10 }}>{v.barcode}{!v.active && ' ✕'}{v.sale_price != null && <><br /><b>{tl(v.sale_price)}</b></>}</span> : ''}</td>; })}
                  <td />
                </tr>
              </tbody>
            </table>
          ))}
        </div>
        <div className="small muted">Kırmızı hücre: o mağazada tükenmiş numara. Barkod hücresine tıklayarak üretici barkodu girebilir, numaraya özel fiyat verebilirsiniz.</div>
      </div>
      {edit && meta && <ProductForm meta={meta} value={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {editVar && <VariantModal v={editVar} onClose={() => setEditVar(null)} onDone={() => { setEditVar(null); reload(); }} />}
      {addVar && <AddVariantModal product={p} colors={colors} sizes={sizes} onClose={() => setAddVar(false)} onDone={() => { setAddVar(false); reload(); }} />}
    </div>
  );
}

function VariantModal({ v, onClose, onDone }: { v: any; onClose: () => void; onDone: () => void }) {
  const { toast, can } = useSession();
  const [barcode, setBarcode] = useState(v.barcode);
  const [price, setPrice] = useState<number | null>(v.sale_price);
  const [active, setActive] = useState(!!v.active);
  const save = async () => {
    try {
      await api.put(`/variants/${v.id}`, { barcode, sale_price: can('prices.edit') ? price : undefined, active });
      toast('Kaydedildi');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const del = async () => {
    try {
      const r = await api.del(`/variants/${v.id}`);
      toast(r.deleted ? 'Varyant silindi' : 'Hareketi olduğu için pasife alındı');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Modal title={`${v.color} · ${v.size} numara`} onClose={onClose} narrow footer={<><button className="btn danger" onClick={del}>Sil</button><span className="grow" /><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
      <div className="col">
        <label className="f"><span>Barkod (üretici barkodunu okutabilirsiniz)</span><input value={barcode} onChange={(e) => setBarcode(e.target.value)} autoFocus /></label>
        {can('prices.edit') && <label className="f"><span>Numaraya özel fiyat (boş = ürün fiyatı)</span><div className="row"><MoneyInput value={price ?? 0} onChange={(k) => setPrice(k)} />{price != null && <button className="btn secondary sm" onClick={() => setPrice(null)}>Temizle</button>}</div></label>}
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif (satılabilir)</label>
      </div>
    </Modal>
  );
}

function AddVariantModal({ product, colors, sizes, onClose, onDone }: { product: any; colors: string[]; sizes: string[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useSession();
  const [newColors, setNewColors] = useState('');
  const [newSizes, setNewSizes] = useState('');
  const save = async () => {
    const c = newColors.split(',').map((s) => s.trim()).filter(Boolean);
    const s = newSizes.split(/[\s,]+/).filter(Boolean);
    const allColors = c.length ? [...colors, ...c] : colors;
    const allSizes = s.length ? [...sizes, ...s] : sizes;
    try {
      const body = { code: product.code, name: product.name, brand: product.brand, category: product.category, supplier_id: product.supplier_id, gender: product.gender, season: product.season, material: product.material, sale_price: product.sale_price, cost_price: product.cost_price, vat_rate: product.vat_rate, min_stock: product.min_stock, description: product.description, image_url: product.image_url, marketplace_sync: !!product.marketplace_sync, active: !!product.active, colors: allColors, sizes: allSizes };
      await api.put(`/products/${product.id}`, body);
      toast('Varyantlar eklendi');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Modal title="Renk / numara ekle" onClose={onClose} narrow footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={save}>Ekle</button></>}>
      <div className="col">
        <label className="f"><span>Yeni renkler (virgülle) — mevcut tüm numaralarda açılır</span><input value={newColors} onChange={(e) => setNewColors(e.target.value)} placeholder="Bordo, Lacivert" /></label>
        <label className="f"><span>Yeni numaralar — mevcut tüm renklerde açılır</span><input value={newSizes} onChange={(e) => setNewSizes(e.target.value)} placeholder="35 42" /></label>
        <div className="small muted">Mevcut: {colors.join(', ')} · {sizes.join(' ')}</div>
      </div>
    </Modal>
  );
}
