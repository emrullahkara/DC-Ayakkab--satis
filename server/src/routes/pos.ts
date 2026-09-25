import { Router } from 'express';
import { z } from 'zod';
import { me, requirePerm, storeFilter } from '../auth.js';
import { h, id, intOpt, parse, money } from './helpers.js';
import { cancelSale, createSale, getSale, listSales, quote, returnSale, PAY_LABELS } from '../services/sales.js';
import { lookupBarcode, searchVariants, variantStockAllStores } from '../services/products.js';
import { activeCampaigns } from '../services/pricing.js';
import { listSalespeople } from '../services/staff.js';
import { range } from '../utils/dates.js';
import { one } from '../db/index.js';
import { notFound } from '../utils/errors.js';
import {
  closeRegister, currentRegister, listCashMovements, listSessions, openRegister, recordCash, sessionReport, CASH_LABELS, EXPENSE_CATEGORIES,
} from '../services/register.js';
import { checkGiftCard, listGiftCards, sellGiftCard } from '../services/giftcards.js';
import { getSettings } from '../services/settings.js';

export const posRouter = Router();

const cartItem = z.object({ variantId: z.number().int(), qty: z.number().int().min(1), unitPrice: money.optional(), discount: money.optional() });
const payment = z.object({
  method: z.enum(['cash', 'card', 'transfer', 'credit', 'giftcard', 'points', 'deposit']),
  amount: z.number().int(),
  installments: z.number().int().min(1).max(12).optional(),
  ref: z.string().max(64).optional(),
});

posRouter.get('/pos/meta', requirePerm('pos'), h((req) => {
  const u = me(req);
  const storeId = Number(req.query.storeId);
  return {
    payLabels: PAY_LABELS,
    salespeople: storeId ? listSalespeople(u.tenantId, storeId) : [],
    campaigns: storeId ? activeCampaigns(u.tenantId, storeId) : [],
    settings: getSettings(u.tenantId).pos,
  };
}));

posRouter.get('/pos/barcode/:code', requirePerm('pos', 'stock.view'), h((req) => lookupBarcode(me(req), String(req.params.code))));
posRouter.get('/pos/search', requirePerm('pos', 'stock.view'), h((req) => searchVariants(me(req), String(req.query.q ?? ''), Number(req.query.storeId))));
posRouter.get('/pos/variant/:id/stock', requirePerm('pos', 'stock.view'), h((req) => variantStockAllStores(me(req).tenantId, id(req.params.id))));

posRouter.post('/pos/quote', requirePerm('pos'), h((req) => {
  const body = parse(z.object({ storeId: z.number().int(), items: z.array(cartItem), cartDiscount: money.optional() }), req.body);
  return quote(me(req), body);
}));

posRouter.post('/pos/sale', requirePerm('pos'), h((req) => {
  const body = parse(
    z.object({
      storeId: z.number().int(),
      customerId: z.number().int().nullable().optional(),
      salespersonId: z.number().int().nullable().optional(),
      customerOrderId: z.number().int().nullable().optional(),
      items: z.array(cartItem).min(1),
      cartDiscount: money.optional(),
      payments: z.array(payment).min(1),
      note: z.string().max(500).nullable().optional(),
      einvoice: z.boolean().optional(),
    }),
    req.body,
  );
  return createSale(me(req), body);
}));

posRouter.post('/pos/return', requirePerm('sales.return'), h((req) => {
  const body = parse(
    z.object({
      storeId: z.number().int(),
      originalSaleId: z.number().int(),
      returnItems: z.array(z.object({ saleItemId: z.number().int(), qty: z.number().int().min(1) })).min(1),
      newItems: z.array(cartItem).optional(),
      cartDiscount: money.optional(),
      payments: z.array(payment),
      reason: z.string().max(300).optional(),
      salespersonId: z.number().int().nullable().optional(),
    }),
    req.body,
  );
  return returnSale(me(req), body);
}));

