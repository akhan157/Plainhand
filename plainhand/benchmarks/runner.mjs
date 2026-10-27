import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApplicationBrowser } from '../jobs.mjs';
import { isSensitiveLabel } from '../field-policy.mjs';
import { Workspace, emptyProfile, digest, hasEvidence } from '../store.mjs';
import { Workflow, suggestFormAnswers } from '../workflow.mjs';
import { executeAgent, FORM_INSTRUCTION } from '../agents.mjs';
import { typedPreparation } from './typed-preparation.mjs';
import { nativeChoices, fillNativeChoices } from './native-choices.mjs';
import { pageHtml, oraclePacket, oracleForm } from './cases.mjs';

export const strategies = ['packet-first', 'form-first', 'durable-hybrid', 'focused-hybrid', 'gated-form-first', 'semantic-hybrid', 'contract-hybrid', 'typed-actor'];
const protectedField = f => isSensitiveLabel(f.label);
const identity = f => JSON.stringify([f.name, f.label, f.type, f.sectionContext, f.options]);
const packetFields = `The actual observed form fields are supplied in observedFields. Include an answer entry for every non-sensitive field answerable from the candidate sources, including native selects and repeated records. Each such answer must carry fieldKey equal to its observed field key and question equal to its exact label. All choice fields, including select-one and radio, use an actual option value. Record indices refer to distinct source records in newest-first order. Do not invent missing facts or legal choices. The resume and cover letter still need to represent the candidate's actual background, not just the form questions. For an unknown portal fact, omit the answer; the form planning step will ask the candidate. Do not make optional missing portal facts block preparation of otherwise complete documents.`;

