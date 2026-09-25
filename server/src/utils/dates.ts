/** Yerel (Türkiye) saatine göre YYYY-MM-DD */
export function today(): string {
  return localDate(new Date());
}
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function localDateTime(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDate(d);
}
/** Tarih aralığı parametrelerini doğrular; bitiş dahil olacak şekilde üst sınır üretir. */
export function range(from?: unknown, to?: unknown, defaultDays = 30): { from: string; to: string; toExclusive: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const t = typeof to === 'string' && re.test(to) ? to : today();
  const f = typeof from === 'string' && re.test(from) ? from : addDays(t, -(defaultDays - 1));
  return { from: f, to: t, toExclusive: addDays(t, 1) };
}
