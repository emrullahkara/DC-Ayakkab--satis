import { useState } from 'react';
import { api } from '../api';
import { Badge, DateRange, Empty, Modal, MoneyInput, PageHead, Spinner, StoreSelect, Tabs, type Range } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDateTime, tl, today, PAY, addDays } from '../util';

const CASH: Record<string, string> = { expense: 'Gider', income: 'Gelir', deposit: 'Bankaya yatırılan', withdraw: 'Kasadan alınan', collection: 'Tahsilat', supplier_payment: 'Tedarikçi ödemesi' };

export default function Register() {
  const { storeId, store, toast, can } = useSession();
  const [tab, setTab] = useState('now');
  const { data, loading, reload } = useLoad(() => (storeId ? api.get(`/register/${storeId}`) : Promise.resolve(null)), [storeId]);
  const { data: meta } = useLoad(() => api.get('/register/meta'), []);
  const [openM, setOpenM] = useState(false);
  const [closeM, setCloseM] = useState(false);
  const [cashM, setCashM] = useState<string | null>(null);
  if (!storeId) return <div className="alert warn">Üst çubuktan mağaza seçin.</div>;
  if (loading && !data) return <Spinner />;
  const r = data;
  return (
    <div>
      <PageHead title={`Kasa — ${store?.name}`}>
        {r?.open && can('cash.movements') && <><button className="btn secondary" onClick={() => setCashM('expense')}>− Gider</button><button className="btn secondary" onClick={() => setCashM('income')}>+ Gelir</button><button className="btn secondary" onClick={() => setCashM('deposit')}>🏦 Bankaya yatır</button><button className="btn secondary" onClick={() => setCashM('withdraw')}>Kasadan al</button></>}
        {can('register') && (r?.open ? <button className="btn danger" onClick={() => setCloseM(true)}>Gün sonu / Kasayı kapat</button> : <button className="btn ok lg" onClick={() => setOpenM(true)}>Kasayı aç</button>)}
      </PageHead>
      <Tabs tabs={[{ key: 'now', label: 'Açık kasa' }, { key: 'history', label: 'Geçmiş gün sonları' }, { key: 'cash', label: 'Kasa hareketleri' }]} value={tab} onChange={setTab} />
      {tab === 'now' && (!r?.open ? <div className="card"><Empty text="Kasa kapalı. Satış yapabilmek için kasayı açın." /></div> : (
        <div className="grid c2">
          <div className="card">
            <h2>Gün özeti <Badge kind="ok">Açık · {fmtDateTime(r.session.opened_at)} · {r.session.opened_by_name}</Badge></h2>
            <dl className="kv">
              <dt>Açılış nakit</dt><dd>{tl(r.summary.openingCash)}</dd>
              <dt>Satış fişi</dt><dd>{r.summary.salesCount} {r.summary.returnsCount > 0 && <span className="muted">· {r.summary.returnsCount} iade/değişim</span>} {r.summary.cancelledCount > 0 && <span className="danger">· {r.summary.cancelledCount} iptal</span>}</dd>
              <dt>Satılan çift</dt><dd>{r.summary.items}</dd>
              <dt>Net ciro</dt><dd style={{ fontSize: 18 }}>{tl(r.summary.netTotal)}</dd>
              <dt>İndirim</dt><dd>{tl(r.summary.discount)}</dd>
            </dl>
            <h3 style={{ marginTop: 14 }}>Ödeme türleri</h3>
            <table><tbody>{r.summary.byMethod.map((m: any) => <tr key={m.method}><td>{PAY[m.method]}</td><td className="num">{m.n} işlem</td><td className="num bold">{tl(m.amount)}</td></tr>)}</tbody></table>
            <div className="alert info" style={{ marginTop: 12, fontSize: 16 }}>Kasada olması gereken nakit: <b style={{ marginLeft: 'auto' }}>{tl(r.summary.expectedCash)}</b></div>
          </div>
          <div className="card">
            <h2>Kasa hareketleri (bu oturum)</h2>
            {r.movements.length === 0 ? <Empty text="Hareket yok" /> : <table><tbody>{r.movements.map((m: any) => <tr key={m.id}><td>{fmtDateTime(m.created_at).slice(11)}</td><td>{CASH[m.type]}{m.category && <span className="muted"> · {m.category}</span>}<br /><span className="small muted">{m.note} · {m.user_name} · {PAY[m.method]}</span></td><td className={'num bold ' + (['income', 'collection'].includes(m.type) ? 'ok' : 'danger')}>{['income', 'collection'].includes(m.type) ? '+' : '−'}{tl(m.amount)}</td></tr>)}</tbody></table>}
          </div>
        </div>
      ))}
      {tab === 'history' && <History />}
      {tab === 'cash' && <CashList />}
      {openM && <OpenModal onClose={() => setOpenM(false)} onOk={async (cash, note) => { await api.post(`/register/${storeId}/open`, { openingCash: cash, note }); toast('Kasa açıldı'); setOpenM(false); reload(); }} />}
      {closeM && r?.open && <CloseModal expected={r.summary.expectedCash} onClose={() => setCloseM(false)} onOk={async (cash, note) => { const rep = await api.post(`/register/${storeId}/close`, { countedCash: cash, note }); toast(`Kasa kapatıldı. Fark: ${tl(rep.difference)}`, rep.difference ? 'info' : 'ok'); setCloseM(false); reload(); window.open(`/kasa-islemleri?rapor=${rep.id}`, '_self'); }} />}
      {cashM && meta && <CashModal type={cashM} categories={meta.expenseCategories} onClose={() => setCashM(null)} onOk={async (b) => { await api.post('/cash', { storeId, type: cashM, ...b }); toast('Kaydedildi'); setCashM(null); reload(); }} />}
    </div>
  );
}

