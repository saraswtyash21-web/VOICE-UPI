import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getPaymentProvider } from './provider.js';

const recipientSchema = z.object({
  name: z.string().trim().min(2).max(80),
  upiId: z.string().trim().min(3).max(100).regex(/^[\w.-]+@[\w.-]+$/, 'Enter a valid UPI ID'),
  relation: z.string().trim().max(60).optional().default(''),
});
const intentSchema = z.object({
  recipientId: z.string().uuid().or(z.string().min(1).max(100)).optional(),
  recipientName: z.string().trim().min(2).max(80).optional(),
  upiId: z.string().trim().min(3).max(100).regex(/^[\w.-]+@[\w.-]+$/),
  amountRupees: z.number().finite().min(1).max(100000).refine(n => Number.isInteger(n * 100), 'Amount supports up to two decimal places'),
  note: z.string().trim().max(120).optional().default(''),
}).refine(v => v.recipientId || v.recipientName, { message: 'Recipient is required' });

const error = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const asRecipient = r => ({ id: r.id, name: r.name, upiId: r.upi_id, relation: r.relation });
const asTransaction = r => ({ id: r.id, recipientName: r.recipient_name, upiId: r.upi_id, amountRupees: r.amount_paise / 100, note: r.note, status: r.status, reference: r.reference, createdAt: r.created_at, simulated: true });

export function createApp(db, { provider = getPaymentProvider() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', provider: 'simulated' }));
  app.get('/api/recipients', (_req, res) => {
    res.json({ recipients: db.prepare('SELECT * FROM recipients ORDER BY name COLLATE NOCASE').all().map(asRecipient) });
  });
  app.post('/api/recipients', (req, res) => {
    const parsed = recipientSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO recipients (id,name,upi_id,relation,created_at) VALUES (?,?,?,?,?)')
        .run(id, parsed.data.name, parsed.data.upiId, parsed.data.relation, new Date().toISOString());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return error(res, 409, 'RECIPIENT_EXISTS', 'That UPI ID is already saved.');
      throw e;
    }
    return res.status(201).json({ recipient: asRecipient(db.prepare('SELECT * FROM recipients WHERE id=?').get(id)) });
  });
  app.patch('/api/recipients/:id', (req, res) => {
    const parsed = recipientSchema.partial().safeParse(req.body);
    if (!parsed.success || !Object.keys(req.body ?? {}).length) return error(res, 400, 'VALIDATION_ERROR', parsed.success ? 'Provide a field to update.' : parsed.error.issues[0].message);
    const current = db.prepare('SELECT * FROM recipients WHERE id=?').get(req.params.id);
    if (!current) return error(res, 404, 'NOT_FOUND', 'Recipient not found.');
    const data = { name: parsed.data.name ?? current.name, upiId: parsed.data.upiId ?? current.upi_id, relation: parsed.data.relation ?? current.relation };
    try { db.prepare('UPDATE recipients SET name=?,upi_id=?,relation=? WHERE id=?').run(data.name, data.upiId, data.relation, req.params.id); }
    catch (e) { if (String(e.message).includes('UNIQUE')) return error(res, 409, 'RECIPIENT_EXISTS', 'That UPI ID is already saved.'); throw e; }
    return res.json({ recipient: asRecipient(db.prepare('SELECT * FROM recipients WHERE id=?').get(req.params.id)) });
  });
  app.delete('/api/recipients/:id', (req, res) => {
    const result = db.prepare('DELETE FROM recipients WHERE id=?').run(req.params.id);
    if (!result.changes) return error(res, 404, 'NOT_FOUND', 'Recipient not found.');
    return res.status(204).end();
  });
  app.post('/api/payment-intents', (req, res) => {
    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
    let name = parsed.data.recipientName;
    let upiId = parsed.data.upiId;
    let recipientId = parsed.data.recipientId ?? null;
    if (recipientId) {
      const recipient = db.prepare('SELECT * FROM recipients WHERE id=?').get(recipientId);
      if (!recipient) return error(res, 404, 'RECIPIENT_NOT_FOUND', 'Choose a saved recipient or enter their details again.');
      name = recipient.name;
      upiId = recipient.upi_id;
    }
    const id = randomUUID();
    const reference = `VG-${randomBytes(5).toString('hex').toUpperCase()}`;
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO transactions (id,recipient_id,recipient_name,upi_id,amount_paise,note,status,reference,created_at)
      VALUES (?,?,?,?,?,?, 'pending',?,?)`).run(id, recipientId, name, upiId, Math.round(parsed.data.amountRupees * 100), parsed.data.note, reference, createdAt);
    const row = db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
    return res.status(201).json({ transaction: asTransaction(row), requiresExplicitConfirmation: true });
  });
  app.post('/api/transactions/:id/confirm', async (req, res, next) => {
    if (req.body?.confirmed !== true) return error(res, 400, 'CONFIRMATION_REQUIRED', 'Review the payment and confirm it explicitly.');
    const tx = db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id);
    if (!tx) return error(res, 404, 'NOT_FOUND', 'Payment was not found.');
    if (tx.status !== 'pending') return error(res, 409, 'ALREADY_FINAL', 'This payment is already complete or cancelled.');
    try {
      const result = await provider.confirm({ amountPaise: tx.amount_paise, reference: tx.reference });
      db.prepare('UPDATE transactions SET status=? WHERE id=? AND status=\'pending\'').run(result.status, tx.id);
      const updated = db.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id);
      return res.json({ transaction: asTransaction(updated), simulated: true });
    } catch (e) { return next(e); }
  });
  app.post('/api/transactions/:id/cancel', (req, res) => {
    const tx = db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id);
    if (!tx) return error(res, 404, 'NOT_FOUND', 'Payment was not found.');
    if (tx.status !== 'pending') return error(res, 409, 'ALREADY_FINAL', 'Only a pending payment can be cancelled.');
    db.prepare('UPDATE transactions SET status=\'cancelled\' WHERE id=?').run(tx.id);
    return res.json({ transaction: asTransaction(db.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id)) });
  });
  app.get('/api/transactions', (req, res) => {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 30, 100);
    res.json({ transactions: db.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?').all(limit).map(asTransaction) });
  });
  app.get('/api/transactions/:id', (req, res) => {
    const tx = db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id);
    return tx ? res.json({ transaction: asTransaction(tx) }) : error(res, 404, 'NOT_FOUND', 'Payment was not found.');
  });
  const builtClient = resolve(process.cwd(), 'dist');
  if (existsSync(resolve(builtClient, 'index.html'))) {
    app.use(express.static(builtClient, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(resolve(builtClient, 'index.html')));
  }
  app.use((err, _req, res, _next) => {
    // Do not log request bodies or provider details that might contain sensitive information.
    console.error('Request failed:', err?.name || 'Error');
    return error(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  });
  return app;
}