posRouter.get('/sales', requirePerm('sales.view'), h((req) => {
  const u = me(req);
  const r = range(req.query.from, req.query.to);
  return listSales(u.tenantId, {
    storeIds: storeFilter(u, req.query.storeId), from: r.from, toExclusive: r.toExclusive,
    q: req.query.q ? String(req.query.q) : undefined, customerId: intOpt(req.query.customerId), userId: intOpt(req.query.userId),
    type: req.query.type ? String(req.query.type) : undefined, status: req.query.status ? String(req.query.status) : undefined,
    limit: intOpt(req.query.limit), offset: intOpt(req.query.offset),
  });
}));
posRouter.get('/sales/receipt/:no', requirePerm('sales.view'), h((req) => {
  const u = me(req);
  const s = one<{ id: number }>('SELECT id FROM sales WHERE tenant_id = ? AND receipt_no = ?', u.tenantId, String(req.params.no).trim().toUpperCase());
  if (!s) throw notFound('Fiş bulunamadı');
  return getSale(u, s.id);
}));
posRouter.get('/sales/:id', requirePerm('sales.view'), h((req) => getSale(me(req), id(req.params.id))));
posRouter.post('/sales/:id/cancel', requirePerm('sales.cancel'), h((req) => cancelSale(me(req), id(req.params.id), String(req.body?.reason ?? ''))));

// ---------------------------------------------------------------- Kasa
posRouter.get('/register/meta', requirePerm('register', 'cash.movements'), h(() => ({ cashLabels: CASH_LABELS, expenseCategories: EXPENSE_CATEGORIES })));
posRouter.get('/register/:storeId', requirePerm('register', 'pos', 'cash.movements'), h((req) => currentRegister(me(req), id(req.params.storeId))));
posRouter.post('/register/:storeId/open', requirePerm('register'), h((req) => {
  const b = parse(z.object({ openingCash: money, note: z.string().optional() }), req.body);
  return openRegister(me(req), id(req.params.storeId), b.openingCash, b.note);
}));
posRouter.post('/register/:storeId/close', requirePerm('register'), h((req) => {
  const b = parse(z.object({ countedCash: money, note: z.string().optional() }), req.body);
  return closeRegister(me(req), id(req.params.storeId), b.countedCash, b.note);
}));
posRouter.post('/cash', requirePerm('cash.movements'), h((req) => {
  const b = parse(
    z.object({
      storeId: z.number().int(), type: z.enum(['expense', 'income', 'deposit', 'withdraw']), method: z.enum(['cash', 'card', 'transfer']).optional(),
      category: z.string().max(80).nullable().optional(), amount: z.number().int().positive(), note: z.string().max(300).nullable().optional(),
    }),
    req.body,
  );
  const mid = recordCash(me(req), b);
  return one('SELECT * FROM cash_movements WHERE id = ?', mid);
}));
posRouter.get('/cash', requirePerm('cash.movements', 'reports'), h((req) => {
  const u = me(req);
  const r = range(req.query.from, req.query.to);
  return listCashMovements(u.tenantId, storeFilter(u, req.query.storeId), r.from, r.toExclusive, req.query.type ? String(req.query.type) : undefined);
}));
posRouter.get('/register-sessions', requirePerm('register', 'reports'), h((req) => {
  const u = me(req);
  const r = range(req.query.from, req.query.to);
  return listSessions(u.tenantId, storeFilter(u, req.query.storeId), r.from, r.toExclusive);
}));
posRouter.get('/register-sessions/:id', requirePerm('register', 'reports'), h((req) => sessionReport(me(req), id(req.params.id))));

// ---------------------------------------------------------------- Hediye çeki
posRouter.get('/giftcards', requirePerm('giftcards'), h((req) => listGiftCards(me(req).tenantId, req.query.q ? String(req.query.q) : undefined)));
posRouter.get('/giftcards/check/:code', requirePerm('pos', 'giftcards'), h((req) => checkGiftCard(me(req).tenantId, String(req.params.code))));
posRouter.post('/giftcards/sell', requirePerm('giftcards'), h((req) => {
  const b = parse(
    z.object({ storeId: z.number().int(), amount: z.number().int().positive(), method: z.enum(['cash', 'card', 'transfer']), customerId: z.number().int().nullable().optional(), validDays: z.number().int().min(1).max(3650).optional(), note: z.string().optional() }),
    req.body,
  );
  return sellGiftCard(me(req), b);
}));

posRouter.get('/receipts/:id/print', requirePerm('sales.view'), h((req) => {
  const u = me(req);
  const s = getSale(u, id(req.params.id)) as any;
  const settings = getSettings(u.tenantId);
  const tenant = one<{ name: string; tax_no: string | null; tax_office: string | null }>('SELECT name, tax_no, tax_office FROM tenants WHERE id = ?', u.tenantId)!;
  return { sale: s, tenant, receipt: settings.receipt, payLabels: PAY_LABELS };
}));
