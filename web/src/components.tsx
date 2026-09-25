import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from './store';
import { addDays, monthStart, parseTL, today, tl } from './util';

export function Spinner() {
  return <div className="loading-page"><span className="spinner" /></div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="alert danger">⚠ {error}</div>;
}

export function Modal({ title, onClose, children, footer, wide, narrow }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; narrow?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '') + (narrow ? ' narrow' : '')}>
        <header>
          <span>{title}</span>
          <button className="btn ghost sm" onClick={onClose} aria-label="Kapat">✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** Onay penceresi */
export function Confirm({ title, text, onOk, onClose, danger }: { title: string; text: ReactNode; onOk: () => void | Promise<void>; onClose: () => void; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} narrow footer={<><button className="btn secondary" onClick={onClose}>Vazgeç</button><button className={'btn' + (danger ? ' danger' : '')} disabled={busy} onClick={async () => { setBusy(true); try { await onOk(); } finally { setBusy(false); } }}>Onayla</button></>}>
      <div>{text}</div>
    </Modal>
  );
}

/** Para girişi: TL olarak yazılır, kuruş olarak saklanır */
export function MoneyInput({ value, onChange, autoFocus, placeholder, className, disabled, onEnter }: { value: number; onChange: (kurus: number) => void; autoFocus?: boolean; placeholder?: string; className?: string; disabled?: boolean; onEnter?: () => void }) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2).replace('.', ',') : '');
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value ? (value / 100).toFixed(2).replace('.', ',') : '');
    }
  }, [value]);
  return (
    <input
      inputMode="decimal"
      className={className}
      autoFocus={autoFocus}
      placeholder={placeholder ?? '0,00'}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const k = parseTL(e.target.value);
        last.current = k;
        onChange(k);
      }}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      onBlur={() => setText(value ? (value / 100).toFixed(2).replace('.', ',') : '')}
    />
  );
}

export function StoreSelect({ value, onChange, all, includeWarehouse = true, label }: { value: number | null | 'all'; onChange: (v: number | 'all') => void; all?: boolean; includeWarehouse?: boolean; label?: string }) {
  const { session } = useSession();
  const stores = (session?.stores ?? []).filter((s) => includeWarehouse || !s.is_warehouse);
  const sel = (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
      {all && <option value="all">Tüm mağazalar</option>}
      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_warehouse ? ' (depo)' : ''}</option>)}
    </select>
  );
  return label ? <label className="f"><span>{label}</span>{sel}</label> : sel;
}

export interface Range { from: string; to: string }
export function DateRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const t = today();
  const presets: [string, Range][] = [
    ['Bugün', { from: t, to: t }],
    ['Dün', { from: addDays(t, -1), to: addDays(t, -1) }],
    ['7 gün', { from: addDays(t, -6), to: t }],
    ['Bu ay', { from: monthStart(), to: t }],
    ['30 gün', { from: addDays(t, -29), to: t }],
    ['90 gün', { from: addDays(t, -89), to: t }],
  ];
  return (
    <div className="row">
      <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} style={{ width: 150 }} />
      <span className="muted">–</span>
      <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} style={{ width: 150 }} />
      <div className="chips">
        {presets.map(([l, r]) => <button key={l} className={'chip' + (r.from === value.from && r.to === value.to ? ' sel' : '')} onClick={() => onChange(r)}>{l}</button>)}
      </div>
    </div>
  );
}

export function Badge({ kind, children }: { kind?: 'ok' | 'warn' | 'danger' | 'info' | ''; children: ReactNode }) {
  return <span className={'badge ' + (kind ?? '')}>{children}</span>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; badge?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} className={t.key === value ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.badge ? <span className="badge info" style={{ marginLeft: 6 }}>{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ text = 'Kayıt bulunamadı' }: { text?: string }) {
  return <div className="empty">{text}</div>;
}

/** Basit çubuk grafik */
export function Bars({ data, label, valueLabel }: { data: { label: string; value: number }[]; label?: (d: { label: string; value: number }) => string; valueLabel?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const vl = valueLabel ?? ((v: number) => tl(v));
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div key={i} className="bar" style={{ height: `${(Math.max(0, d.value) / max) * 100}%` }}>
          <span className="tip">{label ? label(d) : d.label}: {vl(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, max, warn }: { value: number; max: number; warn?: boolean }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className={'hbar' + (warn ? ' warn' : '')}><div style={{ width: p + '%' }} /></div>;
}

/** Sayfa başlığı ve sağ taraf aksiyonları */
export function PageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="row between" style={{ marginBottom: 14 }}>
      <h1 style={{ margin: 0 }}>{title}</h1>
      <div className="row">{children}</div>
    </div>
  );
}

/** Barkod (Code128-B) SVG üretimi: etiket yazdırma için */
const C128 = ['11011001100','11001101100','11001100110','10010011000','10010001100','10001001100','10011001000','10011000100','10001100100','11001001000','11001000100','11000100100','10110011100','10011011100','10011001110','10111001100','10011101100','10011100110','11001110010','11001011100','11001001110','11011100100','11001110100','11101101110','11101001100','11100101100','11100100110','11101100100','11100110100','11100110010','11011011000','11011000110','11000110110','10100011000','10001011000','10001000110','10110001000','10001101000','10001100010','11010001000','11000101000','11000100010','10110111000','10110001110','10001101110','10111011000','10111000110','10001110110','11101110110','11010001110','11000101110','11011101000','11011100010','11011101110','11101011000','11101000110','11100010110','11101101000','11101100010','11100011010','11101111010','11001000010','11110001010','10100110000','10100001100','10010110000','10010000110','10000101100','10000100110','10110010000','10110000100','10011010000','10011000010','10000110100','10000110010','11000010010','11001010000','11110111010','11000010100','10001111010','10100111100','10010111100','10010011110','10111100100','10011110100','10011110010','11110100100','11110010100','11110010010','11011011110','11011110110','11110110110','10101111000','10100011110','10001011110','10111101000','10111100010','11110101000','11110100010','10111011110','10111101110','11101011110','11110101110','11010000100','11010010000','11010011100','1100011101011'];
export function Barcode({ value, height = 40 }: { value: string; height?: number }) {
  const codes = [104, ...[...value].map((c) => c.charCodeAt(0) - 32)];
  const check = codes.reduce((a, c, i) => a + c * (i || 1), 0) % 103;
  const bits = [...codes, check, 106].map((c) => C128[c]).join('');
  let x = 0;
  const rects: ReactNode[] = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') rects.push(<rect key={i} x={x} y={0} width={1} height={height} fill="#000" />);
    x++;
  }
  return (
    <svg viewBox={`0 0 ${x} ${height + 12}`} preserveAspectRatio="none" style={{ height: height + 12 }}>
      {rects}
      <text x={x / 2} y={height + 10} fontSize="9" textAnchor="middle" fontFamily="monospace">{value}</text>
    </svg>
  );
}

/** Arama kutusu: yazmayı bitirince tetikler */
export function Search({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [t, setT] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => t !== value && onChange(t), 300);
    return () => clearTimeout(id);
  }, [t]); // eslint-disable-line
  return <input placeholder={placeholder ?? 'Ara...'} value={t} onChange={(e) => setT(e.target.value)} autoFocus={autoFocus} style={{ maxWidth: 320 }} />;
}
