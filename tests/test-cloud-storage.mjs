// Runs against a real Postgres when PLAINHAND_TEST_DATABASE_URL is set, e.g.
//   docker run -d --rm --name plainhand-pg -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:17
//   PLAINHAND_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54329/postgres node --test tests/test-cloud-storage.mjs
// Each run uses a fresh database so it never touches real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { connect, PostgresStorage, QuotaError } from '../plainhand/cloud/postgres-storage.mjs';
import { Workspace } from '../plainhand/store.mjs';

const URL_BASE = process.env.PLAINHAND_TEST_DATABASE_URL;
const skip = URL_BASE ? false : 'set PLAINHAND_TEST_DATABASE_URL to run';

let admin, sql, dbName;
test.before(async () => {
  if (skip) return;
  admin = connect(URL_BASE, { max: 1 });
  dbName = 'plainhand_test_' + randomUUID().replace(/-/g, '').slice(0, 12);
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(URL_BASE); url.pathname = '/' + dbName;
  sql = connect(url.toString(), { max: 6 });
  const schema = await readFile(new URL('../plainhand/cloud/schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(schema);
  await sql.unsafe(schema); // idempotent
});
test.after(async () => {
  if (skip) return;
  await sql?.end();
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

async function account() {
  const id = randomUUID();
  await sql`insert into plainhand.accounts (user_id, email) values (${id}, ${id + '@example.com'})`;
  return id;
}

test('reads, writes, lists and removes one candidate\'s files', { skip }, async () => {
  const store = new PostgresStorage(sql, await account());
  assert.equal(await store.read('cv.md'), null);
  await store.write('output/a.pdf', Buffer.from([0, 1, 255]));
  await store.write('output/b.md', Buffer.from('b'));
  await store.write('output/deep/c.md', Buffer.from('c'));
  await store.write('output/b.md', Buffer.from('bb')); // overwrite
  assert.deepEqual([...await store.read('output/a.pdf')], [0, 1, 255]);
  assert.equal((await store.read('output/b.md')).toString(), 'bb');
  assert.deepEqual(await store.list('output'), ['a.pdf', 'b.md']);
  assert.deepEqual(await store.list('out'), []);
  await store.remove('output/b.md');
  assert.equal(await store.read('output/b.md'), null);
  assert.deepEqual(await store.usage(), { bytes: 4, files: 2, quotaBytes: store.quotaBytes });
  await assert.rejects(store.write('../x', Buffer.from('x')), /outside/);
});

test('candidates never see each other\'s files, including through LIKE wildcards', { skip }, async () => {
  const a = new PostgresStorage(sql, await account()), b = new PostgresStorage(sql, await account());
  await a.write('data/secret.md', Buffer.from('a'));
  await a.write('d%/x.md', Buffer.from('a'));
  assert.equal(await b.read('data/secret.md'), null);
  assert.deepEqual(await b.list('data'), []);
  assert.deepEqual(await a.list('d_'), []); // _ and % are literal
  assert.deepEqual(await a.list('d%'), ['x.md']);
  assert.throws(() => new PostgresStorage(sql, "x' or 1=1"), /Invalid account/);
});

test('the per-candidate quota counts the file being replaced only once', { skip }, async () => {
  const store = new PostgresStorage(sql, await account(), { quotaBytes: 10 });
  await store.write('a', Buffer.alloc(6));
  await store.write('a', Buffer.alloc(9)); // replaces, total 9
  await assert.rejects(store.write('b', Buffer.alloc(2)), QuotaError);
  assert.equal((await store.read('a')).length, 9);
});

test('concurrent mutations from separate server instances never lose an update', { skip }, async () => {
  const id = await account();
  const instance = () => new Workspace('cloud:' + id, { storage: new PostgresStorage(sql, id) });
  await instance().mutate(state => { state.counter = 0; });
  // Twenty mutations spread over four independent Workspace objects (as on four
  // serverless instances): without the advisory lock most increments are lost.
  const workspaces = [instance(), instance(), instance(), instance()];
  await Promise.all(Array.from({ length: 20 }, (_, i) => workspaces[i % 4].mutate(async state => {
    const seen = state.counter; await new Promise(r => setTimeout(r, 5)); state.counter = seen + 1;
  })));
  const state = await instance().load();
  assert.equal(state.counter, 20);
  assert.equal(state.revision, 21);
});

test('a failed mutation rolls back every write it made', { skip }, async () => {
  const id = await account(), store = new PostgresStorage(sql, id), workspace = new Workspace('cloud:' + id, { storage: store });
  await workspace.mutate(state => { state.mark = 'before'; });
  await assert.rejects(workspace.mutate(async state => {
    state.mark = 'after';
    await workspace.write('side-effect.md', 'should not persist');
    throw new Error('boom');
  }), /boom/);
  assert.equal((await workspace.load()).mark, 'before');
  assert.equal(await store.read('side-effect.md'), null);
});

test('deleting an account removes every file it owns', { skip }, async () => {
  const id = await account(), store = new PostgresStorage(sql, id);
  await store.write('cv.md', Buffer.from('x'));
  await sql`delete from plainhand.accounts where user_id = ${id}`;
  const [{ n }] = await sql`select count(*)::int as n from plainhand.workspace_files where user_id = ${id}`;
  assert.equal(n, 0);
});
