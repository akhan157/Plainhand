#!/usr/bin/env node
// Durable-memory probe (M6). Runs on a temporary root with a scripted provider:
//  1. fills every memory category;
//  2. restarts the process and diffs state, answer bank, corrections and context hash;
//  3. switches the provider id and diffs identity, understanding, samples, line,
//     format, standard draft and approvals;
//  4. captures every provider input in one prepare and greps for an excluded value,
//     an excluded source and credential-shaped keys;
//  5. deletes a story and re-runs prepare;
//  6. approves a correction and prepares a second job;
//  7. plants a contradiction, resolves it, and checks restart and import.
//
// No live model, no browser, no network. It exits non-zero on any falsifier and writes
// a JSON report to output/memory-probe-<timestamp>.json unless --out names a path.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createPlainhand } from '../plainhand-server.mjs';
import { Workspace, digest } from '../plainhand/store.mjs';
import { exportWorkspace, importWorkspace } from '../plainhand/workspace-import.mjs';
import { AnswerBank } from '../plainhand/answer-bank.mjs';
import { Corrections } from '../plainhand/corrections.mjs';
import { findConflicts, questionStats } from '../plainhand/memory-checks.mjs';

const RUN = promisify(execFile);
const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CV_QUOTE = 'Designed and tested a lightweight chassis for a Formula SAE team.';
const TEAM_QUOTE = 'Led a team of 5 engineers through the Northwind chassis programme.';
const STORY_QUOTE = 'I owned the design and testing work on the chassis and wrote the test report.';
const CONTRADICTION_QUOTE = 'At Northwind Labs I coordinated 3 contractors on the chassis programme.';
const QUESTION = 'Describe a hands-on project.';
const APPROVED = 'I designed and tested a lightweight chassis, then wrote the handoff checklist for the next build.';
const SETTLED = 'What is your current location?';
const SENTINEL = 'PROBE-EXCLUDED-SAMPLE-9c1f';
const PHONE = '+1-555-0100';
const CV = [
  'Senior Engineer at Northwind Labs, 2021–2024.',
  TEAM_QUOTE,
  CV_QUOTE,
  'B.S. Mechanical Engineering, Example University, 2020.',
].join('\n');
const PROFILE = {
  name: 'Probe Candidate', email: 'probe@example.invalid', phone: PHONE, location: 'Boston, US', timezone: 'America/New_York',
  roles: 'Mechanical Engineer', compensation: '$90k', eligibility: 'Authorized to work in the US', graduation: '2020',
  links: '', resume: CV, story: 'I build lightweight hardware and test it until it holds.', voice: 'Clear and direct.', constraints: 'Entry-level roles.',
};

const credentialKey = key => /(api[_-]?key|secret|token|password|authorization|bearer|access[_-]?key|private[_-]?key|session[_-]?token|credential)/i.test(String(key));
function credentialKeys(value, found = [], trail = '') {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) { for (const item of value) credentialKeys(item, found, trail); return found; }
  for (const [key, child] of Object.entries(value)) {
    const here = trail ? `${trail}.${key}` : key;
    if (credentialKey(key)) found.push(here);
    credentialKeys(child, found, here);
  }
  return found;
}

const memoryView = state => ({
  identity: digest({ name: state.profile.name, email: state.profile.email, phone: state.profile.phone, location: state.profile.location, roles: state.profile.roles, resume: state.profile.resume, graduation: state.profile.graduation, eligibility: state.profile.eligibility }),
  understanding: digest(state.understanding),
  samples: digest(state.writingSamples),
  line: digest(state.claimLine),
  format: digest(state.resumeFormat),
  standard: digest(state.standard),
  approvals: digest((state.jobs || []).map(job => [job.id, job.approvedHash || null])),
});

