import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Modal, PageHead, Spinner } from '../components';
import { useLoad, useSession } from '../store';
import { fmtDate, today } from '../util';

export default function Tasks() {
  const { session, toast } = useSession();
  const [showDone, setShowDone] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const { data, loading, reload } = useLoad(() => api.get('/tasks', { done: showDone ? '1' : '0' }), [showDone]);
  const { data: users } = useLoad(() => api.get('/users').catch(() => []), []);
  const rows: any[] = data ?? [];
  const toggle = async (t: any) => { await api.post(`/tasks/${t.id}/done`, { done: !t.done }); reload(); };
  const save = async () => {
    try {
      const body = { title: edit.title, detail: edit.detail || undefined, storeId: edit.storeId || null, assignedTo: edit.assignedTo || null, dueDate: edit.dueDate || null };
      if (edit.id) await api.put(`/tasks/${edit.id}`, body); else await api.post('/tasks', body);
      setEdit(null); reload(); toast('Kaydedildi');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div>
      <PageHead title="Görevler / Notlar"><label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Tamamlananları göster</label><button className="btn" onClick={() => setEdit({ title: '', dueDate: today() })}>+ Görev / not ekle</button></PageHead>
      <div className="card" style={{ padding: 0 }}>{loading && !data ? <Spinner /> : rows.length === 0 ? <Empty text="Bekleyen görev yok 👍" /> : <table><tbody>{rows.map((t) => <tr key={t.id} style={t.done ? { opacity: 0.5 } : {}}><td style={{ width: 40 }}><input type="checkbox" checked={!!t.done} onChange={() => toggle(t)} /></td><td className="click" onClick={() => setEdit({ ...t, storeId: t.store_id, assignedTo: t.assigned_to, dueDate: t.due_date })}><b>{t.title}</b>{t.detail && <div className="small muted">{t.detail}</div>}<div className="small muted">{t.store_name && <Badge>{t.store_name}</Badge>} {t.assigned_name && <Badge kind="info">{t.assigned_name}</Badge>} {t.due_date && <span className={!t.done && t.due_date < today() ? 'danger bold' : ''}>📅 {fmtDate(t.due_date)}</span>} · {t.created_by_name}</div></td><td className="right"><button className="btn ghost sm" onClick={async () => { await api.del(`/tasks/${t.id}`); reload(); }}>✕</button></td></tr>)}</tbody></table>}</div>
      {edit && <Modal title={edit.id ? 'Görevi düzenle' : 'Yeni görev / not'} onClose={() => setEdit(null)} narrow footer={<><button className="btn secondary" onClick={() => setEdit(null)}>Vazgeç</button><button className="btn" onClick={save}>Kaydet</button></>}>
        <div className="col">
          <input placeholder="Başlık *" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus />
          <textarea placeholder="Detay" value={edit.detail ?? ''} onChange={(e) => setEdit({ ...edit, detail: e.target.value })} />
          <label className="f"><span>Mağaza</span><select value={edit.storeId ?? ''} onChange={(e) => setEdit({ ...edit, storeId: e.target.value ? Number(e.target.value) : null })}><option value="">Tüm firma</option>{session?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="f"><span>Sorumlu</span><select value={edit.assignedTo ?? ''} onChange={(e) => setEdit({ ...edit, assignedTo: e.target.value ? Number(e.target.value) : null })}><option value="">Herkes</option>{(users ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="f"><span>Tarih</span><input type="date" value={edit.dueDate ?? ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></label>
        </div>
      </Modal>}
    </div>
  );
}
