// Runs the app end to end against the owned sandbox and writes scored evidence.
// Controlled runs use a deterministic agent (harness proof); live runs use a real
// installed CLI (quality measurement). Every submission goes to the loopback
// sandbox, never to an employer.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../../plainhand-server.mjs';
import { emptyProfile } from '../store.mjs';
import { inspectProviders, providerById } from '../agents.mjs';
import { createSandbox } from './sandbox.mjs';
import { createSandboxBrowser } from './browser.mjs';
import { controlledAgent, profileFixtureAgent } from './agent.mjs';
import { scenarios, personaById, jobById, portalById, expectedFor } from './corpus.mjs';
import { personas as profilePersonas, simulatedCandidate, scoreRun } from '../benchmarks/profile-bench.mjs';
import { scoreScenario, aggregate, markdownReport, compareToBaseline } from './score.mjs';

const option = (argv, name) => { const index = argv.indexOf('--' + name); return index < 0 ? null : argv[index + 1]; };
const has = (argv, name) => argv.includes('--' + name);

export const profileScenarios = profilePersonas.map(persona => ({ id: 'profile-' + persona.id, family: 'profile', persona: persona.id }));

async function post(base, token, endpoint, data = {}) {
  const response = await fetch(base + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-plainhand-token': token }, body: JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${endpoint}: ${result.error || response.status}`);
  return result;
}

async function runTask(app, base, kind, jobId) {
  const { taskId } = await post(base, app.token, 'tasks', { kind, ...(jobId ? { jobId } : {}) });
  await app.workflow.queue;
  const task = (await app.workspace.load()).tasks.find(item => item.id === taskId);
  if (!task || task.status !== 'complete') throw new Error(`${kind}: ${task?.message || 'task did not finish'}`);
  return task;
}

async function runProfileConversation(app, personaId, maxTurns = 10) {
  const persona = profilePersonas.find(item => item.id === personaId);
  if (!persona) throw new Error(`Unknown profile persona: ${personaId}`);
  const started = Date.now();
  const candidate = simulatedCandidate(persona);
  const candidateMessages = [], turns = [], updates = [], actionsRun = [];
  let message = 'Help me build my profile.';
  for (let i = 0; i < maxTurns; i++) {
    if (i > 0) {
      const answer = candidate.reply(turns.at(-1).say);
      turns.at(-1).onTopic = answer.onTopic;
      if (answer.done) break;
      message = answer.text;
    }
    candidateMessages.push(message);
    const turnStarted = Date.now();
    const { turnId } = await app.agent.message(message);
    await app.agent.running;
    const history = await app.agent.history({ limit: 200 });
    const reply = history.messages.filter(item => item.turnId === turnId && item.role === 'assistant').at(-1);
    const turn = { say: reply?.text || '', status: reply?.status || 'missing', actions: [], onTopic: false, ms: Date.now() - turnStarted };
    const proposal = reply?.proposalId && history.proposals.find(item => item.id === reply.proposalId);
    if (proposal?.status === 'pending') {
      turn.actions = proposal.actions.map(action => action.name);
      actionsRun.push(...turn.actions);
      for (const action of proposal.actions) if (action.name === 'profile.update') for (const [field, value] of Object.entries(action.input || {})) updates.push({ field, value: String(value) });
      await app.agent.confirm({ proposalId: proposal.id, accept: true });
      await app.workflow.queue;
    }
    turns.push(turn);
  }
  const after = await app.workspace.load();
  const saved = after.conversation.filter(item => item.role === 'user' && item.via === 'assistant').map(item => item.text);
  const usage = await app.workflow.usage.summary(after);
  const scored = scoreRun({ persona, candidateMessages, saved, updates, turns, revealed: candidate.said, detailsRevealed: candidate.detailed });
  return {
    ...scored,
    actions: actionsRun,
    transcript: turns.map((turn, i) => ({ candidate: candidateMessages[i], assistant: turn.say, actions: turn.actions })),
    saved,
    calls: usage.totals.calls,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    pass: scored.revealed > 0 && scored.captured === scored.revealed && scored.coverageOfAllFacts >= 0.66 && scored.failedTurns === 0 && scored.notVerbatim === 0 && scored.unsupportedUpdates.length === 0 && scored.absentClaimsSaved.length === 0,
  };
}

async function runProfileScenario(scenario, { live, provider }) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-eval-profile-'));
  const started = Date.now();
  const persona = profilePersonas.find(item => item.id === scenario.persona);
  let app;
  try {
    app = await createPlainhand({ root, startFeatures: false, ...(live ? { providers: inspectProviders } : { workflowOptions: { agent: profileFixtureAgent() } }) });
    const state = await app.workspace.load();
    await app.workspace.saveProfile({ ...emptyProfile(), ...persona.profile }, state.revision);
    await app.workspace.mutate(s => { s.provider = live ? provider : 'codex'; });
    const profile = await runProfileConversation(app, scenario.persona);
    const usage = await app.workflow.usage.summary(await app.workspace.load());
    return {
      scenario: { ...scenario, job: null, portal: null },
      persona: persona.id,
      profile,
      usage: { calls: usage.totals.calls, inputTokens: usage.totals.inputTokens.value, outputTokens: usage.totals.outputTokens.value },
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return { scenario: { ...scenario, job: null, portal: null }, persona: scenario.persona, error: error.message, durationMs: Date.now() - started };
  } finally {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

// The simulated candidate answers a question the app asked about a field only when
// the fictional ground truth settles it; anything else stays the app's stop.
function candidateAnswerFor(planField, portal, persona, job) {
  const field = (portal?.steps?.flat() || []).find(item => item.name === planField?.name);
  if (!field || field.sensitive) return null;
  const expected = expectedFor(field, persona, job);
  if (expected.kind === 'exact' && expected.value) {
    if (planField.options?.length && !planField.options.some(option => option.value === expected.value)) return null;
    return String(expected.value);
  }
  if (expected.kind === 'fact' && expected.text) return expected.text;
  if (expected.kind === 'anyOf' && expected.texts[0]) return expected.texts[0];
  return null;
}

function candidatePayload(scenario, persona, browser, job, pdf, cover, candidateDom = {}) {
  const portal = portalById(scenario.portal);
  const merged = {};
  for (const snapshot of browser.snapshots) for (const [name, entry] of Object.entries(snapshot.values || {})) merged[name] = entry;
  const fields = {};
  for (const [name, entry] of Object.entries(merged)) {
    if (!entry.value && !entry.file) continue;
    fields[name] = { value: entry.value || '', source: 'app' };
  }
  for (const field of portal.steps.flat()) {
    const answer = persona.candidateAnswers?.[field.name];
    if (answer === undefined) continue;
    const fallback = typeof answer === 'boolean' ? (answer ? 'on' : '') : String(answer);
    fields[field.name] = { value: candidateDom[field.name]?.value || fallback, source: 'candidate' };
  }
  const resumeField = fields.resume || (fields.resume = { value: '', source: 'app' });
  resumeField.file = { name: path.basename(job.pdf), base64: pdf.bytes.toString('base64'), sha256: pdf.sha };
  if (cover && fields.cover) fields.cover.file = { name: path.basename(cover.path), base64: cover.bytes.toString('base64'), sha256: cover.sha };
  return { scenarioId: scenario.id, candidateConfirmed: true, fields };
}

async function runApplicationScenario(scenario, { live, provider, retain }) {
  const persona = personaById(scenario.persona);
  const jobSpec = jobById(scenario.job);
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-eval-'));
  const started = Date.now();
  const sandbox = scenario.portal ? await createSandbox({ scenario }) : null;
  const browser = scenario.portal ? createSandboxBrowser({ scenario }) : null;
  let app;
  let profileResult = null;
  let understandingApproved = false;
  let standardApproved = false;
  let evaluationResult = null;
  let packetResult = null;
  try {
    const workflowOptions = {
      verifier: async () => ({ state: 'active', legitimacy: 'owned-sandbox', description: jobSpec.description, checkedAt: new Date().toISOString(), reason: 'Owned evaluation sandbox; no employer was contacted.' }),
      ...(live ? {} : { agent: controlledAgent({ scenario, persona, job: jobSpec }) }),
    };
    app = await createPlainhand({ root, ...(browser ? { browser: browser.application } : {}), workflowOptions, startFeatures: false });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const initialProfile = { ...emptyProfile(), ...(scenario.family === 'journey' ? persona.seedProfile : persona.profile) };
    const state = await app.workspace.load();
    await app.workspace.saveProfile(initialProfile, state.revision);
    await app.workspace.mutate(latest => { latest.provider = live ? provider : 'codex'; });

    if (scenario.family === 'journey') {
      profileResult = await runProfileConversation(app, persona.id);
      await runTask(app, base, 'interview');
      await post(base, app.token, 'understanding/approve', {});
      await runTask(app, base, 'standard');
      await post(base, app.token, 'standard/approve', {});
      const afterPrepState = await app.workspace.load();
      understandingApproved = Boolean(afterPrepState.understanding?.approved);
      standardApproved = Boolean(afterPrepState.standard?.approvedAt);
    }

    const { id } = await post(base, app.token, 'jobs', { company: jobSpec.company, title: jobSpec.title, url: `https://jobs.lever.co/synthetic/${scenario.id}`, description: jobSpec.description, location: jobSpec.location });
    await runTask(app, base, 'evaluate', id);
    const afterEval = await app.workspace.load();
    const evaluatedJob = afterEval.jobs.find(j => j.id === id);
    const evalSources = (await app.workspace.context(afterEval)).sources;
    evaluationResult = { evaluation: evaluatedJob.evaluation, sources: evalSources, prepareRefusedWithoutOverride: null };

    if (scenario.family === 'evaluation') {
      try {
        // Selecting also refuses a below-4/5 role without an override, so it sits
        // inside the same guard probe as prepare.
        await post(base, app.token, 'jobs/update', { id, selected: true });
        await runTask(app, base, 'prepare', id);
        evaluationResult.prepareRefusedWithoutOverride = false;
      } catch (err) {
        evaluationResult.prepareRefusedWithoutOverride = /scored below 4\/5/i.test(err.message);
      }
      const usage = await app.workflow.usage.summary(await app.workspace.load());
      return {
        scenario,
        persona: persona.id,
        job: jobSpec.id,
        evaluation: evaluationResult,
        durationMs: Date.now() - started,
        usage: { calls: usage.totals.calls, inputTokens: usage.totals.inputTokens.value, outputTokens: usage.totals.outputTokens.value },
      };
    }

    const needsOverride = (evaluatedJob.evaluation?.score ?? 5) < 4;
    await post(base, app.token, 'jobs/update', {
      id,
      selected: true,
      ...(needsOverride ? { overrideReason: 'Evaluation harness: proceeding to test packet and application stages.' } : {}),
    });
    await runTask(app, base, 'prepare', id);
    // When the app asks a role question, the candidate answers it as in the product:
    // save role answers, re-evaluate on the changed context, then prepare again.
    let packetQuestionsAsked = (await app.workspace.load()).jobs.find(job => job.id === id).packet?.questions || [];
    if (packetQuestionsAsked.length && persona.roleAnswers) {
      await post(base, app.token, 'jobs/update', { id, roleAnswers: persona.roleAnswers });
      await runTask(app, base, 'evaluate', id);
      const reevaluated = (await app.workspace.load()).jobs.find(job => job.id === id);
      evaluationResult.reevaluatedScore = reevaluated.evaluation?.score ?? null;
      if ((reevaluated.evaluation?.score ?? 5) < 4 && !reevaluated.overrideReason) await post(base, app.token, 'jobs/update', { id, overrideReason: 'Evaluation harness: proceeding to test packet and application stages.' });
      await runTask(app, base, 'prepare', id);
    }
    await post(base, app.token, 'packet/approve', { id });
    const prepared = (await app.workspace.load()).jobs.find(job => job.id === id);
    const sources = (await app.workspace.context(await app.workspace.load())).sources;
    const pdfBytes = await app.workspace.readBinary(prepared.pdf);
    const pdf = { bytes: pdfBytes, sha: createHash('sha256').update(pdfBytes).digest('hex'), head: pdfBytes.subarray(0, 5).toString() };
    const coverPath = (prepared.artifacts || []).find(file => /cover-letter.*\.pdf$/.test(file));
    const coverBytes = coverPath ? await app.workspace.readBinary(coverPath) : null;
    const cover = coverBytes ? { path: coverPath, bytes: coverBytes, sha: createHash('sha256').update(coverBytes).digest('hex') } : null;
    packetResult = { packetQuestionsAsked, roleAnswered: Boolean(packetQuestionsAsked.length && persona.roleAnswers), packet: prepared.packet, sources, review: prepared.review, calibration: prepared.calibration, pdf, coverSha: cover?.sha || null };

    if (scenario.family === 'resume') {
      const usage = await app.workflow.usage.summary(await app.workspace.load());
      return {
        scenario,
        persona: persona.id,
        job: jobSpec.id,
        evaluation: evaluationResult,
        packet: packetResult,
        durationMs: Date.now() - started,
        usage: { calls: usage.totals.calls, inputTokens: usage.totals.inputTokens.value, outputTokens: usage.totals.outputTokens.value },
      };
    }

    const portal = portalById(scenario.portal);
    let discardDetected = false;
    let plan = await post(base, app.token, 'browser/autofill', { id });
    const firstPassJob = (await app.workspace.load()).jobs.find(j => j.id === id);
    const firstSnapshot = browser.snapshots[0]?.values || {};
    if (firstPassJob?.browserCheckpoint?.result?.failed?.length > 0 && plan.observation?.state === 'needs-answers' && !firstSnapshot.name?.value) {
      discardDetected = true;
      plan = await post(base, app.token, 'browser/autofill', { id });
    }
    // The app holds the whole fill while it has questions; a candidate answers them
    // in review and the reviewed answers are filled in one step, as in the product.
    const candidateAnswered = {};
    if (portal.expect.submit && !portal.expect.stop && plan.observation?.state === 'ready' && plan.questions?.length) {
      const replies = plan.questions.map(question => {
        const planField = (plan.fields || []).find(field => field.key === question.key);
        return { question, planField, value: candidateAnswerFor(planField, portal, persona, jobSpec) };
      });
      if (replies.every(reply => reply.value !== null)) {
        const answers = { ...plan.answers };
        for (const reply of replies) { answers[reply.question.key] = reply.value; candidateAnswered[reply.planField.name] = reply.value; }
        await post(base, app.token, 'browser/fill', { id, answers });
      }
    }
    const finalJob = (await app.workspace.load()).jobs.find(j => j.id === id);
    let submission = null;
    if (portal.expect.submit) {
      const candidateDom = await browser.fillAsCandidate(persona.candidateAnswers || {});
      const payload = candidatePayload(scenario, persona, browser, finalJob, pdf, cover, candidateDom);
      const res = await fetch(sandbox.url + '/api/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      submission = await res.json();
      if (submission.ok) await post(base, app.token, 'jobs/update', { id, status: 'Applied', confirmSubmitted: true });
    }
    const confirmed = (await app.workspace.load()).jobs.find(job => job.id === id);
    const application = {
      scenario,
      snapshots: browser.snapshots,
      plan,
      checkpoint: finalJob.browserCheckpoint,
      submission: submission ? { ok: submission.ok, errors: submission.errors || [], receipt: submission.receipt || null } : null,
      trackerStatus: confirmed.status,
      submittedAt: confirmed.submittedAt || null,
      pdfSha: pdf.sha,
      coverSha: cover?.sha || null,
      discardDetected,
      candidateAnswered,
      readback: await browser.readValues(),
    };
    const usage = await app.workflow.usage.summary(await app.workspace.load());
    return {
      scenario,
      persona: persona.id,
      job: jobSpec.id,
      profile: profileResult,
      understandingApproved,
      standardApproved,
      evaluation: evaluationResult,
      packet: packetResult,
      application,
      usage: { calls: usage.totals.calls, inputTokens: usage.totals.inputTokens.value, outputTokens: usage.totals.outputTokens.value },
      durationMs: Date.now() - started,
      retainedWorkspace: retain ? root : null,
    };
  } catch (error) {
    const state = app ? await app.workspace.load().catch(() => null) : null;
    const usage = state ? await app.workflow.usage.summary(state).catch(() => null) : null;
    // A blocked packet keeps the reviewer's findings and open questions so the cause is visible.
    const failedJob = state?.jobs?.find(job => job.company === jobSpec.company && job.title === jobSpec.title);
    const blocked = failedJob ? {
      stage: failedJob.stage || null,
      evaluationQuestions: failedJob.evaluation?.questions || [],
      packetQuestions: failedJob.packet?.questions || [],
      reviewAttempts: (failedJob.reviewAttempts || []).map(item => ({ attempt: item.attempt, passed: item.passed, issues: item.issues })),
    } : null;
    return {
      blocked,
      scenario,
      persona: scenario.persona,
      job: scenario.job,
      profile: profileResult,
      understandingApproved,
      standardApproved,
      evaluation: evaluationResult,
      packet: packetResult,
      usage: usage ? { calls: usage.totals.calls, inputTokens: usage.totals.inputTokens.value, outputTokens: usage.totals.outputTokens.value } : null,
      error: error.message,
      durationMs: Date.now() - started,
    };
  } finally {
    await browser?.application.closeAll().catch(() => {});
    await app?.close().catch(() => {});
    await sandbox?.close().catch(() => {});
    if (!retain) await rm(root, { recursive: true, force: true });
  }
}

async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runEvaluation(argv = process.argv.slice(2)) {
  const provider = option(argv, 'provider');
  const live = Boolean(provider);
  if (provider) providerById(provider);
  const requested = option(argv, 'scenarios');
  const only = requested ? new Set(requested.split(',').map(item => item.trim()).filter(Boolean)) : null;
  const selectedProfiles = option(argv, 'profiles');
  const profileOnly = selectedProfiles ? new Set(selectedProfiles.split(',')) : null;
  const all = [...profileScenarios, ...scenarios].filter(item => (!only || only.has(item.id)) && (!profileOnly || item.family !== 'profile' || profileOnly.has(item.persona)));
  if (!all.length) throw new Error('No scenarios selected.');
  const concurrency = Math.max(1, Number(option(argv, 'concurrency') || 2));
  const repeat = Math.max(1, Number(option(argv, 'repeat') || 1));
  const retain = has(argv, 'retain');
  const out = option(argv, 'out') || path.join('output', `evaluation-${live ? provider : 'controlled'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(out, { recursive: true });
  const scheduled = all.flatMap(scenario => Array.from({ length: repeat }, (_, index) => repeat > 1 ? { ...scenario, id: `${scenario.id}-r${index + 1}`, baseId: scenario.id } : scenario));

  const results = await mapLimit(scheduled, concurrency, async scenario => {
    const result = scenario.family === 'profile' ? await runProfileScenario(scenario, { live, provider }) : await runApplicationScenario(scenario, { live, provider, retain });
    const scored = scoreScenario({ ...result, scenario });
    await writeFile(path.join(out, `${scenario.id}.json`), JSON.stringify(scored, null, 2));
    // Failures keep the raw fill plan, checkpoint and page snapshots so the cause can be traced.
    if (!scored.pass && result.application) {
      const { plan, checkpoint, snapshots, readback } = result.application;
      await writeFile(path.join(out, `${scenario.id}.trace.json`), JSON.stringify({ plan, checkpoint, snapshots, readback }, null, 2));
    }
    console.log(`${scored.pass ? 'PASS' : 'FAIL'} ${scenario.id}${result.error ? ': ' + result.error : ''}`);
    return scored;
  });

  const summary = aggregate(results);
  const baselinePath = option(argv, 'baseline');
  let comparison = null;
  if (baselinePath) {
    const resolved = baselinePath.endsWith('.json') ? baselinePath : path.join(baselinePath, 'results.json');
    const baseline = JSON.parse(await readFile(resolved, 'utf8'));
    comparison = compareToBaseline(summary, baseline, results);
  }
  const report = { date: new Date().toISOString(), provider: provider || 'controlled', live, evidenceTier: live ? 'real CLI on fictional candidates and owned sandbox' : 'deterministic harness proof on fictional candidates and owned sandbox', concurrency, summary, comparison, results };
  await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(out, 'SUMMARY.md'), markdownReport({ evidenceTier: report.evidenceTier, provider: report.provider, summary, results, comparison }));
  console.log(`\n${summary.passed}/${summary.scenarios} scenarios passed`);
  console.log('Evidence: ' + out);
  return { out, report };
}
