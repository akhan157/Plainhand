/** Opt-in live end-to-end check of the 1.0 flow on a real, signed-in CLI:
 * profile (resume, stories, writing sample) → standard application → approve →
 * evaluate a pasted posting → prepare from the standard → revise by request.
 * Fictional candidate and employer; the posting is not opened in a browser and
 * nothing is filled or submitted. Real PDFs are rendered.
 *
 *   node test-plainhand-e2e-live.mjs --provider claude
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { emptyProfile } from './plainhand/store.mjs';
import { personas } from './plainhand/benchmarks/profile-bench.mjs';

if (!process.argv.includes('--provider')) { console.log('Opt-in live test: node test-plainhand-e2e-live.mjs --provider <claude|codex|antigravity>'); process.exit(0); }
const provider = process.argv[process.argv.indexOf('--provider') + 1];
const persona = personas.find(p => p.id === 'mech-grad');
const POSTING = 'SYNTHETIC TEST JOB, NOT A REAL EMPLOYER. Junior Mechanical Design Engineer at Fictional Robotics Co, Boston. Design and test mechanical assemblies for mobile robots. SolidWorks CAD, basic FEA, prototyping and test planning. Work with technicians to build and test prototypes. GD&T for production parts is a plus. New graduates welcome.';
const root = await mkdtemp(path.join(tmpdir(), 'plainhand-e2e-live-'));
const app = await createPlainhand({ root, workflowOptions: { verifier: async job => ({ state: 'active', legitimacy: 'synthetic-test', description: job.description, checkedAt: new Date().toISOString(), reason: 'Synthetic posting; not opened.' }) } });
const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
const settle = async () => { for (let i = 0; i < 6; i++) await app.workflow.queue; };
const proof = { date: new Date().toISOString(), provider, steps: [] };
const step = async (name, fn) => {
  const started = Date.now();
  try { const detail = await fn(); proof.steps.push({ name, ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, ...detail }); console.log(`✓ ${name} (${Math.round((Date.now() - started) / 1000)}s)${detail ? ' ' + JSON.stringify(detail) : ''}`); }
  catch (error) { proof.steps.push({ name, ok: false, error: error.message }); console.log(`✗ ${name}: ${error.message}`); throw error; }
};
const lastTask = async () => (await app.workspace.load()).tasks[0];
const runTask = async (name, input) => { await ui(name, input); await settle(); const t = await lastTask(); assert.equal(t.status, 'complete', `${t.kind}: ${t.message}`); return t; };
try {
  await step('profile', async () => {
    const state = await app.workspace.load();
    await app.workspace.saveProfile({ ...emptyProfile(), ...persona.profile, email: 'riley@example.invalid' }, state.revision);
    await app.workspace.mutate(s => { s.provider = provider; });
    for (const fact of persona.facts.slice(0, 5)) await ui('profile.addStory', { text: fact.text });
    await ui('profile.addWritingSample', { title: 'Team update', text: persona.facts.find(f => f.id === 'voice').detail + ' Quick update: the upright passed the load test this morning; numbers tonight.' });
  });
  await step('understanding', async () => { await runTask('tasks.interview', {}); await ui('understanding.approve', {}); });
  await step('standard application', async () => {
    await runTask('tasks.standard', {});
    const s = (await app.workspace.load()).standard;
    assert.match(s.draft.coverLetter, /\{company\}|\{role\}/, 'the standard letter keeps its slots');
    await ui('standard.approve', {});
    return { entries: s.draft.resume.length, band: s.calibration.band, counts: s.calibration.counts };
  });
  let jobId;
  await step('evaluate', async () => {
    jobId = (await ui('jobs.add', { company: 'Fictional Robotics Co', title: 'Junior Mechanical Design Engineer', url: 'https://jobs.lever.co/fictional-robotics/e2e-live', description: POSTING })).result.id;
    await runTask('tasks.evaluate', { jobId });
    const job = (await app.workspace.load()).jobs.find(j => j.id === jobId);
    return { score: job.evaluation.score, recommendation: job.evaluation.recommendation };
  });
  await step('prepare from the standard', async () => {
    const job = (await app.workspace.load()).jobs.find(j => j.id === jobId);
    if (job.evaluation.score < 4) await ui('jobs.setContext', { jobId, overrideReason: 'Live end-to-end check of preparation.' });
    await ui('jobs.select', { jobId, selected: true });
    await runTask('tasks.prepare', { jobId });
    const after = (await app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.ok(after.pdf && after.packet && after.calibration);
    assert.ok(!/\{company\}|\{role\}/.test(after.packet.coverLetter), 'slots filled for this employer');
    return { fromStandard: after.fromStandard, band: after.calibration.band, counts: after.calibration.counts, letterWords: after.packet.coverLetter.split(/\s+/).length, generic: after.calibration.letterGeneric, humanizer: { changed: after.humanizer.changed, kept: after.humanizer.kept, tellsBefore: after.humanizer.tellsBefore, tellsAfter: after.humanizer.tellsAfter } };
  });
  await step('revise by request', async () => {
    const before = (await app.workspace.load()).jobs.find(j => j.id === jobId).packet;
    await runTask('tasks.revise', { jobId, request: 'Keep the cover letter under 120 words.' });
    const after = (await app.workspace.load()).jobs.find(j => j.id === jobId);
    const words = after.packet.coverLetter.split(/\s+/).length;
    assert.ok(words <= 140, `cover letter now ${words} words`);
    assert.equal(after.approvedHash, null);
    return { before: before.coverLetter.split(/\s+/).length, after: words, resumeUnchanged: JSON.stringify(before.resume.map(e => e.text)) === JSON.stringify(after.packet.resume.map(e => e.text)) };
  });
  const usage = await app.workflow.usage.summary(await app.workspace.load());
  proof.usage = { calls: usage.totals.calls, inputTokens: usage.totals.inputTokens.value, outputTokens: usage.totals.outputTokens.value };
  proof.result = 'passed';
  console.log(`\nLive end-to-end check passed · ${proof.usage.calls} calls`);
} catch (error) {
  proof.result = 'failed'; proof.error = error.message; process.exitCode = 1;
} finally {
  const directory = path.join('output', `e2e-live-${provider}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log('Evidence: ' + directory);
  await app.close();
}