function focusedContext(context, fields) {
  // Deliberately modest retrieval: preserve all identity/voice data and keep
  // source paragraphs matching the job/form vocabulary. Review sees full context.
  const terms = new Set(fields.flatMap(f => `${f.label} ${f.sectionContext?.label || ''}`.toLowerCase().split(/\W+/)).filter(t => t.length > 3));
  const sources = context.sources.map(source => {
    if (!['cv', 'proof-points', 'stories'].includes(source.id)) return source;
    const paragraphs = source.text.split(/\n\s*\n/);
    const selected = paragraphs.filter(text => /employment|education|achievement/i.test(text) || [...terms].some(t => text.toLowerCase().includes(t)));
    return { ...source, text: selected.join('\n\n') || (source.id === 'cv' ? source.text : '') };
  });
  return { ...context, sources: sources.filter(s => s.text) };
}
function boundPacketAnswers(packet, initial, current, context) {
  const answers = {};
  for (const answer of packet.answers) {
    const old = initial.find(f => f.key === answer.fieldKey);
    if (!old || !hasEvidence(answer, context)) continue;
    const field = current.find(f => identity(f) === identity(old));
    if (!field || protectedField(field) || field.type === 'file' || typeof answer.answer !== 'string') continue;
    if (['select-one', 'radio'].includes(field.type) && !field.options.some(o => o.value === answer.answer)) continue;
    answers[field.key] = answer.answer;
  }
  return answers;
}
export class AnswerMemory {
  constructor(workspace) { this.workspace = workspace; this.file = 'data/plainhand/benchmark-answer-memory.json'; }
  async get(fields, context, job) {
    const raw = await this.workspace.read(this.file), saved = raw ? JSON.parse(raw) : [];
    const answers = {};
    for (const field of fields) {
      const item = saved.find(a => a.sourceHash === context.hash && a.job === job.id && a.field === identity(field));
      if (item && hasEvidence(item, context)) answers[field.key] = item.answer;
    }
    return answers;
  }
  async put(fields, suggestions, context, job) {
    const raw = await this.workspace.read(this.file), saved = raw ? JSON.parse(raw) : [];
    for (const suggestion of suggestions) {
      const field = fields.find(f => f.key === suggestion.key);
      if (!field || protectedField(field) || !hasEvidence(suggestion, context)) continue;
      const item = { sourceHash: context.hash, job: job.id, field: identity(field), answer: suggestion.answer, evidence: suggestion.evidence };
      const index = saved.findIndex(a => a.job === item.job && a.field === item.field);
      if (index < 0) saved.push(item); else saved[index] = item;
    }
    await this.workspace.write(this.file, JSON.stringify(saved));
  }
}
async function browserFixture(spec, profile, storage) {
  let page;
  const runtime = new ApplicationBrowser({ storage, solver: spec.recoverableCheck ? { ready: async () => true, solve: async page => { await page.evaluate(() => { document.querySelector('[data-plainhand-challenge]').remove(); document.querySelector('#after-check').hidden = false; }); return { state: 'solved', message: 'Deterministic verification fixture, not a real CAPTCHA solver.' }; } } : null, launch: async options => {
    const browser = await chromium.launch({ ...options, headless: true }), createContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await createContext(options), createPage = context.newPage.bind(context);
      context.newPage = async () => {
        page = await createPage();
        await page.route('https://jobs.lever.co/**', route => route.request().method() === 'GET' ? route.fulfill({ contentType: 'text/html', body: pageHtml(spec, profile, spec.longForm ? Number(new URL(route.request().url()).pathname.match(/\/step(\d+)$/)?.[1] || 1) : route.request().url().endsWith('/second')) }) : route.abort());
        return page;
      };
      return context;
    };
    return browser;
  } });
  return { runtime, get page() { return page; } };
}
export async function runCase({ strategy, spec, profile, provider = 'claude', live = false, retain = false }) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-architecture-'));
  const workspace = new Workspace(root), memory = new AnswerMemory(workspace);
  const durable = ['durable-hybrid', 'focused-hybrid', 'semantic-hybrid', 'contract-hybrid', 'typed-actor'].includes(strategy);
  const report = { strategy, case: spec.id, family: spec.family, profile: profile.name, provider: live ? provider : 'deterministic-test-agent', evidenceTier: live ? 'real-CLI-on-fictional-employer' : 'controlled-policy-browser', calls: [], events: [], success: false, ready: false, automatedSubmissions: 0 };
  const started = Date.now(); let browser, workflow;
  const { proofPoints, ...profileData } = profile;
  const suppliedProfile = { ...emptyProfile(), ...profileData };
  try {
    if (proofPoints) await workspace.write('article-digest.md', proofPoints);
    await workspace.mutate(state => { state.provider = provider; state.profile = suppliedProfile; });
    const context = await workspace.context(await workspace.load());
    const job = { id: 'benchmark-job', createdAt: new Date().toISOString(), title: profile.roles, company: 'Fictional Employer', url: 'https://jobs.lever.co/synthetic/' + spec.id, description: `Fictional ${profile.roles} role. We value concrete achievements, relevant experience and clear communication. Explain how your existing work relates to this position. No invented qualifications.`, selected: true, evaluation: { score: 4.5 }, verification: { state: 'active', legitimacy: 'synthetic-fixture' }, status: 'Evaluated', contextHash: context.hash, reportPath: 'reports/benchmark.md' };
    await workspace.write(job.reportPath, '**PDF:** pending\n');
    browser = await browserFixture(spec, suppliedProfile, workspace);
    const inspectFields = async () => {
      const fields = await browser.runtime.inspect(job);
      return ['semantic-hybrid', 'contract-hybrid', 'typed-actor'].includes(strategy) ? [...fields, ...await nativeChoices(browser.page)] : fields;
    };
    let initialFields = [];
    if (strategy !== 'packet-first') { await browser.runtime.open(job, true); initialFields = await inspectFields(); }
    const agent = async (id, instruction, data, options) => {
      const draft = instruction.includes('Prepare a truthful application');
      const form = instruction.includes('Draft answers for these actual');
      if (['contract-hybrid', 'typed-actor'].includes(strategy)) {
        instruction += '\nQuestions are blockers only when a required answer cannot be truthfully supplied from the available sources. Do not ask optional improvement questions when an adequate grounded answer already exists. For an achievement question, a documented action and result are enough; do not require additional mechanisms. Do not calculate new percentages or infer years of experience, leadership, team size or unstated causal mechanisms. Preserve the original source numbers. Any invented fact remains a blocker. Native choice values and fieldKey are control metadata; use supplied observedFields to interpret their labels.';
        data = { ...data, observedFields: initialFields };
      }
      const observedFields = strategy !== 'packet-first' ? initialFields : [];
      if (draft && strategy !== 'packet-first') { instruction += '\n' + packetFields; data = { ...data, observedFields }; }
      if (strategy === 'focused-hybrid' && (draft || form)) data = { ...data, context: focusedContext(data.context, form ? data.fields : observedFields) };
      if (report.calls.length >= 10) throw new Error('Shared ten-call reasoning budget reached.');
      report.calls.push({ purpose: draft ? 'packet' : form ? 'form' : 'review', contextCharacters: JSON.stringify(data).length });
      if (live) return executeAgent(id, instruction, data, options);
      if (draft) { const packet = oraclePacket(suppliedProfile, observedFields); if (strategy === 'typed-actor') packet.missingRequired = oracleForm(suppliedProfile, observedFields).questions.filter(q => observedFields.some(f => f.key === q.key && f.required)).map(q => ({ fieldKey: q.key, question: q.question })); return packet; }
      if (form) return oracleForm(suppliedProfile, data.fields);
      return { passed: true, issues: [] };
    };
    workflow = new Workflow(workspace, { agent, renderer: async () => {
      const pdf = 'output/benchmark.pdf'; await workspace.write(pdf, '%PDF-1.4\nSame renderer fixture for every candidate.');
      return { pdf, pdfHash: digest('%PDF-1.4\nSame renderer fixture for every candidate.'), artifacts: [pdf] };
    } });
    await workspace.mutate(state => state.jobs.push(job));
    let task;
    if (strategy === 'typed-actor') {
      const preparation = await typedPreparation({ workflow, provider, context, job, fields: initialFields });
      report.reviewAttempts = preparation.reviews;
      if (preparation.state === 'needs-input') { report.stop = 'needs-answers'; report.questions = preparation.questions; }
      else if (preparation.state !== 'reviewed') { report.stop = 'needs-review'; }
      await workspace.mutate(state => Object.assign(state.jobs[0], { packet: preparation.packet, review: preparation.review || { passed: false, issues: preparation.reviews.flatMap(r => r.issues) }, reviewAttempts: preparation.reviews }));
      if (preparation.state === 'reviewed') await workspace.write('output/benchmark.pdf', '%PDF-1.4\nSame renderer fixture for every candidate.');
      task = { status: 'complete', outcome: preparation.state };
    } else {
      const taskId = await workflow.enqueue('prepare', job.id); await workflow.queue;
      task = (await workspace.load()).tasks.find(t => t.id === taskId);
    }
    let state = await workspace.load();
    report.preparationTask = task; report.reviewAttempts = state.jobs[0].reviewAttempts;
    if (task.status !== 'complete') throw new Error('Packet preparation failed: ' + task.message);
    const packetJob = state.jobs[0], packet = packetJob.packet;
    report.packet = packet; report.review = packetJob.review;
    if (packet.questions.length) { report.stop = 'needs-answers'; report.questions = packet.questions; }
    let fields = strategy === 'packet-first' ? await browser.runtime.open(job, true) : await inspectFields();
    let recoveryAttempted = false, repairAttempts = 0, challengeAttempted = false;
    for (let step = 0; step < (durable ? 20 : 6) && !report.stop; step++) {
      const status = await browser.runtime.status(job.id);
      if (status.state === 'challenge' && durable && !challengeAttempted) {
        challengeAttempted = true;
        const resolved = await browser.runtime.resolveChallenge(job);
        report.events.push({ verification: resolved });
        if (resolved.state === 'ready') { fields = await inspectFields(); continue; }
      }
      if (['challenge', 'login'].includes(status.state)) { report.stop = status.state; break; }
      if (status.state !== 'ready') { report.stop = status.state; break; }
      let answers = suggestFormAnswers(fields, suppliedProfile, packet);
      if (strategy !== 'packet-first') Object.assign(answers, boundPacketAnswers(packet, initialFields, fields, context));
      if (durable) Object.assign(answers, await memory.get(fields, context, job));
      const unanswered = fields.filter(f => !answers[f.key] && f.type !== 'file' && !protectedField(f));
      if (unanswered.length) {
        const suggestions = await workflow.agent(provider, FORM_INSTRUCTION, { context, job, packet, fields: unanswered }, { usageContext: { jobId: job.id, purpose: 'form-answers' } });
        report.formSuggestions ||= []; report.formSuggestions.push(...suggestions.suggestions);
        const valid = suggestions.suggestions.filter(s => unanswered.some(f => f.key === s.key) && hasEvidence(s, context) && typeof s.answer === 'string');
        for (const suggestion of valid) {
          const field = unanswered.find(f => f.key === suggestion.key);
          if (!['select-one', 'radio'].includes(field.type) || field.options.some(o => o.value === suggestion.answer)) answers[field.key] = suggestion.answer;
        }
        if (durable) await memory.put(fields, valid, context, job);
        const questions = (suggestions.questions || []).filter(q => unanswered.some(f => f.key === q.key) && typeof q.question === 'string');
        const blockers = questions.filter(q => unanswered.some(f => f.key === q.key && f.required) && !answers[q.key]);
        report.nonBlockingQuestions = questions.filter(q => !blockers.includes(q));
        if (blockers.length) { report.stop = 'needs-answers'; report.questions = blockers; break; }
      }
      const fill = await browser.runtime.fill(job, answers, await workspace.safe('output/benchmark.pdf'));
      if (['semantic-hybrid', 'contract-hybrid', 'typed-actor'].includes(strategy)) {
        const choices = await fillNativeChoices(browser.page, fields, answers);
        for (const key of ['filled', 'skipped', 'failed']) fill[key].push(...choices[key]);
      }
      report.events.push({ step, fill });
      if (fill.failed.length || fill.validation.length) {
        if (durable && repairAttempts++ < 1) { fields = await inspectFields(); continue; }
        report.stop = 'needs-answers'; break;
      }
      await workspace.write('data/plainhand/benchmark-actor.json', JSON.stringify({ url: browser.page.url(), sourceHash: context.hash, state: 'filled', step }));
      if (fill.formChanged) { fields = await inspectFields(); continue; }
      const next = await browser.runtime.advance(job);
      if (!next.advanced) {
        if (next.state === 'review') {
          // Current production path returns review when there is no next control.
          // Hybrid candidates add an explicit required-field readiness gate.
          const missing = durable || strategy === 'gated-form-first' ? await browser.page.locator('input:visible:invalid,textarea:visible:invalid,select:visible:invalid,[aria-invalid="true"]:visible').count() : 0;
          report.stop = missing ? 'needs-answers' : 'review'; report.ready = !missing;
        } else report.stop = next.state;
        break;
      }
      if (spec.crash && !recoveryAttempted) {
        recoveryAttempted = true;
        const lastUrl = browser.page.url();
        await workspace.write('data/plainhand/benchmark-actor.json', JSON.stringify({ url: lastUrl, sourceHash: context.hash, state: 'advanced', step }));
        await browser.runtime.closeAll();
        if (!durable) { report.stop = 'interrupted'; break; }
        // A fresh browser/process and freshly read durable state, not DOM replay.
        browser = await browserFixture(spec, suppliedProfile, workspace);
        const checkpoint = JSON.parse(await workspace.read('data/plainhand/benchmark-actor.json'));
        if (checkpoint.sourceHash !== context.hash) { report.stop = 'stale-context'; break; }
        report.events.push({ recovery: 'new-browser-reconciled', url: checkpoint.url });
        fields = await browser.runtime.open({ ...job, url: checkpoint.url }, true);
      } else fields = await inspectFields();
    }
    report.stop ||= 'bounded-limit';
    const readback = await browser.page.locator('input:not([type=password]):not([type=file]):not([type=checkbox]):not([type=radio]),input[type=radio]:checked,textarea,select').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.name, n.value]))).catch(() => ({}));
    report.readback = readback;
    report.automatedSubmissions = await browser.page.evaluate(() => window.submits || 0).catch(() => 0);
    const expected = spec.expected(suppliedProfile);
    const correctValues = Object.entries(expected).every(([name, value]) => name === 'database' ? /\bSQLite\b/i.test(readback[name] || '') && !/\b(?:not|unknown|PostgreSQL|MySQL)\b/i.test(readback[name] || '') : readback[name] === value);
    const essay = readback.achievement || '';
    const achievement = suppliedProfile.resume.match(/Achievement: (.*?)(?: Highest degree:)/)[1];
    const project = achievement.match(/Atlas|Beacon|Cedar/)[0];
    report.correctFields = correctValues;
    if (spec.id === 'implicit-retrieval') report.databaseProvenance = [...packet.answers, ...report.formSuggestions || []].some(answer => /\bSQLite\b/i.test(answer.answer || '') && answer.evidence?.some(e => e.quote.includes('SQLite') && context.sources.some(source => source.id === e.sourceId && source.text.includes(e.quote))));
    report.voiceProxy = spec.essay ? { firstPerson: /\bI\b/.test(essay), concreteProject: essay.includes(project), bannedPhrase: /passionate|leverage|cutting.edge/i.test(essay), words: essay.split(/\s+/).filter(Boolean).length } : null;
    const essayOK = !spec.essay || report.voiceProxy.firstPerson && report.voiceProxy.concreteProject && !report.voiceProxy.bannedPhrase && report.voiceProxy.words <= 100;
    report.requiredMissing = await browser.page.locator('input:visible:invalid,textarea:visible:invalid,select:visible:invalid').count().catch(() => 0);
    report.falseReady = report.ready && (!correctValues || !essayOK || report.requiredMissing > 0 && !spec.finalChoice);
    report.plannedHumanChoices = !!spec.finalChoice;
    report.success = report.automatedSubmissions === 0 && (spec.finalChoice ? correctValues && ['review', 'needs-answers'].includes(report.stop) : spec.expectedStop ? report.stop === spec.expectedStop && !report.ready : report.ready && correctValues && essayOK && !report.requiredMissing && report.databaseProvenance !== false);
    report.usage = await workflow.usage.summary(await workspace.load());
    report.durationMs = Date.now() - started;
    if (retain) report.workspace = root;
  } catch (error) { report.error = error.message; report.stop = 'error'; report.durationMs = Date.now() - started; }
  finally { if (workflow) report.usage ||= await workflow.usage.summary(await workspace.load()); await browser?.runtime.closeAll(); if (!retain) await rm(root, { recursive: true, force: true }); }
  return report;
}
