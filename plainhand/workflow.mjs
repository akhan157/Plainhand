import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import yaml from 'js-yaml';
import { digest, hasEvidence, now, syncTracker, requireText } from './store.mjs';
import { executeAgent, INTERVIEW_INSTRUCTION, EVALUATE_INSTRUCTION, PACKET_INSTRUCTION, REVIEW_INSTRUCTION, STANDARD_INSTRUCTION } from './agents.mjs';
import { discover, verifyJob, defaultFieldAnswers, isSensitiveLabel } from './jobs.mjs';
import { UsageLedger } from './usage.mjs';
import { AnswerBank } from './answer-bank.mjs';
import { providerJob } from './application-record.mjs';
import { integrityRecord, providerDescription } from './posting-integrity.mjs';
import { logUnderstanding } from './profile-strength.mjs';
import { gradePacket } from './claim-calibration.mjs';
import { lineInput, candidateLine, markApplied } from './claim-line.mjs';
import { STANDARD_JOB, standardInput, compareToStandard, autoPrepareDecision, masterCoverage, roleOrderOf } from './standard.mjs';
import { HUMANIZE_INSTRUCTION, humanizeItems, applyHumanized } from './humanize.mjs';
import { atsCheckPdf, extractPdfText } from './ats-check.mjs';
import { DEFAULT_FORMAT, renderResumeHtml, renderLetterHtml, verifyHeadings } from './resume-format.mjs';

export const slug = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'candidate';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = (value, label, limit = 40) => {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`The agent returned invalid ${label}. Retry the task.`);
  return value;
};
const strings = (value, label) => list(value, label).map(v => requireText(v, label, 15000));
function ready(state, fallbackProvider = null) {
  if (!state.provider && !fallbackProvider) throw new Error('Connect and select an agent first.');
  if (!state.profile.name || !state.profile.resume || !state.profile.roles || !state.profile.location) throw new Error('Save your name, resume, target roles, and location in My profile first.');
}
// The fields a task actually changed on its copy of a job. Committing only these keeps
// everything edited while the task ran (record, status history, feature data) intact.
export function taskChanges(before, after) {
  const changes = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) changes[key] = after[key];
  }
  return changes;
}
export function assertPacketFresh(job, context) {
  if (!job?.packet || job.contextHash !== context.hash || job.packetJobHash !== digest([job.url, job.company, job.title, job.description])) throw new Error('This packet needs to be regenerated from the current profile and job.');
}
export function packetIdentity(job) { return digest({ contextHash: job.contextHash, packet: job.packet, pdfHash: job.pdfHash, job: [job.url, job.company, job.title, job.description] }); }

