import { Router } from 'express';
import { z } from 'zod';
import { me, requirePerm, hasPerm } from '../auth.js';
import { h, id, intOpt, parse } from './helpers.js';
import { adjustBalance, collectPayment, getCustomer, receivables, saveCustomer, searchCustomers } from '../services/customers.js';
import { createCustomerOrder, getCustomerOrder, listCustomerOrders, ORDER_STATUS, setCustomerOrderStatus } from '../services/customerOrders.js';
import { getPO, listPOs, listSuppliers, getSupplier, payables, quickReceive, receivePO, savePO, saveSupplier, setPOStatus, supplierEntry } from '../services/purchasing.js';
import { clockIn, clockOut, deleteTask, listShifts, listTargets, listTasks, listUsers, myShift, saveTask, saveUser, setTarget, toggleTask } from '../services/staff.js';
import { availableChannels, bulkMessage } from '../services/messages.js';
import { range } from '../utils/dates.js';
import { forbidden } from '../utils/errors.js';

export const peopleRouter = Router();

// ---------------------------------------------------------------- Müşteriler
const customerSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().max(120).nullable().optional(),
  birth_date: z.string().max(10).nullable().optional(),
  gender: z.string().max(10).nullable().optional(),
  shoe_size: z.string().max(10).nullable().optional(),
  city: z.string().max(60).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  tax_no: z.string().max(11).nullable().optional(),
  tax_office: z.string().max(60).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  kvkk_consent: z.boolean().optional(),
  sms_consent: z.boolean().optional(),
  credit_limit: z.number().int().min(0).optional(),
  home_store_id: z.number().int().nullable().optional(),
});
peopleRouter.get('/customers', requirePerm('customers'), h((req) => searchCustomers(me(req).tenantId, String(req.query.q ?? ''), { segment: req.query.segment ? String(req.query.segment) : undefined, limit: intOpt(req.query.limit) })));
peopleRouter.get('/customers/receivables', requirePerm('customers.credit'), h((req) => receivables(me(req).tenantId)));
peopleRouter.post('/customers', requirePerm('customers'), h((req) => {
  const u = me(req);
  return saveCustomer(u, parse(customerSchema, req.body), undefined, hasPerm(u, 'customers.credit'));
}));
peopleRouter.get('/customers/:id', requirePerm('customers'), h((req) => getCustomer(me(req), id(req.params.id))));
peopleRouter.put('/customers/:id', requirePerm('customers'), h((req) => {
  const u = me(req);
  return saveCustomer(u, parse(customerSchema, req.body), id(req.params.id), hasPerm(u, 'customers.credit'));
}));
peopleRouter.post('/customers/:id/payment', requirePerm('customers.credit', 'pos'), h((req) => {
  const b = parse(z.object({ storeId: z.number().int(), amount: z.number().int().positive(), method: z.enum(['cash', 'card', 'transfer']), note: z.string().max(200).optional() }), req.body);
  return collectPayment(me(req), id(req.params.id), b);
}));
peopleRouter.post('/customers/:id/adjust', requirePerm('customers.credit'), h((req) => {
  const b = parse(z.object({ amount: z.number().int(), note: z.string().min(1).max(200) }), req.body);
  return adjustBalance(me(req), id(req.params.id), b.amount, b.note);
}));
peopleRouter.post('/customers/message', requirePerm('messages'), h((req) => {
  const b = parse(z.object({ channel: z.enum(['sms', 'whatsapp']), customerIds: z.array(z.number().int()).min(1), text: z.string().min(1).max(1000) }), req.body);
  return bulkMessage(me(req), b);
}));
peopleRouter.get('/messages/channels', requirePerm('customers'), h((req) => availableChannels(me(req).tenantId)));

