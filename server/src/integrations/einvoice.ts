/**
 * e-Arşiv / e-Fatura: UBL-TR 1.2 formatında fatura XML'i üretir ve entegratöre gönderir.
 * Entegratörlerin API'leri farklıdır; burada "generic" REST akışı ile yaygın entegratörlerin
 * temel gönderim ucu desteklenir. Üretim kullanımı için entegratörden alınan adres/parametreler girilir.
 */
import { all, one } from '../db/index.js';
import { nextSeq } from '../utils/seq.js';
import { httpCall, basicAuth, need } from './http.js';
import type { JobResult } from './worker.js';

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const tl = (k: number) => (k / 100).toFixed(2);

export interface BuiltInvoice {
  invoiceNo: string;
  uuid: string;
  xml: string;
  profile: 'EARSIVFATURA' | 'TEMELFATURA';
  total: number;
}

export function buildInvoice(tenantId: number, saleId: number, cfg: Record<string, string>): BuiltInvoice | null {
  const s = one<Record<string, any>>(
    `SELECT s.*, c.name customer_name, c.tax_no customer_tax_no, c.tax_office customer_tax_office, c.address customer_address, c.city customer_city,
            c.email customer_email, t.name tenant_name, t.tax_no tenant_tax_no, t.tax_office tenant_tax_office, t.address tenant_address,
            st.name store_name
       FROM sales s JOIN tenants t ON t.id = s.tenant_id JOIN stores st ON st.id = s.store_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ? AND s.tenant_id = ?`,
    saleId, tenantId,
  );
  if (!s || s.status !== 'completed') return null;
  const items = all<Record<string, any>>(
    `SELECT si.*, p.name, p.code, v.color, v.size FROM sale_items si JOIN variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id WHERE si.sale_id = ?`,
    saleId,
  );
  const prefix = (cfg.invoicePrefix || 'DCA').toUpperCase().slice(0, 3);
  const year = String(s.created_at).slice(0, 4);
  const invoiceNo = s.einvoice_no || `${prefix}${year}${String(nextSeq(tenantId, 'einvoice:' + year)).padStart(9, '0')}`;
  const uuid = crypto.randomUUID();
  const isReturn = s.total < 0;
  const sign = isReturn ? -1 : 1;
  const vkn = (s.customer_tax_no || '').replace(/\D/g, '');
  const isCompany = vkn.length === 10;
  const profile: BuiltInvoice['profile'] = isCompany ? 'TEMELFATURA' : 'EARSIVFATURA';
  const vatGroups = new Map<number, { base: number; vat: number }>();
  const lines = items
    .map((it, i) => {
      const lineTotal = it.line_total * sign;
      const vat = Math.round((lineTotal * it.vat_rate) / (100 + it.vat_rate));
      const base = lineTotal - vat;
      const g = vatGroups.get(it.vat_rate) ?? { base: 0, vat: 0 };
      g.base += base;
      g.vat += vat;
      vatGroups.set(it.vat_rate, g);
      const qty = Math.abs(it.qty);
      const unitNet = qty ? base / qty : 0;
      return `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">${tl(base)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="TRY">${tl(vat)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="TRY">${tl(base)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="TRY">${tl(vat)}</cbc:TaxAmount>
        <cbc:Percent>${it.vat_rate}</cbc:Percent>
        <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item><cbc:Name>${esc(`${it.code} ${it.name} ${it.color} ${it.size}`)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${esc(it.code)}</cbc:ID></cac:SellersItemIdentification></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">${(unitNet / 100).toFixed(4)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('');
  const totalBase = [...vatGroups.values()].reduce((a, g) => a + g.base, 0);
  const totalVat = [...vatGroups.values()].reduce((a, g) => a + g.vat, 0);
  const payable = Math.abs(s.total);
  const date = String(s.created_at).slice(0, 10);
  const time = String(s.created_at).slice(11, 19) || '00:00:00';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${profile}</cbc:ProfileID>
  <cbc:ID>${invoiceNo}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${isReturn ? 'IADE' : 'SATIS'}</cbc:InvoiceTypeCode>
  <cbc:Note>${esc('Fiş no: ' + s.receipt_no + ' / ' + s.store_name)}</cbc:Note>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${items.length}</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="${(cfg.senderVkn || s.tenant_tax_no || '').length === 11 ? 'TCKN' : 'VKN'}">${esc(cfg.senderVkn || s.tenant_tax_no)}</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>${esc(cfg.senderTitle || s.tenant_name)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>${esc(s.tenant_address)}</cbc:StreetName><cbc:CityName>Ankara</cbc:CityName><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>${esc(s.tenant_tax_office)}</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="${isCompany ? 'VKN' : 'TCKN'}">${esc(vkn || '11111111111')}</cbc:ID></cac:PartyIdentification>
    ${isCompany ? `<cac:PartyName><cbc:Name>${esc(s.customer_name)}</cbc:Name></cac:PartyName>` : ''}
    <cac:PostalAddress><cbc:StreetName>${esc(s.customer_address || '-')}</cbc:StreetName><cbc:CityName>${esc(s.customer_city || '-')}</cbc:CityName><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress>
    ${isCompany ? `<cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>${esc(s.customer_tax_office)}</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
    ${!isCompany ? `<cac:Person><cbc:FirstName>${esc((s.customer_name || 'Nihai Tüketici').split(' ').slice(0, -1).join(' ') || s.customer_name || 'Nihai')}</cbc:FirstName><cbc:FamilyName>${esc((s.customer_name || 'Tüketici').split(' ').slice(-1)[0])}</cbc:FamilyName></cac:Person>` : ''}
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">${tl(totalVat)}</cbc:TaxAmount>${[...vatGroups.entries()]
      .map(([rate, g]) => `
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">${tl(g.base)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">${tl(g.vat)}</cbc:TaxAmount><cbc:Percent>${rate}</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`)
      .join('')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">${tl(totalBase)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">${tl(totalBase)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">${tl(payable)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="TRY">${tl(payable)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>`;
  return { invoiceNo, uuid, xml, profile, total: payable };
}

export async function sendInvoice(cfg: Record<string, string>, inv: BuiltInvoice): Promise<JobResult> {
  need(cfg, 'endpoint', 'username', 'password');
  const integrator = cfg.integrator || 'generic';
  // Yaygın entegratörler için ortak REST kalıbı: XML gövde + temel kimlik doğrulama.
  // Entegratöre özel farklar (ör. Base64 zarf, sessionId) burada dallanır.
  let body = inv.xml;
  let headers: Record<string, string> = { 'Content-Type': 'application/xml; charset=utf-8', Authorization: basicAuth(cfg.username, cfg.password) };
  if (['uyumsoft', 'logo', 'edm', 'izibiz', 'parasut'].includes(integrator)) {
    headers = { 'Content-Type': 'application/json', Authorization: basicAuth(cfg.username, cfg.password) };
    body = JSON.stringify({ profile: inv.profile, invoiceNo: inv.invoiceNo, uuid: inv.uuid, xml: Buffer.from(inv.xml).toString('base64') });
  }
  const r = await httpCall(cfg.endpoint, { headers, body });
  return { ok: r.ok, response: { status: r.status, body: r.text.slice(0, 2000) } };
}

export async function cancelInvoice(cfg: Record<string, string>, invoiceNo: string): Promise<JobResult> {
  need(cfg, 'endpoint', 'username', 'password');
  const r = await httpCall(cfg.endpoint.replace(/\/+$/, '') + '/cancel', {
    headers: { 'Content-Type': 'application/json', Authorization: basicAuth(cfg.username, cfg.password) },
    body: JSON.stringify({ invoiceNo }),
  });
  return { ok: r.ok, response: { status: r.status, body: r.text.slice(0, 2000) } };
}
