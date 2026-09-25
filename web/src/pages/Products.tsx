import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Badge, Empty, Modal, MoneyInput, PageHead, Search, Spinner, StoreSelect } from '../components';
import { useLoad, useSession } from '../store';
import { downloadCsv, parseCsv, tl, GENDER } from '../util';

export default function Products() {
  const nav = useNavigate();
  const { can, toast } = useSession();
  const [q, setQ] = useState('');
  const [f, setF] = useState<any>({ active: '1', stock: '', brandId: '', categoryId: '', season: '', gender: '' });
  const [store, setStore] = useState<number | 'all'>('all');
  const [sel, setSel] = useState<number[]>([]);
  const [modal, setModal] = useState<'new' | 'import' | 'price' | null>(null);
  const { data: meta } = useLoad(() => api.get('/catalog/meta'), []);
  const { data, loading, reload } = useLoad(() => api.get('/products', { q, ...f, storeId: store === 'all' ? undefined : store, limit: 1000 }), [q, f, store]);
  const rows: any[] = data ?? [];
  const setFilter = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <div>
      <PageHead title="Ürünler">
        {can('prices.edit') && <button className="btn secondary" disabled={!sel.length} onClick={() => setModal('price')}>💲 Toplu fiyat ({sel.length})</button>}
        <button className="btn secondary" disabled={!sel.length} onClick={() => nav('/yazdir/etiket?products=' + sel.join(','))}>🏷 Etiket</button>
        <button className="btn secondary" onClick={() => downloadCsv('urunler', rows, [{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'brand', label: 'Marka' }, { key: 'category', label: 'Kategori' }, { key: 'gender', label: 'Cinsiyet' }, { key: 'season', label: 'Sezon' }, { key: 'sale_price', label: 'Satış (kuruş)' }, { key: 'cost_price', label: 'Alış (kuruş)' }, { key: 'stock_qty', label: 'Stok' }])}>⬇ Excel</button>
        {can('products.edit') && <><button className="btn secondary" onClick={() => setModal('import')}>⬆ Excel'den aktar</button><button className="btn" onClick={() => setModal('new')}>+ Yeni ürün</button></>}
      </PageHead>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <Search value={q} onChange={setQ} placeholder="Kod, ad veya barkod" autoFocus />
          <StoreSelect value={store} onChange={setStore} all />
          <select value={f.brandId} onChange={(e) => setFilter('brandId', e.target.value)} style={{ width: 'auto' }}><option value="">Marka</option>{meta?.brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select value={f.categoryId} onChange={(e) => setFilter('categoryId', e.target.value)} style={{ width: 'auto' }}><option value="">Kategori</option>{meta?.categories.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select value={f.season} onChange={(e) => setFilter('season', e.target.value)} style={{ width: 'auto' }}><option value="">Sezon</option>{meta?.seasons.map((s: string) => <option key={s}>{s}</option>)}</select>
          <select value={f.gender} onChange={(e) => setFilter('gender', e.target.value)} style={{ width: 'auto' }}><option value="">Cinsiyet</option>{Object.entries(GENDER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.stock} onChange={(e) => setFilter('stock', e.target.value)} style={{ width: 'auto' }}><option value="">Stok: hepsi</option><option value="in">Stokta var</option><option value="out">Stokta yok</option><option value="low">Kritik</option></select>
          <select value={f.active} onChange={(e) => setFilter('active', e.target.value)} style={{ width: 'auto' }}><option value="1">Aktif</option><option value="0">Pasif</option><option value="all">Hepsi</option></select>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th><input type="checkbox" checked={sel.length === rows.length} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /></th><th>Kod</th><th>Ürün</th><th>Marka</th><th>Kategori</th><th>Sezon</th><th>Renkler</th><th className="num">Satış</th>{can('costs.view') && <th className="num">Alış</th>}<th className="num">Stok</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav('/urunler/' + p.id)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} /></td>
                <td className="bold">{p.code}{!p.active && <Badge>pasif</Badge>}</td><td>{p.name} <span className="muted small">{GENDER[p.gender]}</span></td><td>{p.brand}</td><td>{p.category}</td><td>{p.season}</td><td className="small">{p.colors}</td>
                <td className="num bold">{tl(p.sale_price)}</td>{can('costs.view') && <td className="num muted">{tl(p.cost_price)}</td>}
                <td className="num">{p.stock_qty <= 0 ? <Badge kind="danger">{p.stock_qty}</Badge> : p.stock_qty <= p.min_stock * p.variant_count ? <Badge kind="warn">{p.stock_qty}</Badge> : p.stock_qty}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {modal === 'new' && meta && <ProductForm meta={meta} onClose={() => setModal(null)} onSaved={(p) => { setModal(null); nav('/urunler/' + p.id); }} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'price' && <BulkPriceModal ids={sel} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); toast('Fiyatlar güncellendi'); }} />}
    </div>
  );
}

