import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStorage, MemoryStorage, normalizePath } from '../plainhand/storage.mjs';
import { Workspace } from '../plainhand/store.mjs';
import { UsageLedger } from '../plainhand/usage.mjs';

test('normalizePath refuses anything that could leave the workspace', () => {
  assert.equal(normalizePath('data/plainhand/workspace.json'), 'data/plainhand/workspace.json');
  for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a\\b', 'C:/x', 'a/\0b', 'x'.repeat(513), null, 7]) {
    assert.throws(() => normalizePath(bad), /workspace/i, String(bad).slice(0, 20));
  }
});

async function withStores(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-storage-'));
  try {
    await fn(new FileStorage(root), 'file');
    await fn(new MemoryStorage(), 'memory');
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('file and memory stores behave the same', () => withStores(async (store, kind) => {
  assert.equal(await store.read('cv.md'), null, kind);
  await store.write('output/a.pdf', Buffer.from([0, 1, 2, 255]));
  await store.write('output/b.md', Buffer.from('hello'));
  await store.write('output/nested/c.md', Buffer.from('deep'));
  assert.deepEqual([...await store.read('output/a.pdf')], [0, 1, 2, 255], kind);
  assert.deepEqual(await store.list('output'), ['a.pdf', 'b.md'], kind);
  assert.deepEqual(await store.list('missing'), [], kind);
  await store.remove('output/b.md');
  assert.equal(await store.read('output/b.md'), null, kind);
  await store.remove('output/b.md'); // removing twice is fine
  await assert.rejects(store.write('../escape', Buffer.from('x')), /outside/i, kind);
}));

test('the file store refuses symbolic links inside the workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-storage-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'plainhand-outside-'));
  try {
    await mkdir(path.join(root, 'data'));
    await symlink(outside, path.join(root, 'data', 'link'));
    await assert.rejects(new FileStorage(root).write('data/link/x', Buffer.from('x')), /symbolic/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('a workspace runs entirely on a non-local store', async () => {
  const storage = new MemoryStorage({ 'cv.md': 'Jane Doe\nB.S. Mechanical Engineering' });
  const workspace = new Workspace('user:123', { storage });
  assert.equal(workspace.local, false);
  await assert.rejects(workspace.safe('cv.md'), /no local folder/);
  const state = await workspace.load();
  assert.match(state.profile.resume, /Jane Doe/);
  await workspace.saveProfile({ name: 'Jane Doe', email: 'jane@example.com', resume: 'Jane Doe resume' }, state.revision);
  const saved = await workspace.load();
  assert.equal(saved.revision, 1);
  assert.equal(saved.profile.name, 'Jane Doe');
  assert.match(await workspace.read('config/profile.yml'), /full_name: Jane Doe/);
  assert.equal(await workspace.read('cv.md'), 'Jane Doe resume\n');
  await workspace.write('output/x.pdf', Buffer.from([37, 80, 68, 70]));
  assert.equal((await workspace.readBinary('output/x.pdf')).toString(), '%PDF');
  // Usage receipts list through the store, not the filesystem.
  const ledger = new UsageLedger(workspace);
  await ledger.track(async () => ({ ok: true }), 'claude', 'x', {}, {});
  assert.equal((await ledger.records()).length, 1);
});

test('the local workspace keeps its folder behaviour', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-storage-'));
  try {
    const workspace = new Workspace(root);
    assert.equal(workspace.local, true);
    assert.equal(workspace.root, path.resolve(root));
    assert.equal(await workspace.safe('cv.md'), path.join(path.resolve(root), 'cv.md'));
    assert.equal(await workspace.read('cv.md', 'none'), 'none');
  } finally { await rm(root, { recursive: true, force: true }); }
});