function OpenModal({ onClose, onOk }: { onClose: () => void; onOk: (cash: number, note: string) => Promise<void> }) {
  const { toast } = useSession();
  const [cash, setCash] = useState(0);
  const [note, setNote] = useState('');
  const go = () => onOk(cash, note).catch((e) => toast(e.message, 'err'));
  return <Modal title="Kasa açılışı" onClose={onClose} narrow footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn ok" onClick={go}>Kasayı aç</button></>}>
    <label className="f"><span>Kasadaki açılış nakiti (bozuk para dahil)</span><MoneyInput value={cash} onChange={setCash} autoFocus onEnter={go} /></label>
    <input placeholder="Not" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 10 }} />
  </Modal>;
}

function CloseModal({ expected, onClose, onOk }: { expected: number; onClose: () => void; onOk: (cash: number, note: string) => Promise<void> }) {
  const { toast } = useSession();
  const [cash, setCash] = useState(0);
  const [note, setNote] = useState('');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const notes = [200, 100, 50, 20, 10, 5, 1];
  const fromNotes = notes.reduce((a, n) => a + (counts[n] ?? 0) * n * 100, 0);
  const diff = cash - expected;
  return <Modal title="Gün sonu — kasa sayımı" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn danger" onClick={() => onOk(cash, note).catch((e) => toast(e.message, 'err'))}>Kasayı kapat</button></>}>
    <div className="grid c2">
      <div>
        <h3>Kupür sayımı (isteğe bağlı)</h3>
        <table><tbody>{notes.map((n) => <tr key={n}><td>{n} ₺</td><td><input type="number" min={0} value={counts[n] ?? ''} onChange={(e) => { const c = { ...counts, [n]: Number(e.target.value) }; setCounts(c); setCash(notes.reduce((a, x) => a + (c[x] ?? 0) * x * 100, 0)); }} style={{ width: 90, minHeight: 32 }} /></td><td className="num">{tl((counts[n] ?? 0) * n * 100)}</td></tr>)}</tbody></table>
        <div className="small muted">Kupür toplamı: {tl(fromNotes)}</div>
      </div>
      <div className="col">
        <label className="f"><span>Sayılan toplam nakit</span><MoneyInput value={cash} onChange={setCash} autoFocus className="lg" /></label>
        <div className="row between"><span>Olması gereken</span><b>{tl(expected)}</b></div>
        <div className={'alert ' + (diff === 0 ? 'info' : diff > 0 ? 'warn' : 'danger')}>{diff === 0 ? 'Kasa tam tutuyor ✔' : diff > 0 ? `Kasa fazlası: ${tl(diff)}` : `Kasa açığı: ${tl(-diff)}`}</div>
        <textarea placeholder="Açıklama (fark varsa nedeni)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </div>
  </Modal>;
}