// ---------------------------------------------------------------- Müşteri siparişleri
peopleRouter.get('/customer-orders/meta', requirePerm('customer_orders'), h(() => ORDER_STATUS));
peopleRouter.get('/customer-orders', requirePerm('customer_orders'), h((req) => listCustomerOrders(me(req), { status: req.query.status ? String(req.query.status) : undefined, storeId: intOpt(req.query.storeId), q: req.query.q ? String(req.query.q) : undefined })));
peopleRouter.post('/customer-orders', requirePerm('customer_orders'), h((req) => {
  const b = parse(
    z.object({
      storeId: z.number().int(), customerId: z.number().int(), variantId: z.number().int().nullable().optional(), description: z.string().max(300).optional(),
      qty: z.number().int().min(1).optional(), price: z.number().int().min(0).optional(), deposit: z.number().int().min(0).optional(),
      depositMethod: z.enum(['cash', 'card', 'transfer']).optional(), dueDate: z.string().optional(), note: z.string().max(500).optional(),
    }),
    req.body,
  );
  return createCustomerOrder(me(req), b);
}));
peopleRouter.get('/customer-orders/:id', requirePerm('customer_orders'), h((req) => getCustomerOrder(me(req), id(req.params.id))));
peopleRouter.post('/customer-orders/:id/status', requirePerm('customer_orders'), h((req) => {
  const b = parse(z.object({ status: z.enum(['open', 'ordered', 'arrived', 'notified', 'cancelled']), notify: z.boolean().optional(), refundMethod: z.enum(['cash', 'card', 'transfer']).optional() }), req.body);
  return setCustomerOrderStatus(me(req), id(req.params.id), b.status, b);
}));

// ---------------------------------------------------------------- Tedarikçiler & satın alma
const supplierSchema = z.object({
  name: z.string().min(1).max(100), contact_name: z.string().max(80).optional(), phone: z.string().max(20).optional(), email: z.string().max(120).optional(),
  tax_no: z.string().max(11).optional(), tax_office: z.string().max(60).optional(), address: z.string().max(300).optional(), iban: z.string().max(34).optional(),
  payment_term_days: z.number().int().min(0).max(365).optional(), notes: z.string().max(1000).optional(), active: z.boolean().optional(),
});
peopleRouter.get('/suppliers', requirePerm('suppliers', 'purchases', 'products.edit'), h((req) => listSuppliers(me(req).tenantId)));
peopleRouter.get('/suppliers/payables', requirePerm('suppliers'), h((req) => payables(me(req).tenantId)));
peopleRouter.post('/suppliers', requirePerm('suppliers'), h((req) => saveSupplier(me(req), parse(supplierSchema, req.body))));
peopleRouter.get('/suppliers/:id', requirePerm('suppliers'), h((req) => getSupplier(me(req), id(req.params.id))));
peopleRouter.put('/suppliers/:id', requirePerm('suppliers'), h((req) => saveSupplier(me(req), parse(supplierSchema, req.body), id(req.params.id))));
peopleRouter.post('/suppliers/:id/entry', requirePerm('suppliers'), h((req) => {
  const b = parse(
    z.object({ type: z.enum(['invoice', 'payment', 'return', 'adjust']), amount: z.number().int(), method: z.enum(['cash', 'card', 'transfer', 'check']).optional(), storeId: z.number().int().optional(), dueDate: z.string().optional(), docNo: z.string().max(40).optional(), note: z.string().max(300).optional() }),
    req.body,
  );
  return supplierEntry(me(req), id(req.params.id), b);
}));

const poItems = z.array(z.object({ variantId: z.number().int(), qty: z.number().int().min(0), unitCost: z.number().int().min(0).optional() })).min(1);
peopleRouter.get('/purchase-orders', requirePerm('purchases'), h((req) => listPOs(me(req), { status: req.query.status ? String(req.query.status) : undefined, supplierId: intOpt(req.query.supplierId) })));
peopleRouter.post('/purchase-orders', requirePerm('purchases'), h((req) => savePO(me(req), parse(z.object({ supplierId: z.number().int(), storeId: z.number().int(), expectedDate: z.string().optional(), note: z.string().max(500).optional(), items: poItems, status: z.enum(['draft', 'ordered']).optional() }), req.body))));
peopleRouter.post('/purchase-orders/quick-receive', requirePerm('purchases'), h((req) => quickReceive(me(req), parse(z.object({ supplierId: z.number().int(), storeId: z.number().int(), invoiceNo: z.string().max(40).optional(), items: poItems, addToLedger: z.boolean().optional() }), req.body))));
peopleRouter.get('/purchase-orders/:id', requirePerm('purchases'), h((req) => getPO(me(req), id(req.params.id))));
peopleRouter.put('/purchase-orders/:id', requirePerm('purchases'), h((req) => savePO(me(req), parse(z.object({ supplierId: z.number().int(), storeId: z.number().int(), expectedDate: z.string().optional(), note: z.string().max(500).optional(), items: poItems, status: z.enum(['draft', 'ordered']).optional() }), req.body), id(req.params.id))));
peopleRouter.post('/purchase-orders/:id/status', requirePerm('purchases'), h((req) => setPOStatus(me(req), id(req.params.id), parse(z.object({ status: z.enum(['ordered', 'cancelled']) }), req.body).status)));
peopleRouter.post('/purchase-orders/:id/receive', requirePerm('purchases'), h((req) => receivePO(me(req), id(req.params.id), parse(z.object({ items: poItems, invoiceNo: z.string().max(40).optional(), addToLedger: z.boolean().optional(), dueDate: z.string().optional() }), req.body))));

