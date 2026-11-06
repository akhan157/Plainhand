// Accounts and sessions against a real Postgres (see tests/cloud-test-db.mjs):
//   PLAINHAND_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54331/postgres node --test tests/test-cloud-accounts.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAccounts, createSessions, hashToken } from '../plainhand/cloud/accounts.mjs';
import { freshDatabase, skip } from './cloud-test-db.mjs';

const db = freshDatabase();

test('upsert creates the account once and keeps the latest email', { skip }, async () => {
  const accounts = createAccounts({ sql: db.sql }), id = randomUUID();
  const first = await accounts.upsert({ userId: id, email: 'Ana@Example.com' });
  assert.equal(first.email, 'ana@example.com');
  await accounts.upsert({ userId: id, email: 'ana2@example.com' });
  assert.equal((await accounts.get(id)).email, 'ana2@example.com');
  assert.equal(await accounts.get(randomUUID()), null);
  assert.equal(await accounts.get('not-a-uuid'), null);
  await assert.rejects(accounts.upsert({ userId: id, email: 'nope' }), /email/);
  await assert.rejects(accounts.upsert({ userId: "x' or 1=1", email: 'a@b.co' }), /Invalid account/);
});

test('a session resolves by its cookie, stores only a hash, and ends on destroy', { skip }, async () => {
  const accounts = createAccounts({ sql: db.sql }), sessions = createSessions({ sql: db.sql }), id = randomUUID();
  await accounts.upsert({ userId: id, email: 's@example.com' });
  const cookie = await sessions.create(id);
  assert.match(cookie, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await sessions.resolve(cookie), { userId: id });
  const rows = await db.sql`select id_hash, expires_at from plainhand.sessions where user_id = ${id}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id_hash, hashToken(cookie));
  assert.notEqual(rows[0].id_hash, cookie);
  const days = (rows[0].expires_at - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `expires in ${days} days`);
  assert.equal(await sessions.resolve(cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A')), null);
  for (const bad of [undefined, '', 'short', 'x'.repeat(43) + "'", null]) assert.equal(await sessions.resolve(bad), null);
  await sessions.destroy(cookie);
  assert.equal(await sessions.resolve(cookie), null);
});

test('a session expires after 30 days', { skip }, async () => {
  let clock = new Date('2026-01-01T00:00:00Z');
  const accounts = createAccounts({ sql: db.sql }), sessions = createSessions({ sql: db.sql, now: () => clock }), id = randomUUID();
  await accounts.upsert({ userId: id, email: 'e@example.com' });
  const cookie = await sessions.create(id);
  clock = new Date('2026-01-30T23:59:00Z');
  assert.deepEqual(await sessions.resolve(cookie), { userId: id });
  clock = new Date('2026-01-31T00:00:01Z');
  assert.equal(await sessions.resolve(cookie), null);
  assert.ok(await sessions.purgeExpired() >= 1);
  assert.equal((await db.sql`select count(*)::int as n from plainhand.sessions where user_id = ${id}`)[0].n, 0);
});

test('destroyAll ends every session of one account only', { skip }, async () => {
  const accounts = createAccounts({ sql: db.sql }), sessions = createSessions({ sql: db.sql }), a = randomUUID(), b = randomUUID();
  await accounts.upsert({ userId: a, email: 'a@example.com' }); await accounts.upsert({ userId: b, email: 'b@example.com' });
  const a1 = await sessions.create(a), a2 = await sessions.create(a), b1 = await sessions.create(b);
  await sessions.destroyAll(a);
  assert.equal(await sessions.resolve(a1), null);
  assert.equal(await sessions.resolve(a2), null);
  assert.deepEqual(await sessions.resolve(b1), { userId: b });
});

test('workspaceFor stores files per account; remove deletes everything the account owns', { skip }, async () => {
  const accounts = createAccounts({ sql: db.sql }), sessions = createSessions({ sql: db.sql }), a = randomUUID(), b = randomUUID();
  await accounts.upsert({ userId: a, email: 'a2@example.com' }); await accounts.upsert({ userId: b, email: 'b2@example.com' });
  const wa = accounts.workspaceFor(a), wb = accounts.workspaceFor(b);
  assert.equal(wa.local, false);
  await wa.mutate(state => { state.marker = 'a'; });
  await wa.write('cv.md', 'resume a');
  assert.equal((await wa.load()).marker, 'a');
  assert.equal((await wb.load()).marker, undefined);
  assert.equal(await wb.read('cv.md'), '');
  const cookie = await sessions.create(a);
  assert.equal(await accounts.remove(a), true);
  assert.equal(await accounts.get(a), null);
  assert.equal(await sessions.resolve(cookie), null);
  for (const table of ['workspace_files', 'sessions']) {
    const [{ n }] = await db.sql`select count(*)::int as n from ${db.sql('plainhand.' + table)} where user_id = ${a}`;
    assert.equal(n, 0, table);
  }
  assert.equal(await wb.read('cv.md'), '');
  assert.equal(await accounts.remove(a), false);
  assert.throws(() => accounts.workspaceFor('../etc'), /Invalid account/);
});
