import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, PageHead, Spinner } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate } from '../util';

/** Süper yönetici: uygulamayı satın alan firmaları (kiracıları) ve lisanslarını yönetir. */
export default function Admin() {
  const { toast } = useSession();
  const { data, loading, reload } = useLoad(() => api.get('/admin/tenants'), []);
  const { data: info } = useLoad(() => api.get('/admin/info'), []);
  const [edit, setEdit] = useState<any>(null);
  const [pw, setPw] = useState<any>(null);
  const rows: any[] = data ?? [];
  const save = async () => {
    try {
      const body: any = { code: edit.code, name: edit.name, plan: edit.plan, max_stores: Number(edit.max_stores), license_until: edit.license_until || null, active: edit.active !== 0 && edit.active !== false, phone: edit.phone || null, email: edit.email || null };
      if (!edit.id) { body.owner = { username: edit.owner_username, name: edit.owner_name, password: edit.owner_password }; body.first_store = { code: edit.store_code, name: edit.store_name }; }
      if (edit.id) await api.put(`/admin/tenants/${edit.id}`, body); else await api.post('/admin/tenants', body);
      setEdit(null); reload(); toast('Kaydedildi');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div>
      <PageHead title="Firmalar & Lisanslar"><button className="btn" onClick={() => setEdit({ code: '', name: '', plan: 'standart', max_stores: 5, active: true, store_code: 'MRK', store_name: 'Merkez Mağaza' })}>+ Yeni firma</button></PageHead>
      {info && <div className="small muted" style={{ marginBottom: 10 }}>Veritabanı: {info.dbFile} · Node {info.node} · Çalışma süresi {Math.round(info.uptime / 3600)} saat</div>}
      <div className="card" style={{ padding: 0 }}>{loading ? <Spinner /> : rows.length === 0 ? <Empty /> : <div className="table-wrap"><table>
        <thead><tr><th>Kod</th><th>Firma</th><th>Paket</th><th className="num">Mağaza</th><th className="num">Kullanıcı</th><th className="num">30 gün satış</th><th>Lisans</th><th>Durum</th><th /></tr></thead>
        <tbody>{rows.map((t) => <tr key={t.id}><td className="bold">{t.code}</td><td>{t.name}<br /><span className="small muted">{t.phone} {t.email}</span></td><td>{t.plan}</td><td className="num">{t.store_count} / {t.max_stores}</td><td className="num">{t.user_count}</td><td className="num">{t.sales30}</td><td>{t.license_until ? <span className={t.license_until < new Date().toISOString().slice(0, 10) ? 'danger bold' : ''}>{fmtDate(t.license_until)}</span> : 'Süresiz'}</td><td>{t.active ? <Badge kind="ok">Aktif</Badge> : <Badge kind="danger">Kapalı</Badge>}</td><td className="right nowrap"><button className="btn secondary sm" onClick={() => setEdit(t)}>Düzenle</button> <button className="btn ghost sm" onClick={() => setPw({ id: t.id, username: '', password: '' })}>Şifre sıfırla</button></td></tr>)}</tbody>
      </table></div>}</div>
      {edit && <Modal title={edit.id ? 'Firma düzenle' : 'Yeni firma (müşteri) kur'} onClose={() => setEdit(null)} footer={<><button className="btn secondary" onClick={() => setEdit(null)}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
        <div className="form">
          <label className="f"><span>Firma kodu (giriş ekranında) *</span><input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} disabled={!!edit.id} /></label>
          <label className="f"><span>Firma adı *</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="f"><span>Paket</span><select value={edit.plan} onChange={(e) => setEdit({ ...edit, plan: e.target.value })}><option value="baslangic">Başlangıç</option><option value="standart">Standart</option><option value="pro">Pro</option><option value="zincir">Zincir</option></select></label>
          <label className="f"><span>En fazla mağaza</span><input type="number" min={1} value={edit.max_stores} onChange={(e) => setEdit({ ...edit, max_stores: e.target.value })} /></label>
          <label className="f"><span>Lisans bitiş (boş = süresiz)</span><input type="date" value={edit.license_until ?? ''} onChange={(e) => setEdit({ ...edit, license_until: e.target.value })} /></label>
          <label className="f"><span>Telefon</span><input value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label className="f"><span>E-posta</span><input value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
          {edit.id && <label className="check"><input type="checkbox" checked={edit.active !== 0 && edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Aktif (kapalıysa kimse giriş yapamaz)</label>}
          {!edit.id && <>
            <div className="full bold" style={{ marginTop: 6 }}>İlk patron kullanıcısı</div>
            <label className="f"><span>Kullanıcı adı</span><input value={edit.owner_username ?? ''} onChange={(e) => setEdit({ ...edit, owner_username: e.target.value })} /></label>
            <label className="f"><span>Ad Soyad</span><input value={edit.owner_name ?? ''} onChange={(e) => setEdit({ ...edit, owner_name: e.target.value })} /></label>
            <label className="f"><span>Şifre</span><input value={edit.owner_password ?? ''} onChange={(e) => setEdit({ ...edit, owner_password: e.target.value })} /></label>
            <div className="full bold" style={{ marginTop: 6 }}>İlk mağaza</div>
            <label className="f"><span>Mağaza kodu</span><input value={edit.store_code} onChange={(e) => setEdit({ ...edit, store_code: e.target.value.toUpperCase() })} /></label>
            <label className="f"><span>Mağaza adı</span><input value={edit.store_name} onChange={(e) => setEdit({ ...edit, store_name: e.target.value })} /></label>
          </>}
        </div>
      </Modal>}
      {pw && <Modal title="Kullanıcı şifresi sıfırla" onClose={() => setPw(null)} narrow footer={<><button className="btn secondary" onClick={() => setPw(null)}>Vazgeç</button><button className="btn" onClick={async () => { try { await api.post(`/admin/tenants/${pw.id}/reset-owner-password`, { username: pw.username, password: pw.password }); toast('Şifre sıfırlandı'); setPw(null); } catch (e) { toast((e as Error).message, 'err'); } }}>Sıfırla</button></>}><div className="col"><label className="f"><span>Kullanıcı adı</span><input value={pw.username} onChange={(e) => setPw({ ...pw, username: e.target.value })} /></label><label className="f"><span>Yeni şifre</span><input value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label></div></Modal>}
    </div>
  );
}