function CashModal({ type, categories, onClose, onOk }: { type: string; categories: string[]; onClose: () => void; onOk: (b: any) => Promise<void> }) {
  const { toast } = useSession();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('cash');
  const [category, setCategory] = useState(type === 'expense' ? categories[0] : '');
  const [note, setNote] = useState('');
  return <Modal title={CASH[type]} onClose={onClose} narrow footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn" onClick={() => onOk({ amount, method, category: category || null, note }).catch((e) => toast(e.message, 'err'))}>Kaydet</button></>}>
    <div className="col">
      <label className="f"><span>Tutar</span><MoneyInput value={amount} onChange={setAmount} autoFocus /></label>
      {(type === 'expense' || type === 'income') && <label className="f"><span>Ödeme şekli</span><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Nakit (kasadan)</option><option value="card">Kart</option><option value="transfer">Havale</option></select></label>}
      {type === 'expense' && <label className="f"><span>Gider türü</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>}
      <label className="f"><span>Açıklama</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'withdraw' ? 'Kim aldı, ne için' : ''} /></label>
    </div>
  </Modal>;
}

function History() {
  const [range, setRange] = useState<Range>({ from: addDays(today(), -29), to: today() });
  const [store, setStore] = useState<number | 'all'>('all');
  const [open, setOpen] = useState<number | null>(new URLSearchParams(location.search).get('rapor') ? Number(new URLSearchParams(location.search).get('rapor')) : null);
  const { data, loading } = useLoad(() => api.get('/register-sessions', { from: range.from, to: range.to, storeId: store === 'all' ? undefined : store }), [range, store]);
  return <div>
    <div className="card" style={{ marginBottom: 12 }}><div className="row"><StoreSelect value={store} onChange={setStore} all /><DateRange value={range} onChange={setRange} /></div></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : !data?.length ? <Empty /> : <div className="table-wrap"><table>
      <thead><tr><th>Açılış</th><th>Kapanış</th><th>Mağaza</th><th>Açan / Kapatan</th><th className="num">Net ciro</th><th className="num">Beklenen nakit</th><th className="num">Sayılan</th><th className="num">Fark</th></tr></thead>
      <tbody>{data.map((s: any) => <tr key={s.id} className="click" onClick={() => setOpen(s.id)}><td>{fmtDateTime(s.opened_at)}</td><td>{s.closed_at ? fmtDateTime(s.closed_at) : <Badge kind="ok">Açık</Badge>}</td><td>{s.store_name}</td><td>{s.opened_by_name}{s.closed_by_name ? ' / ' + s.closed_by_name : ''}</td><td className="num bold">{tl(s.net_total)}</td><td className="num">{s.expected_cash != null ? tl(s.expected_cash) : ''}</td><td className="num">{s.counted_cash != null ? tl(s.counted_cash) : ''}</td><td className={'num bold ' + (s.difference ? (s.difference < 0 ? 'danger' : 'warn') : 'ok')}>{s.difference != null ? tl(s.difference) : ''}</td></tr>)}</tbody>
    </table></div>}</div>
    {open && <SessionReport id={open} onClose={() => setOpen(null)} />}
  </div>;
}

