/** Kuruş → "1.234,56 ₺" */
export function tl(kurus: number | null | undefined, opts: { sign?: boolean } = {}) {
  const n = (kurus ?? 0) / 100;
  const s = n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
  return opts.sign && n > 0 ? '+' + s : s;
}
/** "1.234,56" veya "1234.56" → kuruş */
export function parseTL(s: string | number): number {
  if (typeof s === 'number') return Math.round(s * 100);
  const t = s.replace(/\s|₺/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('tr-TR');
export const pct = (n: number | null | undefined) => `%${(n ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;

export function fmtDate(s?: string | null) {
  if (!s) return '';
  const [d] = s.split(' ');
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}
export function fmtDateTime(s?: string | null) {
  if (!s) return '';
  return fmtDate(s) + (s.length > 10 ? ' ' + s.slice(11, 16) : '');
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(date: string, n: number) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function monthStart() {
  return today().slice(0, 8) + '01';
}
export const PAY: Record<string, string> = { cash: 'Nakit', card: 'Kredi kartı', transfer: 'Havale/EFT', credit: 'Veresiye', giftcard: 'Hediye çeki', points: 'Puan', deposit: 'Kapora' };
export const GENDER: Record<string, string> = { kadin: 'Kadın', erkek: 'Erkek', cocuk: 'Çocuk', unisex: 'Unisex' };
export const SALE_TYPE: Record<string, string> = { sale: 'Satış', return: 'İade', exchange: 'Değişim' };

/** CSV indirme (Excel'de açılır; UTF-8 BOM ile Türkçe karakterler bozulmaz) */
export function downloadCsv(name: string, rows: Record<string, unknown>[], columns?: { key: string; label: string }[]) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.label)).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.endsWith('.csv') ? name : name + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Basit CSV/TSV ayrıştırıcı (Excel'den yapıştırma) */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (q && l[i + 1] === '"') (cur += '"'), i++;
        else q = !q;
      } else if (ch === sep && !q) (out.push(cur), (cur = ''));
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] ?? `col${i}`, v])));
}

export function beep(ok = true) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1200 : 300;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0.05;
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
  } catch {
    /* ses desteklenmiyor */
  }
}