export async function renderPacket(workspace, state, job, packet, { renderDocuments } = {}) {
  const identity = `${slug(state.profile.name)}-${slug(job.company)}-${slug(job.title)}-${now().slice(0, 10)}`;
  const resumeBase = `output/cv-${identity}`;
  const letterBase = `output/cover-letter-${identity}`;
  const answersBase = `output/answers-${identity}`;
  // The candidate's own resume format (plainhand/resume-format.mjs), or the default.
  const format = state.resumeFormat || DEFAULT_FORMAT;
  const html = renderResumeHtml(format, state.profile, packet, job.title);
  const letter = renderLetterHtml(format, state.profile, job, packet.coverLetter);
  await workspace.write(resumeBase + '.html', html);
  await workspace.write(letterBase + '.html', letter);
  let browser;
  let pageCount = 1;
  try {
    if (renderDocuments) {
      const [pdf, cover] = await renderDocuments([html, letter]);
      pageCount = Math.max(1, (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length);
      await workspace.write(resumeBase + '.pdf', pdf);
      await workspace.write(letterBase + '.pdf', cover);
    } else {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent(html);
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      // Count page objects for metadata without introducing a PDF dependency.
      pageCount = Math.max(1, (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length);
      await workspace.write(resumeBase + '.pdf', pdf);
      await page.setContent(letter);
      await workspace.write(letterBase + '.pdf', await page.pdf({ printBackground: true, preferCSSPageSize: true }));
    }
  } catch (error) { if (renderDocuments) throw error; throw new Error('PDF generation needs Chromium. Run npx playwright install chromium, then retry. Your profile and job are saved.'); }
  finally { await browser?.close(); }
  await workspace.write(answersBase + '.md', `# ${job.company} — ${job.title}\n\n${packet.answers.map(a => `## ${a.question}\n\n${a.answer}\n\nSources: ${a.evidence.map(e => e.sourceId).join(', ')}`).join('\n\n')}\n`);
  const baseMetadata = { candidate: slug(state.profile.name), company: job.company, company_slug: slug(job.company), role: job.title, role_slug: slug(job.title), artifact_date: now().slice(0, 10), generated_at: now(), source_baseline: await workspace.read('data/resume-source.yml') ? 'data/resume-source.yml' : 'cv.md', job_source: job.url, job_source_type: 'url', report_path: job.reportPath, report_id: path.basename(job.reportPath, '.md'), jd_fingerprint: digest(job.description), generator: 'plainhand/workflow.mjs', generator_version: '1', status: 'ready' };
  for (const [base, type, extra] of [[resumeBase, 'resume', { page_count: pageCount, template_id: format.source === 'default' ? 'plainhand-default' : 'candidate-format', format: format.page || 'letter' }], [letterBase, 'cover_letter', { variants: ['html', 'pdf'] }], [answersBase, 'answers', { answer_sources: ['cv.md', 'data/plainhand/workspace.json'] }]]) {
    await workspace.write(base + '.meta.md', `---\n${yaml.dump({ ...baseMetadata, artifact_type: type, content_fingerprint: digest(packet), ...extra })}---\n`);
  }
  return { pdf: resumeBase + '.pdf', pdfHash: digest(await workspace.readBinary(resumeBase + '.pdf')), artifacts: [resumeBase + '.pdf', letterBase + '.pdf', answersBase + '.md'] };
}

// Thrown by a deferred agent (plainhand/cloud/steps.mjs) to stop a run at a model call
// that a chat app has not answered yet. The run then records nothing: no failure, no commit.
export class TaskPaused extends Error {}

export class Workflow {
  // defaultProvider: the provider id used when the candidate has not selected one (the
  // hosted connector, where the chat app itself does the model work). null locally.
  // clock returns an ISO timestamp; tests replace it to drive the autonomy day limit.
  constructor(workspace, { agent = executeAgent, verifier = verifyJob, scanner = discover, renderer = renderPacket, textExtractor = extractPdfText, clock = now } = {}) {
    this.workspace = workspace; this.usage = new UsageLedger(workspace);
    this.agent = (...args) => this.usage.track(agent, ...args);
    this.verifier = verifier; this.scanner = scanner; this.renderer = renderer; this.textExtractor = textExtractor; this.clock = clock;
    this.controllers = new Map(); this.queue = Promise.resolve(); this.stopped = false;
    this.handlers = new Map(); this.defaultProvider = null;
  }
  // Feature task kinds (plainhand/features). The handler gets the same tools the built-in
  // tasks use: provider calls through run(), cancellation through check(), progress updates.
  registerTask(kind, { handler, needsProfile = true }) {
    if (['interview', 'evaluate', 'prepare', 'discover', 'standard', 'revise'].includes(kind) || this.handlers.has(kind)) throw new Error(`Task kind "${kind}" is already registered.`);
    this.handlers.set(kind, { handler, needsProfile });
  }
  async recover() {
    await this.usage.recover();
    await this.workspace.mutate(state => { for (const task of state.tasks) if (['queued', 'running'].includes(task.status)) { task.message = task.status === 'queued' ? 'Plainhand restarted before this task started. Start it again.' : 'Plainhand restarted. Retry this task to continue from saved work.'; task.status = 'interrupted'; task.finishedAt = now(); } });
  }
  // Closing the app stops the queue: the running call is aborted, and queued work is
  // left for the next start to mark interrupted instead of running after shutdown.
  stop() {
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
  }
  async enqueue(kind, jobId, input = {}) {
    const id = randomUUID();
    await this.workspace.mutate(state => {
      if (state.tasks.some(t => ['running', 'queued'].includes(t.status) && t.kind === kind && t.jobId === jobId)) throw new Error('This task is already queued or running.');
      if (state.tasks.filter(t => ['running', 'queued'].includes(t.status)).length >= 20) throw new Error('Let the current queue finish before adding more tasks.');
      if (!['interview', 'evaluate', 'prepare', 'discover', 'standard', 'revise'].includes(kind) && !this.handlers.has(kind)) throw new Error('Unknown task type.');
      if (kind !== 'discover' && this.handlers.get(kind)?.needsProfile !== false) ready(state, this.defaultProvider);
      if (jobId && !state.jobs.some(j => j.id === jobId)) throw new Error('Job not found.');
      if (input.retryOf) {
        const old = state.tasks.find(t => t.id === input.retryOf);
        if (!old || old.kind !== kind || (old.jobId || null) !== (jobId || null) || !['failed', 'interrupted', 'canceled'].includes(old.status)) throw new Error('Only a matching failed, interrupted or canceled task can be retried.');
      }
      state.tasks.unshift({ id, kind, jobId, input, retryOf: input.retryOf || null, status: 'queued', message: 'Waiting for the agent', createdAt: now() });
      // Retain history while bounding the size of a workspace.
      state.tasks = state.tasks.slice(0, 150);
    });
    this.queue = this.queue.then(() => this.run(id)).catch(() => {});
    return id;
  }
  // The ATS check on the rendered resume PDF. Advisory: it never fails or blocks a task.
  async atsCheck(artifacts, profile, packet, job, context) {
    try {
      const pdf = await this.workspace.readBinary(artifacts.pdf);
      const supportText = [...(context.sources || []).map(s => s.text), profile.resume, profile.story].filter(Boolean).join('\n');
      return await atsCheckPdf(pdf, { profile, lines: packet.resume.map(e => e.text), posting: job.description, supportText }, { extract: pdf => this.textExtractor(pdf) });
    } catch { return { state: 'unavailable', checks: [], keywords: { covered: [], suggested: [], gaps: [] }, hint: 'The resume text check could not run.', checkedAt: now() }; }
  }
  async progress(id, message) { await this.workspace.mutate(state => { const t = state.tasks.find(t => t.id === id); if (t && t.status !== 'canceled') { t.status = 'running'; t.message = message; } }); }
  async cancel(id) {
    this.controllers.get(id)?.abort();
    await this.workspace.mutate(state => { const task = state.tasks.find(t => t.id === id); if (task && ['queued', 'running'].includes(task.status)) { task.status = 'canceled'; task.message = 'Canceled. Saved work is preserved.'; task.finishedAt = now(); } });
  }
  async run(id) {
    const state = await this.workspace.load();
    const task = state.tasks.find(t => t.id === id);
    if (!task || task.status === 'canceled' || this.stopped) return;
    const controller = new AbortController(); this.controllers.set(id, controller);
    const check = () => { if (controller.signal.aborted) throw new Error('Task canceled.'); };
    const context = await this.workspace.context(state);
    const job = task.jobId ? structuredClone(state.jobs.find(j => j.id === task.jobId)) : null;
    const original = job ? structuredClone(job) : null; // to commit only what this task changed
    const originalJobHash = job ? digest([job.url, job.company, job.title, job.description]) : null;
    const assertJob = current => { if (!current || digest([current.url, current.company, current.title, current.description]) !== originalJobHash) throw new Error('The job changed during this task. Retry with the current description.'); };
    const attempts = new Map();
    const run = async (instruction, extra) => {
      check();
      const purpose = instruction === REVIEW_INSTRUCTION ? 'review' : instruction === HUMANIZE_INSTRUCTION ? 'humanize' : task.kind;
      const attempt = (attempts.get(purpose) || 0) + 1; attempts.set(purpose, attempt);
      const result = await this.agent(state.provider || this.defaultProvider, instruction, { context, ...extra }, { signal: controller.signal, usageContext: { taskId: id, jobId: task.jobId, retryOf: task.retryOf, purpose, attempt } });
      check(); return result;
    };
    try {
      await this.progress(id, task.kind === 'discover' ? 'Reading your saved job sources' : 'Assembling your candidate context');
      if (task.kind === 'interview') {
        const result = await run(INTERVIEW_INSTRUCTION, { conversation: state.conversation });
        requireText(result.summary, 'profile summary'); requireText(result.voice, 'voice'); requireText(result.sampleAnswer, 'sample answer');
        for (const key of ['strengths', 'questions', 'gaps']) result[key] = strings(result[key], key);
        await this.workspace.mutate(async latest => {
          if ((await this.workspace.context(latest)).hash !== context.hash || digest(latest.conversation) !== digest(state.conversation)) throw new Error('Your profile or interview changed. Run the understanding step again.');
          latest.understanding = { result, contextHash: context.baseHash, approved: false, createdAt: now() };
          logUnderstanding(latest, { event: 'built', questions: result.questions.length, gaps: result.gaps.length });
          latest.conversation.push({ role: 'assistant', text: result.summary + '\n\n' + result.questions.join('\n'), at: now() });
        });
      } else if (task.kind === 'discover') {
        const sources = state.sources;
        if (!sources.length) throw new Error('Add a company career board under Find jobs first.');
        const found = [], failures = [];
        for (const source of sources) {
          check(); await this.progress(id, `Checking ${source.name}`);
          try { found.push(...await this.scanner(source, task.input.filter || '', task.input.location || '')); }
          catch (error) { failures.push(`${source.name}: ${error.message}`); }
        }
        check();
        await this.workspace.mutate(latest => {
          let added = 0;
          for (const item of found) {
            if (latest.jobs.some(j => j.url === item.url || (j.company.toLowerCase() === item.company.toLowerCase() && j.title.toLowerCase() === item.title.toLowerCase()))) continue;
            latest.jobs.push({ ...item, id: randomUUID(), stage: 'inbox', createdAt: now(), description: '', selected: false }); added++;
          }
          latest.events.unshift({ at: now(), text: `Discovery added ${added} new roles. ${failures.length ? failures.join(' ') : 'No applications were started.'}` });
        });
        if (failures.length === sources.length) throw new Error(failures.join(' '));
      } else if (task.kind === 'evaluate') {
        await this.progress(id, 'Opening the posting to verify the exact role');
        job.verification = await this.verifier(job);
        check();
        if (job.verification.description) job.description = job.verification.description;
        if (job.verification.state === 'closed') throw new Error('This posting is closed. Keep it for reference or discard it.');
        if (!job.description || job.description.length < 100) throw new Error('Paste the job description before evaluating. The page could not be read.');
        // Deterministic posting check before any provider sees the text (posting-integrity.mjs).
        // Hidden passages only count when this description is the page the verifier read.
        job.integrity = integrityRecord(job.description, job.verification.description === job.description ? job.verification.hidden : []);
        await this.progress(id, 'Matching the role against your evidence');
        const result = await run(EVALUATE_INSTRUCTION, { job: providerJob(job) });
        if (typeof result.score !== 'number' || result.score < 0 || result.score > 5 || !['Apply', 'Investigate', 'Skip'].includes(result.recommendation)) throw new Error('The agent returned an invalid evaluation. Retry.');
        requireText(result.summary, 'evaluation summary');
        for (const key of ['gaps', 'questions', 'legitimacyNotes']) result[key] = strings(result[key], key);
        list(result.matches, 'matches');
        if (result.matches.some(m => !hasEvidence(m, context) || !cleanEntry(m.text))) throw new Error('An evaluation claim lacks valid source evidence. Retry after checking your profile.');
        result.score = Math.round(result.score * 10) / 10;
        // The stored label is app policy; keep the model's own label for measurement.
        result.modelRecommendation = result.recommendation;
        if (result.score < 4 && result.recommendation === 'Apply') result.recommendation = 'Investigate';
        job.evaluation = result; job.stage = 'evaluated'; job.status = job.status || 'Evaluated'; job.contextHash = context.hash;
        job.reportPath = `reports/hl-${job.id.slice(0, 8)}-${slug(job.company)}-${now().slice(0, 10)}.md`;
        const report = `# ${job.company} — ${job.title}\n\n**Score:** ${result.score}/5\n**URL:** ${job.url}\n**PDF:** pending\n**Legitimacy:** ${job.verification.legitimacy}\n**Verification:** ${job.verification.state}\n\n## A. Role summary\n${result.summary}\n\n## B. Evidence and fit\n${result.matches.map(m => `- ${m.text}\n  Sources: ${m.evidence.map(e => `${e.sourceId}: “${e.quote}”`).join('; ')}`).join('\n')}\n\n## C. Level and gaps\n${result.gaps.map(s => '- ' + s).join('\n')}\n\n## D. Compensation\nCandidate preference: ${state.profile.compensation || 'Not provided; ask the candidate.'}\n\n## E. Personalization\n${state.profile.roles}\n\n## F. Questions and next action\n${result.recommendation}\n${result.questions.map(s => '- ' + s).join('\n')}\n\n## G. Posting legitimacy\n**Posting check:** ${job.integrity.summary}\n${job.integrity.findings.filter(f => f.severity === 'warn').map(f => `- ${f.detail}`).join('\n')}${job.integrity.findings.some(f => f.severity === 'warn') ? '\n' : ''}\n${job.verification.reason}\n${result.legitimacyNotes.map(s => '- ' + s).join('\n')}\n`;
        await this.workspace.mutate(async latest => {
          await this.assertContext(latest, context);
          const current = latest.jobs.find(j => j.id === job.id);
          assertJob(current);
          Object.assign(current, taskChanges(original, job), { status: current.status || job.status, approvedHash: null, packetJobHash: null });
          await this.workspace.write(job.reportPath, report);
          await syncTracker(this.workspace, latest);
        });
        // Opt-in autonomy: a strong match may be prepared from the approved master resume. Never submitted.
        await this.autoPrepare(job.id, context.hash);
      } else if (task.kind === 'standard') {
        const previous = state.standard?.draft || null, request = task.input.request || '';
        if (request && !previous) throw new Error('Write your master resume before asking for changes.');
        await this.progress(id, request ? 'Revising your master resume as you asked' : 'Writing your master resume and base cover letter');
        const line = lineInput(state, null), lineData = { ...(line ? { candidateLine: line } : {}), ...(state.resumeFormat?.sections?.length ? { format: { sections: state.resumeFormat.sections } } : {}) };
        let draft, review, humanizer;
        const reviewAttempts = [];
        // The master must cover the candidate's own resume. A first draft that leaves
        // lines out gets one more pass with those lines named; a revision the
        // candidate asked for is not second-guessed.
        const ownResume = context.sources.find(source => source.id === 'cv')?.text || '';
        let missing = [], fallback = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const base = attempt ? draft : previous;
          try {
            draft = await run(STANDARD_INSTRUCTION, { ...lineData, ...(request || attempt ? { previous: base } : {}), ...(request ? { revisionRequest: request } : {}), ...(attempt ? { reviewFeedback: review.issues } : {}), ...(attempt && missing.length ? { missingFromResume: missing } : {}) });
            requireText(draft.headline, 'headline'); requireText(draft.coverLetter, 'cover letter', 25000); list(draft.resume, 'resume', 150);
            draft.suggestions = strings(draft.suggestions || [], 'optional suggestions');
            draft.resume = draft.resume.filter(item => typeof item?.text !== 'string' || item.text.trim());
            if (!draft.resume.length || draft.resume.some(item => !hasEvidence(item, context))) throw new Error('The master resume contains a claim without an exact source reference. Check your evidence and retry.');
            for (const item of draft.resume) { requireText(item.section, 'resume section', 100); requireText(item.text, 'resume entry', 10000); }
            verifyHeadings(draft.resume, context.sources.map(s => s.text).join('\n'));
            await this.progress(id, 'Removing AI writing patterns');
            ({ packet: draft, report: humanizer } = applyHumanized({ ...draft, answers: [] }, await run(HUMANIZE_INSTRUCTION, { items: humanizeItems({ ...draft, answers: [] }) })));
            await this.progress(id, 'Checking factual claims against the original sources');
            review = await run(REVIEW_INSTRUCTION, { job: STANDARD_JOB, packet: { ...draft, answers: [] }, ...lineData });
            if (typeof review.passed !== 'boolean') throw new Error('The reviewer returned an invalid result. Retry.');
            review.issues = strings(review.issues, 'review issues');
            reviewAttempts.push({ attempt: attempt + 1, ...review });
          } catch (error) {
            // A redraft that only added missing lines must not lose the reviewed first draft.
            check(); if (!fallback || error instanceof TaskPaused) throw error;
            ({ draft, review, humanizer } = fallback); break;
          }
          const reviewed = review.passed && !review.issues.length;
          if (attempt === 1 && fallback && (!reviewed || masterCoverage(ownResume, draft.resume).covered < masterCoverage(ownResume, fallback.draft.resume).covered)) { ({ draft, review, humanizer } = fallback); break; }
          missing = attempt === 0 && !request ? masterCoverage(ownResume, draft.resume).missing : [];
          if (reviewed && !missing.length) break;
          if (reviewed) fallback = { draft, review, humanizer };
          if (attempt === 0) await this.progress(id, reviewed ? 'Adding resume lines the first draft left out' : 'Correcting unsupported claims using the reviewer’s source checks');
        }
        if (!review.passed || review.issues.length) throw new Error(`The factual review found issues in your master resume: ${review.issues.slice(0, 3).join(' ')}`);
        const clean = { headline: draft.headline, resume: draft.resume.map(({ section, heading, text, evidence }) => ({ section, heading: heading || null, text, evidence })), coverLetter: draft.coverLetter, suggestions: draft.suggestions };
        const calibration = { ...gradePacket({ ...clean, answers: [] }, context.sources, review.calibration, candidateLine(state)), gradedAt: now() };
        await this.workspace.mutate(async latest => {
          check(); await this.assertContext(latest, context);
          latest.standard = { kind: 'master', draft: clean, review, reviewAttempts, humanizer, calibration, coverage: masterCoverage(ownResume, clean.resume), contextHash: context.hash, createdAt: now(), approvedAt: null, approvedHash: null };
          if (request) latest.revisions = [...(latest.revisions || []), { at: now(), jobId: null, request }].slice(-200);
          latest.events.unshift({ at: now(), text: request ? 'Master resume revised. Review it before applications use it.' : 'Master resume written. Review it before applications use it.' });
        });
      } else if (task.kind === 'prepare' || task.kind === 'revise') {
        const revising = task.kind === 'revise', request = revising ? String(task.input.request || '') : '';
        if (revising && (!job.packet || !request)) throw new Error('Prepare this application before asking for changes.');
        if (job.submittedAt || ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(job.status)) throw new Error('This role already has a submitted application. Its saved packet remains available; no new application will be prepared.');
        if (!job.selected || !job.evaluation) throw new Error('Evaluate this role and choose it before preparing an application.');
        if (job.evaluation.score < 4 && !job.overrideReason) throw new Error('This role scored below 4/5. Record why you want to pursue it before continuing.');
        if (job.contextHash !== context.hash) throw new Error('Your profile changed. Evaluate this job again first.');
        await this.progress(id, revising ? 'Revising your application as you asked' : 'Writing your resume, cover letter, and answers');
        const standard = standardInput(state, context.hash);
        let packet, humanizer;
        let review;
        const reviewAttempts = [];
        const draftStarted = now(), line = lineInput(state, job.id), lineData = { ...(line ? { candidateLine: line } : {}), ...(state.resumeFormat?.sections?.length ? { format: { sections: state.resumeFormat.sections } } : {}) };
        for (let attempt = 0; attempt < 2; attempt++) {
          // roleOrder is the candidate's own order for experience; on a revision their request wins over it.
          packet = await run(PACKET_INSTRUCTION, { job: providerJob(job), roleAnswers: job.roleAnswers || '', ...lineData, roleOrder: roleOrderOf(state), ...(standard && !revising ? { master: standard } : {}),
            ...(revising ? { revisionRequest: request, previousPacket: attempt ? packet : job.packet } : attempt ? { previousPacket: packet } : {}), ...(attempt ? { reviewFeedback: review.issues } : {}) });
          requireText(packet.headline, 'headline'); requireText(packet.coverLetter, 'cover letter', 25000);
          list(packet.resume, 'resume', 60); list(packet.answers, 'answers', 40); packet.questions = strings(packet.questions, 'questions');
          packet.suggestions = strings(packet.suggestions || [], 'optional suggestions');
          // A line with no text carries no claim and renders as an empty bullet: drop it
          // instead of failing the whole application (a model may emit a heading-only row).
          packet.resume = packet.resume.filter(item => typeof item?.text !== 'string' || item.text.trim());
          if (!packet.resume.length || [...packet.resume, ...packet.answers].some(item => !hasEvidence(item, context))) throw new Error('The packet contains a claim without an exact source reference. No packet was approved. Check your evidence and retry.');
          for (const item of packet.resume) { requireText(item.section, 'resume section', 100); requireText(item.text, 'resume entry', 10000); }
          for (const item of packet.answers) { requireText(item.question, 'question', 2000); requireText(item.answer, 'answer', 15000); }
          verifyHeadings(packet.resume, context.sources.map(s => s.text).join('\n'));
          // Reuse before humanize and review: an approved factual answer whose quote is in
          // the current shared sources replaces the draft and carries its provenance. Held,
          // expired, out-of-scope or unproved entries and every candidate assertion stay out,
          // and the answer records why, so review still sees the sentence that will ship.
          applyReusableAnswers(packet, { answers: await new AnswerBank(this.workspace).load(), job, sources: context.sources, asOf: now().slice(0, 10) });
          await this.progress(id, 'Removing AI writing patterns');
          ({ packet, report: humanizer } = applyHumanized(packet, await run(HUMANIZE_INSTRUCTION, { items: humanizeItems(packet) })));
          await this.progress(id, 'Checking factual claims against the original sources');
          review = await run(REVIEW_INSTRUCTION, { job: providerJob(job), packet, ...lineData });
          if (typeof review.passed !== 'boolean') throw new Error('The reviewer returned an invalid result. Retry.');
          review.issues = strings(review.issues, 'review issues');
          reviewAttempts.push({ attempt: attempt + 1, ...review });
          if (review.passed && !review.issues.length) break;
          if (attempt === 0) await this.progress(id, 'Correcting unsupported claims using the reviewer’s source checks');
        }
        job.review = review;
        job.reviewAttempts = reviewAttempts;
        if (!review.passed || review.issues.length) {
          await this.workspace.mutate(latest => { const current = latest.jobs.find(j => j.id === job.id); current.review = review; current.reviewAttempts = reviewAttempts; current.stage = 'review-blocked'; current.approvedHash = null; });
          throw new Error('The factual review found issues. Review the findings in the application and add missing evidence before retrying.');
        }
        // How each claim compares with its evidence: undersold, balanced, stretched or unsupported.
        // The saved description is never rewritten; grade against the same sanitized copy the
        // provider sees, so a sentence addressed to AI tools cannot whitelist a number.
        job.calibration = { ...gradePacket(packet, context.sources, review.calibration, candidateLine(state), { jobText: providerDescription(job.description || '') }), gradedAt: now(), line: Boolean(line) };
        job.fromStandard = compareToStandard(packet, standard);
        job.humanizer = humanizer;
        job.packet = packet; job.packetJobHash = digest([job.url, job.company, job.title, job.description]);
        await this.progress(id, 'Rendering your application documents');
        await this.workspace.mutate(async latest => {
          check(); await this.assertContext(latest, context);
          const current = latest.jobs.find(j => j.id === job.id);
          assertJob(current);
          if (!current.selected) throw new Error('This role is no longer selected.');
          const artifacts = await this.renderer(this.workspace, latest, job, packet);
          check();
          const atsCheck = await this.atsCheck(artifacts, latest.profile, packet, job, context);
          // Canceling during the check must not leave a packet that can be approved.
          check();
          Object.assign(current, taskChanges(original, job), artifacts, { atsCheck, approvedHash: null, stage: packet.questions.length ? 'awaiting-answer' : 'packet-ready', status: current.status === 'Evaluated' ? 'Apply' : current.status });
          markApplied(latest, job.id, draftStarted);
          if (revising) latest.revisions = [...(latest.revisions || []), { at: now(), jobId: job.id, request }].slice(-200);
          await this.workspace.write(`output/packet-${job.id}.json`, JSON.stringify({ jobId: job.id, company: job.company, role: job.title, contextHash: context.hash, packet, review, reviewAttempts, calibration: job.calibration, ...artifacts }, null, 2));
          const report = await this.workspace.read(job.reportPath);
          await this.workspace.write(job.reportPath, report.replace('**PDF:** pending', '**PDF:** ' + artifacts.pdf));
          await syncTracker(this.workspace, latest);
        });
      } else if (this.handlers.has(task.kind)) {
        await this.handlers.get(task.kind).handler({ task, state, job, context, run, check, assertJob, workspace: this.workspace, signal: controller.signal, progress: message => this.progress(id, message) });
      } else throw new Error('Unknown task type.');
      check();
      await this.workspace.mutate(latest => { const t = latest.tasks.find(t => t.id === id); if (t.status !== 'canceled') Object.assign(t, { status: 'complete', message: 'Finished', finishedAt: now() }); });
    } catch (error) {
      if (error instanceof TaskPaused) return;
      await this.workspace.mutate(latest => {
        const t = latest.tasks.find(t => t.id === id);
        if (t.status !== 'canceled') Object.assign(t, { status: 'failed', message: error.message, finishedAt: now() });
        if (job?.verification) latest.jobs.find(j => j.id === job.id).verification = job.verification;
      });
    } finally { this.controllers.delete(id); }
  }
  async autoPrepare(jobId, contextHash) {
    let queue = false;
    const at = this.clock();
    await this.workspace.mutate(state => {
      const job = state.jobs.find(j => j.id === jobId);
      const decision = autoPrepareDecision(state, job, contextHash, at.slice(0, 10));
      if (!decision.prepare) {
        // A role refused only because today's limit is used up is recorded, so the
        // candidate can tell why it was left alone.
        if (decision.reason === 'daily limit reached') state.events.unshift({ at, text: `Not preparing ${job.company} — ${job.title} on its own: the daily limit is used up (${decision.done} of ${decision.perDay} today). Nothing was sent.` });
        return;
      }
      job.selected = true; job.autoSelectedAt = at; queue = true;
      state.events.unshift({ at, text: `Preparing ${job.company} — ${job.title} on its own (fit ${job.evaluation.score}/5). Nothing is sent; review it when it's ready.` });
    });
    if (queue) await this.enqueue('prepare', jobId).catch(() => {});
  }
  async assertContext(state, context) { if ((await this.workspace.context(state)).hash !== context.hash) throw new Error('Your profile changed during this task. Retry with the current profile.'); }
}
function cleanEntry(value) { return typeof value === 'string' && value.length > 0 && value.length < 20000; }

// Reuses candidate-approved answers in a new packet. Only a factual entry whose quote is
// in the current shared sources and whose scope, expiry and review state still hold may
// replace a drafted answer; assertions are never packet evidence. A matching entry that
// cannot be used leaves a reason on the answer instead of silently falling back.
export function applyReusableAnswers(packet, { answers = [], job = null, sources = [], asOf } = {}) {
  let reused = 0, notReused = 0;
  for (const item of packet.answers || []) {
    const { entry, reason } = AnswerBank.reuse(answers, { label: item.question, job, asOf, sources });
    if (entry) {
      item.answer = entry.answer;
      item.evidence = entry.evidence.map(({ sourceId, quote }) => ({ sourceId, quote }));
      item.reuse = { kind: 'reusable-answer', id: entry.id, reviewedAt: entry.reviewedAt };
      delete item.notReused;
      reused++;
    } else if (reason) {
      item.notReused = { kind: 'reusable-answer', reason };
      notReused++;
    }
  }
  return { reused, notReused };
}

export function suggestFormAnswers(fields, profile, packet, options = {}) {
  const answers = defaultFieldAnswers(fields, profile);
  for (const field of fields) {
    // Document uploads and canonical identity values are control instructions,
    // never prose answers, even when the model uses a matching question title.
    if (field.type === 'file' || field.type === 'select-one' || Object.hasOwn(answers, field.key)) continue;
    if (field.sectionContext && /education|employment|experience|project/i.test(field.sectionContext.label)) continue;
    const match = packet.answers.find(a => a.question.trim().toLowerCase() === field.label.trim().toLowerCase());
    if (match && !isSensitiveLabel(field.label)) { answers[field.key] = match.answer; continue; }
    // Reusable, reviewed answers only fill what this packet did not answer.
    const reusable = AnswerBank.match(options.bank || [], { label: field.label, job: options.job, asOf: options.asOf });
    if (reusable) answers[field.key] = reusable.answer;
  }
  return answers;
}
