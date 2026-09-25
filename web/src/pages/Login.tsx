import { useState, type FormEvent } from 'react';
import { useSession } from '../store';

export default function Login() {
  const { login } = useSession();
  const [tenant, setTenant] = useState(localStorage.getItem('dc_tenant') ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(tenant.trim(), username.trim(), password);
      localStorage.setItem('dc_tenant', tenant.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 18 }}>
          <img src="/icon.svg" alt="" width={40} height={40} />
          <div><div style={{ fontSize: 20, fontWeight: 700 }}>DC Ayakkabı Satış</div><div className="muted small">Mağaza yönetim sistemi</div></div>
        </div>
        <div className="col">
          <label className="f"><span>Firma kodu</span><input value={tenant} onChange={(e) => setTenant(e.target.value)} autoFocus autoCapitalize="none" required /></label>
          <label className="f"><span>Kullanıcı adı</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required /></label>
          <label className="f"><span>Şifre</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="alert danger">{error}</div>}
          <button className="btn lg block" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
        </div>
        <p className="muted small" style={{ marginTop: 16, textAlign: 'center' }}>Firma kodunuzu ve kullanıcı bilgilerinizi yöneticinizden alabilirsiniz.</p>
      </form>
    </div>
  );
}