// ---------------------------------------------------------------- Personel
peopleRouter.get('/users', requirePerm('staff', 'settings'), h((req) => listUsers(me(req).tenantId)));
const userSchema = z.object({
  username: z.string().min(3).max(32), name: z.string().min(1).max(80), phone: z.string().max(20).optional(), role: z.enum(['owner', 'manager', 'cashier', 'warehouse']),
  password: z.string().max(100).optional(), commission_rate: z.number().int().min(0).optional(), all_stores: z.boolean().optional(), store_ids: z.array(z.number().int()).optional(), active: z.boolean().optional(),
});
function guardRole(req: Parameters<typeof me>[0], role: string) {
  const u = me(req);
  if (role === 'owner' && u.role !== 'owner') throw forbidden('Patron rolünü sadece patron verebilir');
}
peopleRouter.post('/users', requirePerm('settings', 'staff'), h((req) => {
  const b = parse(userSchema, req.body);
  guardRole(req, b.role);
  return saveUser(me(req), b);
}));
peopleRouter.put('/users/:id', requirePerm('settings', 'staff'), h((req) => {
  const b = parse(userSchema, req.body);
  guardRole(req, b.role);
  return saveUser(me(req), b, id(req.params.id));
}));
peopleRouter.get('/shifts/me', h((req) => myShift(me(req))));
peopleRouter.post('/shifts/in', h((req) => clockIn(me(req), parse(z.object({ storeId: z.number().int() }), req.body).storeId)));
peopleRouter.post('/shifts/out', h((req) => clockOut(me(req))));
peopleRouter.get('/shifts', requirePerm('staff'), h((req) => {
  const r = range(req.query.from, req.query.to);
  return listShifts(me(req), r.from, r.toExclusive, intOpt(req.query.userId));
}));
peopleRouter.get('/targets', requirePerm('staff', 'reports'), h((req) => listTargets(me(req), String(req.query.month ?? new Date().toISOString().slice(0, 7)))));
peopleRouter.post('/targets', requirePerm('staff'), h((req) => setTarget(me(req), parse(z.object({ month: z.string(), storeId: z.number().int().nullable().optional(), userId: z.number().int().nullable().optional(), amount: z.number().int().min(0) }), req.body))));

// ---------------------------------------------------------------- Görevler
peopleRouter.get('/tasks', requirePerm('tasks'), h((req) => listTasks(me(req), req.query.done === '1')));
const taskSchema = z.object({ title: z.string().min(1).max(200), detail: z.string().max(2000).optional(), storeId: z.number().int().nullable().optional(), assignedTo: z.number().int().nullable().optional(), dueDate: z.string().nullable().optional() });
peopleRouter.post('/tasks', requirePerm('tasks'), h((req) => saveTask(me(req), parse(taskSchema, req.body))));
peopleRouter.put('/tasks/:id', requirePerm('tasks'), h((req) => saveTask(me(req), parse(taskSchema, req.body), id(req.params.id))));
peopleRouter.post('/tasks/:id/done', requirePerm('tasks'), h((req) => toggleTask(me(req), id(req.params.id), req.body?.done !== false)));
peopleRouter.delete('/tasks/:id', requirePerm('tasks'), h((req) => deleteTask(me(req), id(req.params.id))));