export function ProductForm({ meta, value, onClose, onSaved }: { meta: any; value?: any; onClose: () => void; onSaved: (p: any) => void }) {
  const { toast, can } = useSession();
  const [f, setF] = useState<any>(value ? { ...value } : { vat_rate: 10, min_stock: 1, gender: 'kadin', season: meta.seasons[0] ?? '' });
  const [colors, setColors] = useState('');
  const [series, setSeries] = useState<number>(meta.sizeSeries[0]?.id ?? 0);
  const [sizes, setSizes] = useState<string[]>(meta.sizeSeries[0]?.sizes ?? []);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  useEffect(() => {
    const s = meta.sizeSeries.find((x: any) => x.id === series);
    if (s) setSizes(s.sizes);
  }, [series, meta]);
  const save = async () => {
    setBusy(true);
    try {
      const body: any = { ...f, brand_id: undefined, category_id: undefined };
      delete body.id; delete body.variants; delete body.stores; delete body.stock; delete body.sales30; delete body.lastSale; delete body.supplier; delete body.created_at; delete body.updated_at; delete body.tenant_id;
      body.active = f.active !== 0 && f.active !== false;
      body.marketplace_sync = !!f.marketplace_sync;
      if (!value) {
        body.colors = colors.split(',').map((c) => c.trim()).filter(Boolean);
        body.sizes = sizes;
      }
      const r = value ? await api.put(`/products/${value.id}`, body) : await api.post('/products', body);
      toast('Ürün kaydedildi');
      onSaved(r);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={value ? 'Ürün düzenle' : 'Yeni ürün (model)'} onClose={onClose} wide footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" disabled={busy} onClick={save}>Kaydet</button></>}>
      <div className="form">
        <label className="f"><span>Model kodu *</span><input value={f.code ?? ''} onChange={(e) => set('code', e.target.value)} autoFocus placeholder="Örn. K1001" /></label>
        <label className="f" style={{ gridColumn: 'span 2' }}><span>Ürün adı *</span><input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="f"><span>Marka</span><input list="brands" value={f.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /><datalist id="brands">{meta.brands.map((b: any) => <option key={b.id} value={b.name} />)}</datalist></label>
        <label className="f"><span>Kategori</span><input list="cats" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} /><datalist id="cats">{meta.categories.map((b: any) => <option key={b.id} value={b.name} />)}</datalist></label>
        <label className="f"><span>Cinsiyet</span><select value={f.gender ?? ''} onChange={(e) => set('gender', e.target.value)}>{meta.genders.map((g: any) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label>
        <label className="f"><span>Sezon</span><input list="seasons" value={f.season ?? ''} onChange={(e) => set('season', e.target.value)} placeholder="2026-YAZ" /><datalist id="seasons">{meta.seasons.map((s: string) => <option key={s} value={s} />)}</datalist></label>
        <label className="f"><span>Malzeme</span><input value={f.material ?? ''} onChange={(e) => set('material', e.target.value)} placeholder="Hakiki deri" /></label>
        <label className="f"><span>Tedarikçi</span><select value={f.supplier_id ?? ''} onChange={(e) => set('supplier_id', e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{meta.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="f"><span>Satış fiyatı (KDV dahil) *</span><MoneyInput value={f.sale_price ?? 0} onChange={(k) => set('sale_price', k)} disabled={!!value && !can('prices.edit')} /></label>
        {(can('costs.view') || !value) && <label className="f"><span>Alış fiyatı (KDV hariç)</span><MoneyInput value={f.cost_price ?? 0} onChange={(k) => set('cost_price', k)} /></label>}
        <label className="f"><span>KDV %</span><select value={f.vat_rate ?? 10} onChange={(e) => set('vat_rate', Number(e.target.value))}>{[0, 1, 10, 20].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label className="f"><span>Kritik stok (numara başı)</span><input type="number" min={0} value={f.min_stock ?? 1} onChange={(e) => set('min_stock', Number(e.target.value))} /></label>
        <label className="f full"><span>Görsel adresi (URL)</span><input value={f.image_url ?? ''} onChange={(e) => set('image_url', e.target.value)} /></label>
        <label className="f full"><span>Açıklama</span><textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={!!f.marketplace_sync} onChange={(e) => set('marketplace_sync', e.target.checked)} /> Pazaryerlerine stok gönder</label>
        {value && <label className="check"><input type="checkbox" checked={f.active !== 0 && f.active !== false} onChange={(e) => set('active', e.target.checked)} /> Aktif</label>}
        {!value && <>
          <label className="f full"><span>Renkler (virgülle)</span><input list="colors" value={colors} onChange={(e) => setColors(e.target.value)} placeholder="Siyah, Taba, Bej" /><datalist id="colors">{meta.colors.map((c: string) => <option key={c} value={c} />)}</datalist></label>
          <label className="f"><span>Numara serisi</span><select value={series} onChange={(e) => setSeries(Number(e.target.value))}>{meta.sizeSeries.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.sizes[0]}–{s.sizes[s.sizes.length - 1]})</option>)}</select></label>
          <label className="f" style={{ gridColumn: 'span 2' }}><span>Numaralar</span><input value={sizes.join(' ')} onChange={(e) => setSizes(e.target.value.split(/[\s,]+/).filter(Boolean))} /></label>
          <div className="full small muted">Her renk × numara için otomatik barkod üretilir ({Math.max(1, colors.split(',').filter((c) => c.trim()).length) * sizes.length} varyant). Üretici barkodlarını ürün sayfasından girebilirsiniz.</div>
        </>}
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useSession();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const rows = parseCsv(text);
  const cols = ['code', 'name', 'brand', 'category', 'gender', 'season', 'material', 'color', 'size', 'barcode', 'cost', 'price', 'vat', 'qty', 'store'];
  const mapped = rows.map((r) => {
    const o: any = {};
    const alias: Record<string, string> = { kod: 'code', 'model kodu': 'code', ad: 'name', 'ürün adı': 'name', marka: 'brand', kategori: 'category', cinsiyet: 'gender', sezon: 'season', malzeme: 'material', renk: 'color', numara: 'size', barkod: 'barcode', alış: 'cost', alis: 'cost', satış: 'price', satis: 'price', fiyat: 'price', kdv: 'vat', adet: 'qty', stok: 'qty', mağaza: 'store', magaza: 'store' };
    for (const [k, v] of Object.entries(r)) {
      const key = alias[k] ?? k;
      if (cols.includes(key)) o[key] = ['cost', 'price'].includes(key) ? Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100) : ['qty', 'vat'].includes(key) ? Number(v) : v;
    }
    return o;
  });
  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api.post('/products/import', { rows: mapped, dryRun });
      setPreview(r);
      if (r.applied) { toast(`${r.createdProducts} ürün, ${r.createdVariants} varyant eklendi`); onDone(); }
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Excel'den ürün aktarımı" onClose={onClose} wide footer={<><button className="btn secondary" onClick={onClose}>Kapat</button><button className="btn secondary" disabled={!mapped.length || busy} onClick={() => run(true)}>Kontrol et</button><button className="btn" disabled={!mapped.length || busy || (preview && !preview.ok)} onClick={() => run(false)}>Aktar</button></>}>
      <p className="small muted">Excel'de sütunları hazırlayıp tabloyu kopyalayın ve aşağıya yapıştırın (ilk satır başlık). Sütunlar: <b>kod, ad, marka, kategori, cinsiyet (kadin/erkek/cocuk), sezon, malzeme, renk, numara, barkod, alış, satış, kdv, adet, mağaza</b>. Her satır bir renk+numara. Fiyatlar TL (örn. 1299,90).</p>
      <textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={'kod\tad\tmarka\trenk\tnumara\tsatış\tadet\nK1001\tTopuklu\tDerimod\tSiyah\t37\t1299,90\t2'} style={{ fontFamily: 'monospace' }} />
      <div className="small" style={{ marginTop: 6 }}>{mapped.length} satır okundu.</div>
      {preview && (preview.ok ? <div className="alert info">Sorun yok: {preview.createdProducts} yeni ürün, {preview.createdVariants} yeni varyant, {preview.stockRows} stok satırı. "Aktar" ile uygulayın.</div> : <div className="alert danger"><div>Hatalar (hiçbir şey yazılmadı):<ul style={{ margin: '4px 0 0 16px' }}>{preview.errors.slice(0, 20).map((e: any, i: number) => <li key={i}>Satır {e.row}: {e.message}</li>)}</ul></div></div>)}
    </Modal>
  );
}

function BulkPriceModal({ ids, onClose, onDone }: { ids: number[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useSession();
  const [mode, setMode] = useState<'percent' | 'amount' | 'set'>('percent');
  const [value, setValue] = useState(0);
  const [round, setRound] = useState('90');
  const [preview, setPreview] = useState<any[] | null>(null);
  const body = { productIds: ids, mode, value: mode === 'percent' ? value : value, round };
  return (
    <Modal title={`Toplu fiyat değişikliği (${ids.length} ürün)`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn secondary" onClick={() => api.post('/products/bulk-price', { ...body, dryRun: true }).then(setPreview).catch((e) => toast(e.message, 'err'))}>Önizle</button><button className="btn" disabled={!preview} onClick={() => api.post('/products/bulk-price', body).then(onDone).catch((e) => toast(e.message, 'err'))}>Uygula</button></>}>
      <div className="grid c3">
        <label className="f"><span>İşlem</span><select value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="percent">Yüzde değiştir (zam / indirim)</option><option value="amount">Tutar ekle / çıkar</option><option value="set">Sabit fiyat yap</option></select></label>
        <label className="f"><span>{mode === 'percent' ? 'Yüzde (−20 = %20 indirim)' : 'Tutar'}</span>{mode === 'percent' ? <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /> : <MoneyInput value={value} onChange={setValue} />}</label>
        <label className="f"><span>Yuvarlama</span><select value={round} onChange={(e) => setRound(e.target.value)}><option value="none">Yok</option><option value="tl">Tam TL</option><option value="90">x9,90 (1.299,90)</option><option value="99">x99,90 (1.299,90 → 1.399,90)</option></select></label>
      </div>
      {preview && <table style={{ marginTop: 10 }}><thead><tr><th>Ürün</th><th className="num">Eski</th><th className="num">Yeni</th></tr></thead><tbody>{preview.map((p) => <tr key={p.id}><td>{p.code} {p.name}</td><td className="num muted">{tl(p.old)}</td><td className="num bold">{tl(p.new)}</td></tr>)}</tbody></table>}
    </Modal>
  );
}