// A separate Node process reads the workspace from disk. This is a real restart, not a
// second read in the same process.
async function restartSnapshot(root) {
  const url = file => JSON.stringify(pathToFileURL(path.join(APP_ROOT, file)).href);
  const code = `
import { Workspace, digest } from ${url('plainhand/store.mjs')};
import { AnswerBank } from ${url('plainhand/answer-bank.mjs')};
import { Corrections } from ${url('plainhand/corrections.mjs')};
import { findConflicts } from ${url('plainhand/memory-checks.mjs')};
const workspace = new Workspace(process.argv[1]);
const state = await workspace.load();
const context = await workspace.context({ ...state, contextPrefs: {} });
const bank = await new AnswerBank(workspace).load();
const corrections = await new Corrections(workspace).list();
const decisions = state.conflictReview?.decisions || [];
const conflicts = findConflicts({ sources: context.sources, profile: state.profile, decisions });
console.log(JSON.stringify({ state: digest(state), bank: digest(bank), corrections: digest(corrections), contextHash: context.hash, decisions: decisions.length, conflicts: conflicts.length }));
`;
  const { stdout } = await RUN(process.execPath, ['--input-type=module', '-e', code, root], { cwd: APP_ROOT, timeout: 60000 });
  const lines = stdout.trim().split('\n').filter(Boolean);
  return JSON.parse(lines.at(-1));
}

async function localSnapshot(root) {
  const workspace = new Workspace(root);
  const state = await workspace.load();
  const context = await workspace.context(state);
  return { state: digest(state), bank: digest(await new AnswerBank(workspace).load()), corrections: digest(await new Corrections(workspace).list()), contextHash: context.hash };
}

