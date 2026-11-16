#!/usr/bin/env node
// U01 fresh-install onboarding proof, with a controlled fixture agent.
//
// 1. Clone this repository into a temporary directory.
// 2. Run `npm ci` and `npm run setup` there.
// 3. Start the cloned app and drive it through its public HTTP API with a
//    deterministic fixture agent: build the profile by conversation, import a
//    resume, approve the understanding, write and approve the master resume,
//    evaluate a fictional job and prepare a packet.
// 4. Count the candidate's interventions, calls, tokens and wall time at the
//    first reviewed master and the first prepared packet.
//
// The fixture agent is the controlled evaluation agent (plainhand/evaluation/
// agent.mjs), not a live model. The clone and install are real; model quality is
// not measured here and no provider is contacted. Output goes under output/.
//
// Usage: node scripts/onboarding-proof.mjs [--keep]

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(ROOT, 'output', `onboarding-proof-${stamp}`);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const clock = () => Date.now();
const seconds = ms => Math.round(ms / 100) / 10;

function run(command, args, { cwd, timeout = 900000 } = {}) {
  return new Promise(resolve => {
    const started = clock();
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '', settled = false;
    const finish = extra => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command: [command, ...args].join(' '), code: child.exitCode, seconds: seconds(clock() - started), stdout, stderr, ...extra });
    };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ timedOut: true }); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish({ code: null, error: error.message }));
    child.on('close', code => finish({ code }));
  });
}

