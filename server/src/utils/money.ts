/** KDV dahil tutardan KDV miktarını hesaplar (kuruş). */
export function vatFromGross(gross: number, rate: number): number {
  if (!rate) return 0;
  return Math.round((gross * rate) / (100 + rate));
}

/** Tutarı ağırlıklara göre kuruş kaybı olmadan paylaştırır. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i] += 1;
  return out;
}

export function formatTL(kurus: number): string {
  return (kurus / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}