async function main() {
  const startedAt = new Date().toISOString();
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const stamp = startedAt.replace(/[:.]/g, '-');
  const out = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : path.join(APP_ROOT, 'output', `memory-probe-${stamp}.json`);
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-memory-probe-'));
  const checks = [], failures = [], inputs = [];
  let app = null, preparedInputs = [];
  const check = (name, ok, detail = null) => { checks.push({ name, ok: Boolean(ok), ...(detail == null ? {} : { detail }) }); if (!ok) failures.push(name); };
  const agent = async (provider, instruction, data, options = {}) => {
    inputs.push({ instruction, data: JSON.parse(JSON.stringify(data ?? null)) });
    options.onUsage?.({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reportedUsd: 0, models: ['synthetic-probe'] });
    if (instruction.includes('Interview a')) return { summary: 'A hands-on mechanical engineering graduate.', strengths: ['Design and testing'], voice: 'Clear and direct.', questions: ['What did the testing change?'], sampleAnswer: 'I designed and tested a lightweight chassis.', gaps: ['Testing outcomes need detail.'] };
    if (instruction.includes('Evaluate this')) return { score: 4.4, recommendation: 'Apply', summary: 'Hands-on engineering design and testing.', matches: [{ text: 'Mechanical design and testing', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }] }], gaps: [], questions: [], legitimacyNotes: [] };
    if (instruction.includes('Prepare a')) {
      const story = agent.packetMode === 'story';
      const quote = story ? STORY_QUOTE : CV_QUOTE;
      return {
        headline: 'Mechanical Engineering Graduate',
        resume: [{ section: 'Projects', text: story ? 'Owned the chassis design and testing work.' : 'Designed and tested a lightweight chassis.', evidence: [{ sourceId: story ? 'interview' : 'cv', quote }] }],
        coverLetter: 'I would like to bring my design and testing experience to this engineering role.',
        answers: [{ question: QUESTION, answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }] }],
        questions: [SETTLED],
      };
    }
    if (instruction.includes("Write the candidate's master resume")) return { headline: 'Mechanical Engineering Graduate', resume: [{ section: 'Projects', text: 'Designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }] }, { section: 'Education', text: 'B.S. Mechanical Engineering, Example University, 2020.', evidence: [{ sourceId: 'cv', quote: 'B.S. Mechanical Engineering, Example University, 2020.' }] }], coverLetter: 'I design and test lightweight hardware.', suggestions: [] };
    if (instruction.includes('Apply the humanizer rules')) return { items: (data.items || []).map(item => ({ id: item.id, text: item.text })), remaining: [] };
    if (instruction.includes('Review this')) return { passed: true, issues: [] };
    throw new Error('Unknown probe instruction: ' + instruction.slice(0, 100));
  };
  agent.packetMode = 'cv';
  try {
    app = await createPlainhand({ root, providers: async () => [{ id: 'codex', name: 'ChatGPT', engine: 'Codex CLI', description: 'Probe provider', command: 'codex', login: 'codex login', install: 'npm install -g @openai/codex', docs: 'https://developers.openai.com/codex/auth/', installed: true, auth: 'signed-in' }, { id: 'claude', name: 'Claude', engine: 'Claude Code', description: 'Probe provider', command: 'claude', login: 'claude auth login', install: 'npm install -g @anthropic-ai/claude-code', docs: 'https://code.claude.com/docs/en/headless', installed: true, auth: 'signed-in' }], features: [], startFeatures: false, workflowOptions: {
      agent,
      verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'A role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Synthetic probe.' }),
      scanner: async () => [],
      renderer: async (workspace, state, job) => { const pdf = `output/probe-${job.id}.pdf`; await workspace.write(pdf, 'probe-pdf'); return { pdf, pdfHash: digest(Buffer.from('probe-pdf')), artifacts: [pdf] }; },
    } });
    const ui = async (name, input) => (await app.registry.run(name, input, { actor: 'ui' })).result;
    const state = async () => app.workspace.load();
    const settle = async (kind, jobId = null, extra = {}) => {
      const { taskId } = await ui(`tasks.${kind}`, { ...(jobId ? { jobId } : {}), ...extra });
      await app.workflow.queue;
      return (await state()).tasks.find(task => task.id === taskId);
    };
    const prepareJob = async (company, suffix) => {
      const { id } = await ui('jobs.add', { company, title: `Design Engineer ${suffix}`, url: `https://jobs.lever.co/probe/${suffix}` });
      const evaluation = await settle('evaluate', id);
      check(`evaluate ${suffix}`, evaluation.status === 'complete', evaluation.message);
      await ui('jobs.select', { jobId: id, selected: true });
      const task = await settle('prepare', id);
      return { id, task };
    };

    // 1. Fill every memory category.
    let current = await state();
    await app.workspace.saveProfile({ ...current.profile, ...PROFILE }, current.revision);
    await app.workspace.mutate(latest => {
      latest.provider = 'codex';
      latest.conversation.push({ id: 'probe-story-1', role: 'user', text: STORY_QUOTE, at: '2026-01-01T00:00:00.000Z' });
    });
    await ui('profile.addWritingSample', { title: 'Probe sample', text: `This sentence exists only to test exclusion. ${SENTINEL}` });
    await ui('line.addStatement', { text: 'Say led only when I owned the decision.' });
    await ui('format.save', { format: { page: 'a4', sections: ['Projects', 'Education'] } });
    await ui('settings.autonomy', { enabled: true, perDay: 3, minScore: 4 });
    const interview = await settle('interview');
    check('interview builds understanding', interview.status === 'complete', interview.message);
    await ui('understanding.approve', {});
    const standard = await settle('standard');
    check('standard draft written', standard.status === 'complete', standard.message);
    current = await state();
    check('memory categories stored', Boolean(current.profile.name && current.writingSamples.length && current.claimLine.statements.length && current.resumeFormat && current.standard?.draft && current.understanding?.approved && current.settings?.autonomy?.enabled));

    // 2. Restart: state, bank, corrections and context hash are byte-identical.
    const beforeRestart = await localSnapshot(root);
    const restarted = await restartSnapshot(root);
    for (const key of ['state', 'bank', 'corrections', 'contextHash']) check(`restart keeps ${key}`, restarted[key] === beforeRestart[key], { before: beforeRestart[key], after: restarted[key] });

    // 3. Provider switch: memory and approvals do not move.
    const beforeSwitch = memoryView(await state());
    await app.workspace.mutate(latest => { latest.provider = 'claude'; });
    const afterSwitch = memoryView(await state());
    for (const key of Object.keys(beforeSwitch)) check(`provider switch keeps ${key}`, beforeSwitch[key] === afterSwitch[key], { before: beforeSwitch[key], after: afterSwitch[key] });

    // 4. One prepare with every provider input captured. Exclude a writing sample and
    //    the phone field; no excluded value or credential-shaped key may reach a model.
    await ui('context.exclude', { sources: ['writing-samples'], fields: ['phone'] });
    inputs.length = 0;
    const first = await prepareJob('Northwind', 'probe-1');
    preparedInputs = inputs.filter(entry => /Evaluate this|Prepare a|Apply the humanizer|Review this/.test(entry.instruction));
    check('first packet prepared', first.task.status === 'complete', first.task.message);
    const captured = JSON.stringify(preparedInputs);
    check('excluded writing sample never reaches a provider', !captured.includes(SENTINEL));
    check('excluded phone field never reaches a provider', !captured.includes(PHONE));
    const keys = credentialKeys(preparedInputs);
    check('no credential-shaped key in provider input', keys.length === 0, keys);
    await ui('packet.approve', { jobId: first.id });
    current = await state();
    check('packet approval is stored', Boolean(current.jobs.find(job => job.id === first.id)?.approvedHash));

    // 5. Delete the story a packet used; the fact is no longer usable.
    agent.packetMode = 'story';
    const deletedJob = await prepareJob('Northwind', 'probe-2');
    check('story-backed packet prepared', deletedJob.task.status === 'complete', deletedJob.task.message);
    current = await state();
    const story = current.conversation.find(message => message.role === 'user' && message.id === 'probe-story-1');
    await ui('profile.removeStory', { key: story.id });
    current = await state();
    check('story is gone after deletion', !current.conversation.some(message => message.id === 'probe-story-1'));
    const storyJobBefore = current.jobs.find(job => job.id === deletedJob.id);
    // The profile changed, so the old packet is stale. Re-evaluate first; the retry
    // must then still fail because the story that grounded the claim is gone.
    await assertStale();
    await settle('evaluate', deletedJob.id);
    const retry = await settle('prepare', deletedJob.id);
    check('deleted story cannot ground a new packet', retry.status === 'failed' && /without an exact source reference/.test(retry.message || ''), retry.message);
    current = await state();
    check('the failed retry did not replace the saved packet', JSON.stringify(current.jobs.find(job => job.id === deletedJob.id)?.packet) === JSON.stringify(storyJobBefore.packet));
    async function assertStale() {
      let refused = false;
      try { await ui('packet.approve', { jobId: deletedJob.id }); } catch (error) { refused = /regenerated/.test(error.message); }
      check('a packet built on the deleted story is stale', refused);
    }

    // 6. Approve a correction, then prepare a second job: the approved text is reused.
    const proposed = await ui('corrections.propose', { jobId: first.id, question: QUESTION, answer: APPROVED, evidence: [{ sourceId: 'cv', quote: CV_QUOTE }], scope: 'global' });
    await ui('corrections.approve', { id: proposed.id });
    agent.packetMode = 'cv';
    const second = await prepareJob('Northwind', 'probe-3');
    check('second packet prepared', second.task.status === 'complete', second.task.message);
    current = await state();
    const secondPacket = current.jobs.find(job => job.id === second.id)?.packet;
    check('approved correction is reused in the later packet', secondPacket?.answers?.[0]?.answer === APPROVED, secondPacket?.answers?.[0]?.answer);
    check('reuse keeps its provenance', secondPacket?.answers?.[0]?.reuse?.kind === 'reusable-answer', secondPacket?.answers?.[0]?.reuse);
    check('settled question was filtered in three applications and its repeats counted', (() => { const stats = questionStats(current.conflictReview); return stats.asked === 3 && stats.repeated === 2; })(), questionStats(current.conflictReview));

    // 7. Plant a contradiction, block a packet that cites it, resolve it, restart and import.
    await ui('profile.addStory', { text: CONTRADICTION_QUOTE });
    await ui('context.exclude', { sources: ['interview'] });
    const open = await ui('conflicts.list', {});
    const conflict = open.open.find(item => item.kind === 'number');
    check('planted contradiction is found', Boolean(conflict), open.conflicts);
    check('the read action keeps the shared quote and redacts the excluded one', Boolean(conflict && conflict.quotes.length === 1 && conflict.quotes[0].quote === TEAM_QUOTE && !JSON.stringify(conflict).includes('3 contractors')), conflict?.quotes);
    check('excluded source is compared but stays marked excluded', Boolean(conflict?.excluded?.includes('interview')), conflict?.excluded);
    const fourth = await prepareJob('Northwind', 'probe-4');
    current = await state();
    let fourthPacket = current.jobs.find(job => job.id === fourth.id)?.packet;
    const blocking = fourthPacket?.questions?.find(question => /disagree/.test(question));
    check('packet that cites a conflicted source is blocked', Boolean(blocking), fourthPacket?.questions);
    check('blocking question does not quote the excluded source', Boolean(blocking && !blocking.includes(CONTRADICTION_QUOTE.slice(0, 40))));
    await ui('conflicts.record', { id: conflict.id, sourceId: 'cv' });
    check('recorded disposition clears the conflict', (await ui('conflicts.list', {})).open.length === 0);
    const finalRestart = await restartSnapshot(root);
    check('decision survives restart', finalRestart.decisions === 1 && finalRestart.conflicts === 0, finalRestart);
    const exported = await exportWorkspace(new Workspace(root));
    check('export carries the conflict decision', exported.conflictReview?.decisions?.length === 1);
    check('export carries no connection check or checkpoint', exported.connectionChecks === undefined && (exported.jobs || []).every(job => job.browserCheckpoint === undefined));
    check('export carries no credential-shaped key', credentialKeys(exported).length === 0, credentialKeys(exported));
    const importedRoot = await mkdtemp(path.join(tmpdir(), 'plainhand-memory-probe-import-'));
    try {
      const target = new Workspace(importedRoot);
      const summary = await importWorkspace({ workspace: target, data: exported });
      const imported = await target.load();
      const importedContext = await target.context({ ...imported, contextPrefs: {} });
      const importedConflicts = findConflicts({ sources: importedContext.sources, profile: imported.profile, decisions: imported.conflictReview?.decisions || [] });
      check('import keeps the conflict decision', summary.conflicts?.decisions === 1);
      check('conflict does not return after import', importedConflicts.length === 0);
    } finally { await rm(importedRoot, { recursive: true, force: true }); }
    const afterResolution = await settle('prepare', fourth.id);
    current = await state();
    fourthPacket = current.jobs.find(job => job.id === fourth.id)?.packet;
    check('resolved packet prepares again without the conflict question', afterResolution.status === 'complete' && !(fourthPacket?.questions || []).some(question => /disagree/.test(question)), afterResolution.message);
    await ui('packet.approve', { jobId: fourth.id });
    check('resolved packet can be approved', Boolean((await state()).jobs.find(job => job.id === fourth.id)?.approvedHash));

    // The bank and corrections files are part of the memory this probe filled.
    check('answer bank and corrections stored', (await new AnswerBank(app.workspace).load()).length >= 1 && (await new Corrections(app.workspace).list()).some(entry => entry.status === 'approved'));
  } catch (error) {
    failures.push(`probe crashed: ${error.message}`);
    checks.push({ name: 'probe completed', ok: false, detail: error.stack?.split('\n').slice(0, 4).join('\n') });
  } finally {
    try { await app?.close(); } catch {}
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
  const report = {
    probe: 'memory-probe', version: 1, ok: failures.length === 0, startedAt, finishedAt: new Date().toISOString(),
    node: process.version, checks, failures, providerInputs: preparedInputs.length,
  };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, out, checks: checks.length, failures }));
  if (!report.ok) process.exitCode = 1;
}

await main();
