// Shared by the tests/test-cloud-*.mjs suites: a fresh database per run when
// PLAINHAND_TEST_DATABASE_URL is set, dropped afterwards. Never touches real data.
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { connect } from '../plainhand/cloud/postgres-storage.mjs';

export const URL_BASE = process.env.PLAINHAND_TEST_DATABASE_URL;
export const skip = URL_BASE ? false : 'set PLAINHAND_TEST_DATABASE_URL to run';

export function freshDatabase() {
  const db = { sql: null };
  let admin, name, resolveReady;
  // Other before() hooks await db.ready: node:test does not wait for one hook before the next.
  db.ready = new Promise(resolve => { resolveReady = resolve; });
  test.before(async () => {
    if (skip) return resolveReady();
    admin = connect(URL_BASE, { max: 1 });
    name = 'plainhand_test_' + randomUUID().replace(/-/g, '').slice(0, 12);
    await admin.unsafe(`create database ${name}`);
    const url = new URL(URL_BASE); url.pathname = '/' + name;
    db.sql = connect(url.toString(), { max: 6 });
    await db.sql.unsafe(await readFile(new URL('../plainhand/cloud/schema.sql', import.meta.url), 'utf8'));
    resolveReady();
  });
  test.after(async () => {
    if (skip) return;
    await db.sql?.end();
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.end();
  });
  return db;
}