const questionSentences = text => (String(text || '').match(/[^.!?\n]*\?/g) || []).map(question => question.toLowerCase().replace(/[^a-z0-9%$]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
function repeatedQuestions(transcript) {
  const counts = new Map();
  for (const turn of transcript) for (const question of questionSentences(turn.assistant)) counts.set(question, (counts.get(question) || 0) + 1);
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}
const ledgerRepeats = state => {
  const checks = Array.isArray(state?.conflictReview?.questionChecks) ? state.conflictReview.questionChecks : [];
  if (!checks.length) return null;
  const counts = new Map();
  for (const check of checks) if (check?.digest) counts.set(check.digest, (counts.get(check.digest) || 0) + 1);
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
};

const totalsOf = usage => usage?.totals ? {
  calls: usage.totals.calls ?? null,
  inputTokens: usage.totals.inputTokens?.value ?? null,
  outputTokens: usage.totals.outputTokens?.value ?? null,
  tokens: (usage.totals.inputTokens?.value ?? 0) + (usage.totals.outputTokens?.value ?? 0) || null,
  promptChars: usage.totals.promptChars?.value ?? null,
  durationMs: usage.totals.durationMs?.value ?? null,
} : null;

await mkdir(out, { recursive: true });
const installation = path.join(await mkdtemp(path.join(tmpdir(), 'plainhand-onboarding-')), 'plainhand');
const stages = [];
const mark = (name, at = clock(), extra = {}) => { stages.push({ name, at, ...extra }); return at; };

try {
  const clone = await run('git', ['clone', '--quiet', '--no-hardlinks', ROOT, installation]);
  await writeFile(path.join(out, 'install.log'), `$ ${clone.command}\n${clone.stdout}${clone.stderr}\n`);
  if (clone.code !== 0) throw new Error(`git clone failed: ${clone.stderr || clone.stdout}`);
  const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: installation })).stdout.trim();

  const startedInstall = clock();
  const ci = await run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: installation });
  await writeFile(path.join(out, 'install.log'), `$ ${ci.command}\n${ci.stdout}${ci.stderr}\n`, { flag: 'a' });
  if (ci.code !== 0) throw new Error(`npm ci failed: ${ci.stderr || ci.stdout}`);
  const setup = await run(npm, ['run', 'setup'], { cwd: installation });
  await writeFile(path.join(out, 'setup.log'), `$ ${setup.command}\n${setup.stdout}${setup.stderr}\n`);
  if (setup.code !== 0) throw new Error(`npm run setup failed: ${setup.stderr || setup.stdout}`);
  const installSeconds = seconds(clock() - startedInstall);

  const load = file => import(pathToFileURL(path.join(installation, file)).href);
  const { createPlainhand } = await load('plainhand-server.mjs');
  const { controlledAgent } = await load('plainhand/evaluation/agent.mjs');
  const { holdoutPersonas, holdoutJobs } = await load('plainhand/evaluation/corpus-holdout.mjs');
  const { simulatedCandidate } = await load('plainhand/benchmarks/profile-bench.mjs');
  const persona = holdoutPersonas.find(item => item.id === 'holdout-fin-controller');
  const job = holdoutJobs.find(item => item.id === 'holdout-job-fin-forecast');

  const workspaceRoot = path.join(path.dirname(installation), 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  const appStarted = clock();
  const app = await createPlainhand({
    root: workspaceRoot,
    startFeatures: false,
    workflowOptions: { agent: controlledAgent({ scenario: { id: 'onboarding-proof', roleOrder: 'recent' }, persona, job }) },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { 'x-plainhand-token': app.token, 'content-type': 'application/json' };
  const api = async (endpoint, body) => {
    const response = await fetch(`${base}/api/${endpoint}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${endpoint}: ${result.error || response.status}`);
    return result;
  };
  const stateNow = () => api('state');
  const assertTask = (state, taskId, kind) => {
    const task = (state.tasks || []).find(item => item.id === taskId);
    if (!task || task.status !== 'complete') throw new Error(`${kind}: ${task?.message || 'task did not finish'}`);
    return task;
  };

  await api('provider', { id: 'codex' });
  const candidate = simulatedCandidate(persona);
  const transcript = [];
  let message = 'Help me build my profile.';
  let proposalConfirmations = 0;
  for (let turn = 0; turn < 8 && message; turn += 1) {
    const { turnId } = await api('agent/message', { text: message });
    await app.agent.running.catch(() => {});
    const history = await api('agent/history?limit=200');
    const reply = (history.messages || []).filter(item => item.turnId === turnId && item.role === 'assistant').at(-1);
    const proposal = reply?.proposalId && (history.proposals || []).find(item => item.id === reply.proposalId);
    if (proposal?.status === 'pending') {
      await api('agent/confirm', { proposalId: proposal.id, accept: true });
      await app.workflow.queue;
      proposalConfirmations += 1;
    }
    const say = reply?.text || '';
    transcript.push({ candidate: message, assistant: say, actions: (proposal?.actions || []).map(action => action.name) });
    const answer = candidate.reply(say);
    if (answer.done) break;
    message = answer.text;
  }
  mark('conversation ended');

  const imported = await api('resume/import', { name: 'resume.txt', content: Buffer.from(persona.profile.resume, 'utf8').toString('base64') });
  const beforeProfile = await stateNow();
  await api('profile', { revision: beforeProfile.revision, profile: { ...persona.profile, resume: imported.text } });
  mark('resume imported into the profile');

  const interviewTask = await api('tasks', { kind: 'interview' });
  await app.workflow.queue;
  assertTask(await stateNow(), interviewTask.taskId, 'interview');
  await api('understanding/approve', {});
  mark('understanding approved');

  const masterTask = await api('tasks', { kind: 'standard' });
  await app.workflow.queue;
  const masterState = await stateNow();
  assertTask(masterState, masterTask.taskId, 'standard');
  await api('standard/approve', {});
  const masterApproved = mark('master approved', clock(), { usage: totalsOf(masterState.usage) });

  const created = await api('jobs', {
    company: job.company,
    title: job.title,
    url: `https://jobs.lever.co/synthetic/onboarding-proof-${stamp}`,
    description: job.description,
    location: job.location,
  });
  mark('job added');
  const evaluateTask = await api('tasks', { kind: 'evaluate', jobId: created.id });
  await app.workflow.queue;
  const evaluatedState = await stateNow();
  assertTask(evaluatedState, evaluateTask.taskId, 'evaluate');
  const evaluated = evaluatedState.jobs.find(item => item.id === created.id);
  await api('jobs/update', {
    id: created.id,
    selected: true,
    ...(evaluated.evaluation?.score < 4 ? { overrideReason: 'Controlled fixture proof: the fictional job is the candidate target.' } : {}),
  });
  mark('job evaluated and selected', clock(), { score: evaluated.evaluation?.score ?? null, recommendation: evaluated.evaluation?.recommendation ?? null });
  const prepareTask = await api('tasks', { kind: 'prepare', jobId: created.id });
  await app.workflow.queue;
  const packetState = await stateNow();
  assertTask(packetState, prepareTask.taskId, 'prepare');
  const prepared = packetState.jobs.find(item => item.id === created.id);
  if (!prepared?.packet) throw new Error('prepare: no packet was stored');
  const packetPrepared = mark('packet prepared', clock(), { usage: totalsOf(packetState.usage) });
  await api('packet/approve', { id: created.id });
  mark('packet approved');

  const finalState = await stateNow();
  const approvedJob = finalState.jobs.find(item => item.id === created.id);
  const ledger = ledgerRepeats(finalState);
  const assistantQuestions = transcript.reduce((total, turn) => total + (turn.assistant.match(/\?/g) || []).length, 0);
  const repeatedKnownFactQuestions = ledger ?? repeatedQuestions(transcript);
  const interventions = {
    userTurns: transcript.length,
    assistantQuestions,
    repeatedKnownFactQuestions,
    repeatedBasis: ledger === null ? 'transcript' : 'ledger',
    proposalConfirmations,
    manualEdits: 1,
    manualEditDetail: ['Profile saved after the resume import'],
    rescues: 0,
    approvals: 3,
    approvalsDetail: ['understanding', 'master resume', 'packet'],
    selections: 1,
    taskTriggers: 4,
    jobAdds: 1,
  };
  interventions.total = interventions.userTurns + interventions.proposalConfirmations + interventions.manualEdits + interventions.rescues + interventions.approvals + interventions.selections + interventions.taskTriggers + interventions.jobAdds;

  const report = {
    generatedAt: new Date().toISOString(),
    evidenceTier: 'controlled fixture agent on a fresh clone and install',
    installation: {
      clone: installation,
      commit,
      installSeconds,
      npmCi: { code: ci.code, seconds: ci.seconds },
      setup: { code: setup.code, seconds: setup.seconds },
      providerContacted: false,
      startFeatures: false,
    },
    persona: { id: persona.id, name: persona.name, roles: persona.records.length },
    job: { id: job.id, company: job.company, title: job.title },
    wallToMasterMs: masterApproved - appStarted,
    wallToPacketMs: packetPrepared - appStarted,
    callsToMaster: totalsOf(masterState.usage)?.calls ?? null,
    callsToPacket: totalsOf(packetState.usage)?.calls ?? null,
    tokensToMaster: totalsOf(masterState.usage)?.tokens ?? null,
    tokensToPacket: totalsOf(packetState.usage)?.tokens ?? null,
    stages: stages.map(stage => ({ ...stage, offsetSeconds: seconds(stage.at - appStarted), wallMs: stage.at - appStarted })),
    understanding: { approved: finalState.understanding?.approved === true },
    master: {
      status: finalState.standard?.kind === 'master',
      approvedAt: finalState.standard?.approvedAt || null,
      entries: finalState.standard?.draft?.resume?.length ?? null,
      completeness: finalState.standard?.completeness?.counts ?? null,
    },
    packet: {
      prepared: Boolean(approvedJob.packet),
      approved: Boolean(approvedJob.approvedHash),
      resumeEntries: approvedJob.packet?.resume?.length ?? null,
      coverLetterCharacters: approvedJob.packet?.coverLetter?.length ?? null,
    },
    conversation: transcript,
    interventions,
    finalUsage: totalsOf(finalState.usage),
    checks: {
      profileConversationBuilt: transcript.length > 0,
      resumeImported: Boolean(finalState.profile?.resume?.includes(persona.educationEvidence.split(' — ')[0] || '')),
      understandingApproved: finalState.understanding?.approved === true,
      masterApproved: Boolean(finalState.standard?.approvedHash),
      jobEvaluated: Boolean(evaluated.evaluation),
      packetPrepared: Boolean(approvedJob.packet),
      packetApproved: Boolean(approvedJob.approvedHash),
    },
  };

  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(out, 'transcript.json'), JSON.stringify(transcript, null, 2));
  const stageRows = report.stages.map(stage => `| ${stage.name} | ${seconds(stage.at - appStarted)} | ${stage.usage?.calls ?? '—'} | ${stage.usage?.tokens ?? '—'} |`).join('\n');
  const conversationRows = transcript.map((turn, index) => `| ${index + 1} | ${turn.candidate.replace(/\n/g, ' ')} | ${turn.assistant.replace(/\n/g, ' ')} | ${turn.actions.join(', ') || '—'} |`).join('\n');
  const markdown = `# Fresh-install onboarding proof

Generated: ${report.generatedAt}

Tier: ${report.evidenceTier}. The clone and install are real; the agent is the
controlled fixture, so no provider or paid model call was made and model quality
is not measured.

## Install

| Step | Result | Time |
| --- | --- | --- |
| \`git clone\` | ${commit.slice(0, 12)} | — |
| \`npm ci\` | exit ${ci.code} | ${ci.seconds}s |
| \`npm run setup\` | exit ${setup.code} | ${setup.seconds}s |

Total install: ${installSeconds}s. Workspace: a fresh temporary directory.

## Journey

Persona: ${persona.id} (${persona.name}), ${persona.records.length} roles. Job: ${job.company} — ${job.title}.

| Stage | Seconds from app start | Calls so far | Tokens so far |
| --- | --- | --- | --- |
${stageRows}

First reviewed master: ${seconds(report.wallToMasterMs)}s, ${report.callsToMaster} calls, ${report.tokensToMaster} tokens.
First prepared packet: ${seconds(report.wallToPacketMs)}s, ${report.callsToPacket} calls, ${report.tokensToPacket} tokens.

## Interventions

| Kind | Count |
| --- | --- |
| User turns in the profile conversation | ${interventions.userTurns} |
| Assistant questions | ${interventions.assistantQuestions} |
| Repeated known-fact questions | ${interventions.repeatedKnownFactQuestions} (${interventions.repeatedBasis}) |
| Proposal confirmations | ${interventions.proposalConfirmations} |
| Manual edits | ${interventions.manualEdits} (${interventions.manualEditDetail.join('; ')}) |
| Rescues (app-owed fields the candidate filled) | ${interventions.rescues} |
| Approvals | ${interventions.approvals} (${interventions.approvalsDetail.join(', ')}) |
| Job added / selected | ${interventions.jobAdds} / ${interventions.selections} |
| Task triggers | ${interventions.taskTriggers} |
| **Total** | **${interventions.total}** |

## Conversation

| # | Candidate | Assistant | Actions |
| --- | --- | --- | --- |
${conversationRows}

## Checks

${Object.entries(report.checks).map(([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'} ${name}`).join('\n')}

## Master completeness

${report.master.completeness ? `Roles ${report.master.completeness.roles.present}/${report.master.completeness.roles.total}, credentials ${report.master.completeness.credentials.present}/${report.master.completeness.credentials.total}, degrees ${report.master.completeness.degrees.present}/${report.master.completeness.degrees.total}, results ${report.master.completeness.results.present}/${report.master.completeness.results.total}. The controlled fixture writes the master from available facts without role headings, so missing roles here are a fixture limit, not a live-model result.` : 'Not available.'}
`;
  await writeFile(path.join(out, 'REPORT.md'), markdown);
  await app.close();
  console.log(`Fresh-install onboarding proof: master ${seconds(report.wallToMasterMs)}s, packet ${seconds(report.wallToPacketMs)}s, ${interventions.total} interventions.`);
  console.log(`Evidence: ${out}`);
  if (!KEEP) await rm(path.dirname(installation), { recursive: true, force: true });
} catch (error) {
  await writeFile(path.join(out, 'ERROR.md'), `# Onboarding proof failed\n\n${error.stack || error.message}\n`);
  console.error(error.stack || error.message);
  console.error(`Logs: ${out}`);
  process.exitCode = 1;
}
