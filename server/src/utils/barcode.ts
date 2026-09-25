/** EAN-13 kontrol hanesini hesaplar (12 haneli gövde için). */
export function ean13CheckDigit(body12: string): number {
  if (!/^\d{12}$/.test(body12)) throw new Error('EAN-13 gövdesi 12 hane olmalı');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Mağaza içi barkod üretir. GS1 kurallarına göre 20-29 ile başlayan kodlar
 * mağaza içi kullanım için ayrılmıştır; üretici barkodlarıyla çakışmaz.
 * Biçim: 2 + firma(3) + sıra(8) + kontrol
 */
export function internalEan13(tenantId: number, seq: number): string {
  const body = '2' + String(tenantId % 1000).padStart(3, '0') + String(seq).padStart(8, '0');
  if (body.length !== 12) throw new Error('Barkod sırası taştı');
  return body + ean13CheckDigit(body);
}
