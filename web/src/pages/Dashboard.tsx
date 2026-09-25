import { Link } from 'react-router-dom';
import { api } from '../api';
import { Bars, ErrorBox, Progress, Spinner, StoreSelect } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, num, pct, tl, PAY } from '../util';
import { useState } from 'react';

export default function Dashboard() {
  const { can } = useSession();
  const [store, setStore] = useState<number | 'all'>('all');
  const { data, error, loading, reload } = useLoad(() => api.get('/dashboard', { storeId: store === 'all' ? undefined : store }), [store]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const d = data!;
  const diff = (a: number, b: number) => (b ? Math.round(((a - b) * 1000) / b) / 10 : null);
  const dy = diff(d.today.revenue, d.yesterday.revenue);
  const ly = diff(d.today.revenue, d.lastYear.revenue);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between">
        <div className="row"><StoreSelect value={store} onChange={setStore} all /><button className="btn secondary sm" onClick={reload}>↻ Yenile</button></div>
        {can('pos') && <Link to="/kasa" className="btn accent">🛒 Satış yap</Link>}
      </div>

      {d.alerts.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          {d.alerts.map((a: any) => (
            <div key={a.type} className={'alert ' + a.level}>
              <span>{a.level === 'danger' ? '🔴' : a.level === 'warn' ? '🟠' : '🔵'}</span><span>{a.text}</span>
              {a.link && <Link to={a.link}>Git →</Link>}
            </div>
          ))}
        </div>
      )}

      <div className="grid c4">
        <div className="stat accent">
          <div className="label">Bugünkü ciro</div>
          <div className="value">{tl(d.today.revenue)}</div>
          <div className="sub">{d.today.receipts} fiş · {d.today.pairs} çift{dy !== null && <> · düne göre <b className={dy >= 0 ? 'ok' : 'danger'}>{dy >= 0 ? '▲' : '▼'} {pct(Math.abs(dy))}</b></>}</div>
        </div>
        <div className="stat">
          <div className="label">Dün</div>
          <div className="value">{tl(d.yesterday.revenue)}</div>
          <div className="sub">{d.yesterday.receipts} fiş · {d.yesterday.pairs} çift</div>
        </div>
        <div className="stat">
          <div className="label">Bu ay</div>
          <div className="value">{tl(d.month.revenue)}</div>
          <div className="sub">{d.month.receipts} fiş · {d.month.pairs} çift{d.monthProfit !== undefined && <> · kâr <b>{tl(d.monthProfit)}</b></>}</div>
        </div>
        <div className="stat">
          <div className="label">Geçen yıl aynı gün</div>
          <div className="value">{tl(d.lastYear.revenue)}</div>
          <div className="sub">{ly !== null ? <>bugün <b className={ly >= 0 ? 'ok' : 'danger'}>{ly >= 0 ? '▲' : '▼'} {pct(Math.abs(ly))}</b></> : 'veri yok'}</div>
        </div>
      </div>

      {d.monthTarget && (
        <div className="card">
          <div className="row between"><b>Aylık hedef</b><span>{tl(d.month.revenue)} / {tl(d.monthTarget.amount)} · <b>{pct(d.monthTarget.percent)}</b></span></div>
          <Progress value={d.month.revenue} max={d.monthTarget.amount} warn={d.monthTarget.percent < 50} />
        </div>
      )}

      <div className="grid c2">
        <div className="card">
          <h2>Son 14 gün</h2>
          <Bars data={d.last14.map((x: any) => ({ label: fmtDate(x.day), value: x.revenue }))} />
          <div className="row between small muted" style={{ marginTop: 4 }}><span>{d.last14[0] ? fmtDate(d.last14[0].day) : ''}</span><span>bugün</span></div>
        </div>
        <div className="card">
          <h2>Mağazalar (bugün)</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Mağaza</th><th>Kasa</th><th className="num">Fiş</th><th className="num">Çift</th><th className="num">Ciro</th></tr></thead>
            <tbody>
              {d.registers.map((r: any) => (
                <tr key={r.id}>
                  <td className="bold">{r.name}</td>
                  <td>{r.session_id ? <span className="badge ok">Açık · {r.opened_by_name}</span> : <span className="badge">Kapalı</span>}</td>
                  <td className="num">{r.today_receipts}</td><td className="num">{r.today_pairs}</td><td className="num bold">{tl(r.today_total)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="grid c3">
        <div className="card">
          <h2>Bugün en çok satanlar</h2>
          {d.topToday.length === 0 ? <div className="muted">Henüz satış yok</div> : (
            <table><tbody>{d.topToday.map((p: any) => <tr key={p.id}><td>{p.label}</td><td className="num">{p.pairs} çift</td><td className="num">{tl(p.revenue)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Personel (bu ay)</h2>
          {d.staffMonth.length === 0 ? <div className="muted">Satış yok</div> : (
            <table><tbody>{d.staffMonth.slice(0, 8).map((p: any) => <tr key={p.id}><td>{p.name}</td><td className="num">{p.pairs} çift</td><td className="num">{tl(p.revenue)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Bugün ödeme türleri</h2>
          {d.paymentsToday.length === 0 ? <div className="muted">Satış yok</div> : (
            <table><tbody>{d.paymentsToday.map((p: any) => <tr key={p.method}><td>{PAY[p.method] ?? p.method}</td><td className="num">{num(p.n)} işlem</td><td className="num">{tl(p.amount)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
