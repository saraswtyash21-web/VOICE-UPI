import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { SimulatedPaymentProvider } from '../server/provider.js';

const dir = mkdtempSync(join(tmpdir(), 'voiceguide-test-'));
const db = openDatabase(join(dir, 'test.sqlite'));
const server = createServer(createApp(db, { provider: new SimulatedPaymentProvider() }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
after(() => { server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

test('lists seeded demo recipients', async () => {
  const result = await call('/recipients');
  assert.equal(result.status, 200);
  assert.equal(result.data.recipients.length, 3);
});

test('rejects an invalid UPI ID and invalid amount', async () => {
  const recipient = (await call('/recipients')).data.recipients[0];
  const invalidUpi = await call('/payment-intents', { method: 'POST', body: JSON.stringify({ recipientId: recipient.id, upiId: 'bad', amountRupees: 50 }) });
  assert.equal(invalidUpi.status, 400);
  const invalidAmount = await call('/payment-intents', { method: 'POST', body: JSON.stringify({ recipientId: recipient.id, upiId: recipient.upiId, amountRupees: -2 }) });
  assert.equal(invalidAmount.status, 400);
});

test('payment intent stays pending until explicit confirmation', async () => {
  const recipient = (await call('/recipients')).data.recipients[0];
  const created = await call('/payment-intents', { method: 'POST', body: JSON.stringify({ recipientId: recipient.id, upiId: recipient.upiId, amountRupees: 125, note: 'Test' }) });
  assert.equal(created.status, 201);
  assert.equal(created.data.transaction.status, 'pending');
  assert.equal(created.data.requiresExplicitConfirmation, true);
  const refused = await call(`/transactions/${created.data.transaction.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmed: false }) });
  assert.equal(refused.status, 400);
  assert.equal((await call(`/transactions/${created.data.transaction.id}`)).data.transaction.status, 'pending');
  const confirmed = await call(`/transactions/${created.data.transaction.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.transaction.status, 'success');
  assert.equal(confirmed.data.simulated, true);
  assert.match(confirmed.data.transaction.reference, /^VG-/);
});

test('cancelled payment cannot be confirmed later', async () => {
  const recipient = (await call('/recipients')).data.recipients[0];
  const created = await call('/payment-intents', { method: 'POST', body: JSON.stringify({ recipientId: recipient.id, upiId: recipient.upiId, amountRupees: 10 }) });
  const cancelled = await call(`/transactions/${created.data.transaction.id}/cancel`, { method: 'POST', body: '{}' });
  assert.equal(cancelled.data.transaction.status, 'cancelled');
  const confirmation = await call(`/transactions/${created.data.transaction.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
  assert.equal(confirmation.status, 409);
});
