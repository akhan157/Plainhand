import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { profileStrength } from './plainhand/profile-strength.mjs';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-samples-'));
  const app = await createPlainhand({ root });
  return { app, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}
const SAMPLE = 'Hi team, quick update: the upright passed the load test this morning. I will send the numbers tonight.';

test('a writing sample becomes its own source, clears approvals, and counts as voice', async () => {
  const h = await harness();
  try {
    await h.app.workspace.mutate(state => { state.jobs = [{ id: 'j1', company: 'Co', title: 'Engineer', approvedHash: 'x' }]; state.understanding = { approved: true, result: {} }; });
    const before = await h.app.workspace.context(await h.app.workspace.load());
    const { result } = await h.app.registry.run('profile.addWritingSample', { title: 'Team email', text: SAMPLE }, { actor: 'ui' });
    const state = await h.app.workspace.load();
    const context = await h.app.workspace.context(state);
    assert.ok(context.sources.find(s => s.id === 'writing-samples').text.includes('## Team email'));
    assert.notEqual(context.hash, before.hash, 'the context fingerprint changes');
    assert.equal(state.jobs[0].approvedHash, null);
    assert.equal(state.understanding, null);
    assert.ok(!profileStrength(state).foundation.missing.includes('a sample of how you write'));
    await h.app.workspace.mutate(s => { s.contextPrefs = { excludedSources: ['writing-samples'] }; });
    assert.ok(!(await h.app.workspace.context(await h.app.workspace.load())).sources.some(s => s.id === 'writing-samples'), 'can be excluded like any source');
    await assert.rejects(h.app.registry.run('profile.removeWritingSample', { id: result.id }, { actor: 'agent' }), e => e.code === 'candidate_only');
    await h.app.registry.run('profile.removeWritingSample', { id: result.id }, { actor: 'ui' });
    assert.deepEqual((await h.app.workspace.load()).writingSamples, []);
  } finally { await h.close(); }
});

test('at most ten samples, each within the size limit', async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 10; i++) await h.app.registry.run('profile.addWritingSample', { text: `${SAMPLE} ${i}` }, { actor: 'ui' });
    await assert.rejects(h.app.registry.run('profile.addWritingSample', { text: SAMPLE }, { actor: 'ui' }), /up to 10/);
    await assert.rejects(h.app.registry.run('profile.removeWritingSample', { id: 'missing' }, { actor: 'ui' }), /not found/);
  } finally { await h.close(); }
});
