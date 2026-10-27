/** Opt-in live inference acceptance check. Uses a fictional candidate/employer;
 * real provider requests and Chromium PDFs/forms, no application submission.
 * Run: node test-plainhand-live.mjs --provider claude
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { providerById } from './plainhand/agents.mjs';
import { fixtureApplicationBrowser } from './plainhand/test-browser-fixture.mjs';
import { candidate } from './plainhand/test-fixtures.mjs';

if (!process.argv.includes('--provider')) {
  console.log('Opt-in live test: node test-plainhand-live.mjs --provider <codex|claude|antigravity>');
  process.exit(0);
}
const provider = providerById(process.argv[process.argv.indexOf('--provider') + 1]);
const resumeIndex = process.argv.indexOf('--resume-root');
const root = resumeIndex >= 0 ? path.resolve(process.argv[resumeIndex + 1]) : await mkdtemp(path.join(tmpdir(), 'plainhand-live-proof-'));
const proof = { date: new Date().toISOString(), provider: provider.id, candidate: 'fictional engineering graduate', employer: 'local synthetic ATS page', inference: 'real installed CLI', stages: [], automatedSubmissions: 0, success: false };
if (resumeIndex >= 0) {
  const previous = JSON.parse(await readFile(path.join(root, 'proof/result.json'), 'utf8'));
  proof.stages = previous.stages;
  proof.previousFindings = [...previous.previousFindings || [], ...previous.error ? [previous.error] : []];
}
const ats = fixtureApplicationBrowser();
const description = `SYNTHETIC TEST JOB, NOT A REAL EMPLOYER. Test Company seeks a Graduate Mechanical Engineer in Boston. This entry-level role is for a B.S. Mechanical Engineering student graduating in 2027. You will design lightweight chassis components, run physical tests, and explain design tradeoffs. Formula SAE project experience and personal ownership of design/testing are directly relevant. No prior paid industry experience, sponsorship statement, salary answer, additional credentials, or numerical achievements are required for this test. The only form questions are contact details, resume, a project example, and a work-authorization choice that must be left to the candidate. Do not add arbitrary eligibility or experience requirements.`;
const app = await createPlainhand({ root, browser: ats.application, workflowOptions: {
  verifier: async () => ({ state: 'active', legitimacy: 'synthetic-test-only', description, checkedAt: new Date().toISOString(), reason: 'Controlled synthetic browser fixture for live-inference testing; not a real posting.' }),
} });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
async function post(endpoint, data) {
  const response = await fetch(base + '/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Plainhand-Token': app.token }, body: JSON.stringify(data) });
  const result = await response.json();
  assert.ok(response.ok, `${endpoint}: ${result.error}`);
  return result;
}
function stage(name) { proof.stages.push({ name, at: new Date().toISOString() }); console.log('PASS ' + name); }
async function run(kind, jobId) {
  const { taskId } = await post('tasks', { kind, jobId });
  await app.workflow.queue;
  const task = (await app.workspace.load()).tasks.find(t => t.id === taskId);
  assert.equal(task.status, 'complete', `${kind}: ${task.message}`);
}
try {
  const state = await app.workspace.load();
  if (!state.jobs.length) {
  await post('profile', { profile: { ...candidate, phone: '+1-202-555-0147', eligibility: 'For this fictional candidate: authorized to work in the United States without sponsorship.', compensation: 'Fictional target: $70,000–90,000 USD base, negotiable.', story: 'I personally owned chassis design and performed the physical tests for the Formula SAE project. I am a Mechanical Engineering student graduating in 2027 and seeking an entry-level engineering role in Boston.' }, revision: state.revision });
  await post('provider/test', { id: provider.id }); stage('real provider connection');
  await run('interview');
  await post('understanding/approve', {}); stage('live candidate understanding reviewed');
  await post('jobs', { company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/123', description, location: 'Boston' });
  }
  const id = (await app.workspace.load()).jobs[0].id;
  const existing = (await app.workspace.load()).jobs[0];
  const currentContext = await app.workspace.context(await app.workspace.load());
  if (!existing.packet || existing.contextHash !== currentContext.hash || existing.packet.questions.length) {
  await post('jobs/update', { id, roleAnswers: 'Additional facts for this fictional test candidate: on the Formula SAE chassis, I compared a lighter layout with a stiffer alternative and used physical bench testing to inform that choice. I personally owned the design and tests. No numerical improvement is claimed. The only required free-text form answer is a description of that project. Optional improvements can be suggestions; no further facts are available.' });
  stage('candidate supplied project clarification');
  await run('evaluate', id); stage('live evidence-backed job evaluation');
  await post('jobs/update', { id, selected: true, overrideReason: 'Explicit synthetic acceptance-test role, pursued to validate the complete workflow.' });
  await run('prepare', id); stage('live packet generation and independent factual review');
  } else stage('resumed previously reviewed live packet');
  const job = (await app.workspace.load()).jobs.find(j => j.id === id);
  proof.score = job.evaluation.score;
  proof.openQuestions = job.packet.questions;
  assert.equal(job.packet.questions.length, 0, 'Live packet requires candidate answers; the gate must not be bypassed.');
  assert.equal(job.review.passed, true);
  const download = await fetch(`${base}/api/artifact?path=${encodeURIComponent(job.pdf)}`, { headers: { 'X-Plainhand-Token': app.token } });
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  stage('real PDF generated and downloaded');
  await post('packet/approve', { id }); stage('exact packet approval');
  const form = await post('browser/open', { id });
  proof.formQuestions = form.questions || [];
  const projectField = form.fields.find(f => f.label === 'Describe an engineering project.');
  assert.ok(form.answers[projectField.key]?.length > 20, 'The live model must answer the actual project question with evidence.');
  const sponsorship = form.fields.find(f => /sponsorship/.test(f.label));
  assert.equal(form.answers[sponsorship.key], undefined);
  await post('browser/fill', { id, answers: form.answers });
  assert.equal(await ats.page.locator('[name=name]').inputValue(), candidate.name);
  assert.ok(await ats.page.locator('[name=resume]').evaluate(el => el.files.length === 1));
  assert.equal(await ats.page.locator('[name=sponsorship]').inputValue(), '');
  assert.equal(await ats.page.locator('[name=attestation]').isChecked(), false);
  assert.equal(await ats.page.evaluate(() => window.submissionCount), 0);
  stage('actual browser fields filled and correct PDF uploaded');
  await ats.page.screenshot({ path: path.join(root, 'filled-form.png'), fullPage: true });
  await post('browser/handoff', { id }); stage('manual submission handoff');
  const final = await app.workspace.load();
  proof.completedModelTasks = final.tasks.filter(t => t.status === 'complete').map(t => ({ kind: t.kind, finishedAt: t.finishedAt }));
  assert.equal(final.jobs[0].status, 'Apply');
  assert.match(await app.workspace.read('data/applications.md'), /Apply/);
  stage('tracker preserved as unsubmitted');
  proof.artifacts = job.artifacts;
  proof.success = true;
} catch (error) {
  proof.error = error.message;
  console.error('FAIL ' + error.message);
  process.exitCode = 1;
} finally {
  await mkdir(path.join(root, 'proof'), { recursive: true });
  await writeFile(path.join(root, 'proof/result.json'), JSON.stringify(proof, null, 2));
  console.log('Reviewable proof: ' + root);
  await app.close();
}
