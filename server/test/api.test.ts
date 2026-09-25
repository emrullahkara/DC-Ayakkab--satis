import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { fixture } from './setup.js';
import { createApp } from '../src/app.js';
import { run } from '../src/db/index.js';
import { hashPassword } from '../src/auth.js';

let app: ReturnType<typeof createApp>;
let token = '';
beforeAll(async () => {
  const f = fixture();
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword('sifre123'), f.owner.id);
  app = createApp();
  const r = await request(app).post('/api/auth/login').send({ tenant: 't1', username: 'patron', password: 'sifre123' });
  expect(r.status).toBe(200);
  token = r.body.token;
});

describe('HTTP API', () => {
  it('yetkisiz istek 401 döner', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
  });
  it('hatalı giriş 401, panel 200', async () => {
    expect((await request(app).post('/api/auth/login').send({ tenant: 't1', username: 'patron', password: 'yanlis' })).status).toBe(401);
    const r = await request(app).get('/api/dashboard').set('Authorization', 'Bearer ' + token);
    expect(r.status).toBe(200);
    expect(r.body.registers).toHaveLength(2);
  });
  it('doğrulama hataları 400 ve Türkçe mesaj', async () => {
    const r = await request(app).post('/api/pos/sale').set('Authorization', 'Bearer ' + token).send({ storeId: 'abc' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Geçersiz veri/);
  });
  it('tam akış: kasa aç → barkod → satış → fiş', async () => {
    const auth = (r: request.Test) => r.set('Authorization', 'Bearer ' + token);
    const stores = (await auth(request(app).get('/api/stores'))).body;
    const sid = stores[0].id;
    expect((await auth(request(app).post(`/api/register/${sid}/open`)).send({ openingCash: 0 })).status).toBe(200);
    const stock = (await auth(request(app).get('/api/stock'))).body;
    const v = stock[0];
    const bc = (await auth(request(app).get('/api/pos/barcode/' + v.barcode))).body;
    expect(bc.id).toBe(v.id);
    const sale = await auth(request(app).post('/api/pos/sale')).send({ storeId: sid, items: [{ variantId: v.id, qty: 1 }], payments: [{ method: 'cash', amount: bc.price }] });
    expect(sale.status).toBe(200);
    const print = await auth(request(app).get(`/api/receipts/${sale.body.id}/print`));
    expect(print.body.sale.receipt_no).toBe(sale.body.receipt_no);
    const list = await auth(request(app).get('/api/sales'));
    expect(list.body.totals.n).toBe(1);
    const rep = await auth(request(app).get('/api/reports/summary'));
    expect(rep.body.revenue).toBe(bc.price);
  });
});