function SessionReport({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: r } = useLoad(() => api.get(`/register-sessions/${id}`), [id]);
  if (!r) return null;
  const s = r.summary;
  return <Modal title={`Gün sonu raporu — ${r.store_name} · ${fmtDateTime(r.opened_at)}`} onClose={onClose} footer={<><button className="btn secondary" onClick={() => window.print()}>🖨 Yazdır</button><button className="btn" onClick={onClose}>Kapat</button></>}>
    <div className="grid c2">
      <dl className="kv">
        <dt>Açan</dt><dd>{r.opened_by_name}</dd><dt>Kapatan</dt><dd>{r.closed_by_name ?? '—'}</dd>
        <dt>Fiş</dt><dd>{s.salesCount} satış, {s.returnsCount} iade, {s.cancelledCount} iptal</dd>
        <dt>Çift</dt><dd>{s.items}</dd><dt>Net ciro</dt><dd>{tl(s.netTotal)}</dd><dt>İndirim</dt><dd>{tl(s.discount)}</dd>
      </dl>
      <dl className="kv">
        <dt>Açılış nakit</dt><dd>{tl(s.openingCash)}</dd>
        {s.byMethod.map((m: any) => <><dt key={m.method}>{PAY[m.method]}</dt><dd key={m.method + 'v'}>{tl(m.amount)}</dd></>)}
        <dt>Beklenen nakit</dt><dd>{tl(s.expectedCash)}</dd>
        <dt>Sayılan</dt><dd>{r.counted_cash != null ? tl(r.counted_cash) : '—'}</dd>
        <dt>Fark</dt><dd className={r.difference ? 'danger' : 'ok'}>{r.difference != null ? tl(r.difference) : '—'}</dd>
      </dl>
    </div>
    {r.movements.length > 0 && <table style={{ marginTop: 10 }}><tbody>{r.movements.map((m: any) => <tr key={m.id}><td>{CASH[m.type]} {m.category && `· ${m.category}`}<br /><span className="small muted">{m.note}</span></td><td>{PAY[m.method]}</td><td className="num">{tl(m.amount)}</td></tr>)}</tbody></table>}
    {r.note && <div className="alert info" style={{ marginTop: 8 }}>{r.note}</div>}
  </Modal>;
}

function CashList() {
  const [range, setRange] = useState<Range>({ from: addDays(today(), -29), to: today() });
  const [store, setStore] = useState<number | 'all'>('all');
  const [type, setType] = useState('');
  const { data, loading } = useLoad(() => api.get('/cash', { from: range.from, to: range.to, storeId: store === 'all' ? undefined : store, type: type || undefined }), [range, store, type]);
  const rows: any[] = data ?? [];
  const sum = (t: string[]) => rows.filter((r) => t.includes(r.type)).reduce((a, r) => a + r.amount, 0);
  return <div>
    <div className="card" style={{ marginBottom: 12 }}><div className="row"><StoreSelect value={store} onChange={setStore} all /><select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }}><option value="">Tüm hareketler</option>{Object.entries(CASH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><DateRange value={range} onChange={setRange} /></div></div>
    <div className="grid c3" style={{ marginBottom: 12 }}><div className="stat"><div className="label">Giderler</div><div className="value danger">{tl(sum(['expense']))}</div></div><div className="stat"><div className="label">Tahsilat + diğer gelir</div><div className="value ok">{tl(sum(['income', 'collection']))}</div></div><div className="stat"><div className="label">Bankaya yatan</div><div className="value">{tl(sum(['deposit']))}</div></div></div>
    <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
      <thead><tr><th>Tarih</th><th>Mağaza</th><th>İşlem</th><th>Kategori / açıklama</th><th>Ödeme</th><th>Kullanıcı</th><th className="num">Tutar</th></tr></thead>
      <tbody>{rows.map((m) => <tr key={m.id}><td>{fmtDateTime(m.created_at)}</td><td>{m.store_name}</td><td>{CASH[m.type]}</td><td>{m.category}{m.note && <span className="muted"> · {m.note}</span>}</td><td>{PAY[m.method]}</td><td>{m.user_name}</td><td className={'num bold ' + (['income', 'collection'].includes(m.type) ? 'ok' : 'danger')}>{tl(m.amount)}</td></tr>)}</tbody>
    </table></div>}</div>
  </div>;
}
