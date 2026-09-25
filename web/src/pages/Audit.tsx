import { useState } from 'react';
import { api } from '../api';
import { DateRange, Empty, PageHead, Spinner, type Range } from '../components';
import { useLoad } from '../store';
import { addDays, fmtDateTime, today } from '../util';

export default function Audit() {
  const [range, setRange] = useState<Range>({ from: addDays(today(), -6), to: today() });
  const [action, setAction] = useState('');
  const { data, loading } = useLoad(() => api.get('/audit', { from: range.from, to: range.to, action: action || undefined }), [range, action]);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHead title="İşlem Kayıtları" />
      <div className="alert info" style={{ marginBottom: 12 }}>Kim, ne zaman, ne yaptı: satış iptali, fiyat değişikliği, stok düzeltme, kasa açma/kapama, kullanıcı işlemleri. Silinemez.</div>
      <div className="card" style={{ marginBottom: 12 }}><div className="row"><select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 'auto' }}><option value="">Tüm işlemler</option><option value="sale">Satış</option><option value="sale.cancel">Satış iptali</option><option value="product">Ürün</option><option value="stock">Stok düzeltme</option><option value="register">Kasa</option><option value="cash">Kasa hareketi</option><option value="customer">Müşteri</option><option value="user">Kullanıcı</option><option value="login">Giriş</option><option value="settings">Ayarlar</option><option value="integration">Entegrasyon</option></select><DateRange value={range} onChange={setRange} /></div></div>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Kullanıcı</th><th>İşlem</th><th>Kayıt</th><th>Detay</th><th>IP</th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id}><td className="nowrap">{fmtDateTime(a.created_at)}</td><td>{a.user_name ?? '—'}</td><td className="mono">{a.action}</td><td>{a.entity}{a.entity_id ? ' #' + a.entity_id : ''}</td><td className="small mono" style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.detail}</td><td className="small muted">{a.ip}</td></tr>)}</tbody>
      </table></div>}</div>
    </div>
  );
}
