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
import { prepareMemoryCheck, recordQuestionChecks } from './memory-checks.mjs';
import { gradePacket } from './claim-calibration.mjs';
import { lineInput, candidateLine, markApplied } from './claim-line.mjs';
import { STANDARD_JOB, standardInput, compareToStandard, autoPrepareDecision, masterCoverage, roleOrderOf } from './standard.mjs';
import { masterCompleteness, completeMasterResume } from './master-completeness.mjs';
import { HUMANIZE_INSTRUCTION, humanizeItems, applyHumanized, aiTells } from './humanize.mjs';
import { voiceTargetOf } from './voice-target.mjs';
import { AgentCache } from './agent-cache.mjs';
import { atsCheckPdf, extractPdfText } from './ats-check.mjs';
import { letterOverlaps, letterRetryFeedback, overlapSuggestion } from './letter-checks.mjs';
import { DEFAULT_FORMAT, renderResumeHtml, renderLetterHtml, verifyHeadings, headingKey, normalizeResume, repairMisplacedAccomplishments } from './resume-format.mjs';
import { pluralScopeIssues, scopeRetryFeedback, scopeSuggestions } from './scope-checks.mjs';
import { relevantMissingCredentials, credentialRetryFeedback, credentialSuggestion, credentialName, masterCredentialRows } from './credential-relevance.mjs';

export const slug = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'candidate';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = (value, label, limit = 40) => {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`The agent returned invalid ${label}. Retry the task.`);
  return value;
};
// The master resume has no length limit: "nothing is left out for space". There is
// deliberately no entry-count cap here. What bounds memory is the provider's own
// response and the 10,000-character cap on each entry's text below, plus the
// workspace file itself; 200 entries (a long career with projects, education and
// credentials) are ordinary input, not an error.
const MASTER_RESUME_LIMIT = Number.POSITIVE_INFINITY;
const strings = (value, label) => list(value, label).map(v => requireText(v, label, 15000));
const PACKET_EVIDENCE_ERROR = 'The packet contains a claim without an exact source reference. No packet was approved. Check your evidence and retry.';
const MASTER_EVIDENCE_ERROR = 'The master resume contains a claim without an exact source reference. Check your evidence and retry.';
// The evidence gate's retry feedback: each failing entry by kind and index, its text,
// and the quote the model gave, so the redraft can quote a source exactly or drop it.
const condensed = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function evidenceRetryFeedback(entries) {
  return ['These entries cite a quote that is not in the sources; quote the source exactly or remove the entry:', ...entries.map(({ kind, index, item }) => {
    const quotes = (Array.isArray(item?.evidence) ? item.evidence : []).map(entry => condensed(entry?.quote, 120)).filter(Boolean);
    const cited = quotes.length ? `cites "${quotes.join('" and "')}", which ${quotes.length === 1 ? 'is' : 'are'} not in the sources` : 'cites no source quote';
    return `${kind} ${index} ("${condensed(item?.text ?? item?.answer, 160)}") ${cited}.`;
  })];
}
// An education or credential heading that carries the school or issuer, the degree or
// credential and the dates states the whole entry, so its text is empty by design and
// the renderer shows the heading alone. Every other blank row is a lost line: drop it
// locally instead of failing the application on a row with nothing to cite.
const CREDENTIAL_SECTION = /educat|certif|licen[cs]/i;
const blankText = entry => typeof entry?.text === 'string' && !entry.text.trim();
export const headingOnlyRow = entry => blankText(entry)
  && CREDENTIAL_SECTION.test(String(entry?.section ?? ''))
  && Boolean(entry?.heading && typeof entry.heading === 'object'
    && String(entry.heading.org ?? '').trim() && String(entry.heading.title ?? '').trim() && String(entry.heading.dates ?? '').trim());
// The master is the complete record, so a role its sources state appears even when no
// line is attached to it yet: an Experience heading-only row is legal there only. A
// packet may never ship one, because a sent resume must say what was done.
const ROLE_SECTION = /experience|employment|work history/i;
export const headingOnlyRoleRow = entry => blankText(entry)
  && ROLE_SECTION.test(String(entry?.section ?? ''))
  && Boolean(entry?.heading && typeof entry.heading === 'object'
    && String(entry.heading.org ?? '').trim() && String(entry.heading.dates ?? '').trim());
export const keepResumeRow = entry => !blankText(entry) || headingOnlyRow(entry);
export const keepMasterRow = entry => !blankText(entry) || headingOnlyRow(entry) || headingOnlyRoleRow(entry);
// The same accomplishment written twice under one heading: keep the first line and
// drop a later line whose normalized text equals or sits inside it.
const normalizedLine = value => (String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) || []).join(' ');
export function dedupeResume(resume) {
  const kept = [];
  for (const entry of resume) {
    const text = normalizedLine(entry?.text), key = headingKey(entry?.heading);
    if (text && kept.some(line => line.key === key && line.text && ` ${line.text} `.includes(` ${text} `))) continue;
    kept.push({ key, text, entry });
  }
  return kept.map(({ entry }) => entry);
}
// A suggestion is a note about the packet, not part of it. One that says an item was
// included when neither the resume nor the letter contains it misdescribes what the
// candidate reviews, so it becomes an honest omission instead. Only a leading
// included/added/kept claim whose item has a capitalized or acronym identifier is
// touched: generic phrasing such as "Kept the resume to one page" is left alone.
const SUGGESTION_CLAIM = /^(?:also\s+|then\s+|finally\s+|i\s+|we\s+)?(?:included|added|kept|retained|preserved|reused|carried over)\s+(.+)$/i;
const SUGGESTION_SUBJECT_CLAIM = /^(?:the\s+)?(?:resume|packet|letter|draft|master resume)\s+(?:also\s+)?(?:includes|included|adds|added|keeps|kept|retains|retained|preserves|preserved|reuses|reused)\s+(.+)$/i;
const SUGGESTION_TAIL = /\s+(?:from|in|on|to|into|within|under)\s+(?:the|my|your|their|this|that)?\s*(?:cv|resume|master resume|letter|packet|draft|profile|application|sources?|skills?|summary)\b[\s\S]*$/i;
// Structural words name a place, not an item, so they never prove an inclusion claim.
const SUGGESTION_GENERIC = new Set(['resume', 'cv', 'letter', 'packet', 'draft', 'profile', 'application', 'certificate', 'certification', 'certifications', 'license', 'licensure', 'degree', 'course', 'courses', 'project', 'projects', 'role', 'roles', 'skill', 'skills', 'section', 'summary', 'experience', 'education', 'publication', 'publications', 'award', 'awards', 'line', 'bullet', 'page', 'qualification', 'qualifications', 'credential', 'credentials', 'internship', 'position', 'job', 'company', 'employer', 'work']);
const suggestionText = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Two more phrasings the model uses to assert an inclusion: the document as the subject
// ("The master resume includes X", "The resume lists X") and an enumeration ("Every role,
// including X, is listed"). Advice, questions and conditionals ("Consider adding X",
// "If you have X") never match, so they are never rewritten.
const SUGGESTION_DOC_CLAIM = /^(?:the\s+)?(?:master(?:\s+resume)?|resume|packet|letter|cover letter|draft|application)\s+(?:also\s+|now\s+)?(?:includes|included|lists|listed|keeps|kept|adds|added|retains|retained|shows|carries|carried)\s+(.+)$/i;
const SUGGESTION_ENUM_CLAIM = /^(?:every|each|all)\b[^,]*,\s*including\s+(.+?),\s*(?:is|are)\s+(?:listed|included|kept|shown|retained)\b/i;
// The passive form the reviewer saw: "The certification is included with its stated
// year." The named item is the sentence's subject, so a generic credential noun is
// resolved against whether the documents hold any credential at all.
const SUGGESTION_PASSIVE_CLAIM = /^(?:the\s+)?(.+?)\s+(?:is|was|are|were)\s+(?:also\s+|now\s+)?(?:included|listed|kept|retained|preserved|added|shown|carried)\b/i;
const CREDENTIAL_NOUN = /^(?:the\s+)?(?:certificat\w*|licen[cs]\w*|credential\w*)$/i;
const CREDENTIAL_CONTENT = /(?:certif\w*|licen[cs]\w*|credential\w*)/i;
const QUESTION_OR_ADVICE = /^\s*(?:could|would|can|should|consider|if|whether|please|do|does|is|are|will|may|might|confirm)\b|\bwhether\b|\?\s*$/i;
function suggestionItem(suggestion) {
  const text = String(suggestion ?? '');
  // An enumeration ("Every role, including X, is listed") is read first, so its
  // subject is not mistaken for a passive claim. A question or conditional is advice,
  // never an inclusion claim, so the passive form ignores it.
  const enumerated = text.match(SUGGESTION_ENUM_CLAIM);
  const passive = !enumerated && !QUESTION_OR_ADVICE.test(text) ? text.match(SUGGESTION_PASSIVE_CLAIM) : null;
  const match = enumerated || passive || text.match(SUGGESTION_CLAIM) || text.match(SUGGESTION_SUBJECT_CLAIM) || text.match(SUGGESTION_DOC_CLAIM);
  if (!match) return null;
  const item = match[1].replace(SUGGESTION_TAIL, '').replace(/[\s.;:!?]+$/, '').replace(/^(?:the|a|an|my|your|their|his|her|our)\s+/i, '').trim();
  if (!item || item.length > 160 || item.split(/\s+/).length > 18) return null;
  if (passive && CREDENTIAL_NOUN.test(item)) return { item, named: [], credentialNoun: true };
  const named = item.split(/[\s,();:]+/).filter(word => /^[A-Z0-9]/.test(word) && !SUGGESTION_GENERIC.has(suggestionText(word)) && suggestionText(word).length >= 2);
  return named.length ? { item, named } : null;
}
// The lines in a heading-less unknown section cannot be attached to a role when the
// packet has more than one: the retry names the roles, and the final packet records
// the placement as a suggestion instead of guessing an employer.
const headingLabel = heading => [heading?.org, heading?.title, heading?.dates].map(value => String(value ?? '').trim()).filter(Boolean).join(' — ');
export function accomplishmentRetryFeedback({ roles = [], sections = [] } = {}) {
  const where = sections.filter(Boolean).map(name => `"${name}"`).join(', ') || 'a heading-less section';
  return `The resume lines in ${where} are not under any role, and the resume has ${roles.length} Experience roles (${roles.map(headingLabel).join('; ')}), so they cannot be placed automatically. Move each of those lines under the role it belongs to, as lines that share that role's heading.`;
}
// A row the completeness repair added is no longer left out, so a suggestion that says
// it was ("Left out the Green Belt because ...") would now misdescribe the master. Only
// an omission note naming the added row's credential or employer is dropped.
// Row absence only: "missing the issuing body" is advice about a field of the row.
const OMISSION_NOTE = /\b(?:left out|leaves? out|leaving out|omitted|omits?|omission|not included|absent from|excluded|excluding|missing from)\b/i;
export function dropRepairedOmissions(suggestions, added) {
  const names = (Array.isArray(added) ? added : []).flatMap(row => {
    const org = String(row?.heading?.org ?? '').trim();
    if (org) return [org.toLowerCase()];
    const words = (String(row?.text ?? '').match(/[A-Z][A-Za-z0-9&+-]{2,}/g) || []).filter(word => !/^(?:I|The|A|An|In|My)$/.test(word));
    return words.length >= 2 ? [words.join(' ').toLowerCase()] : [];
  });
  if (!names.length) return suggestions;
  return (Array.isArray(suggestions) ? suggestions : []).filter(text => {
    const value = String(text ?? '');
    if (!OMISSION_NOTE.test(value)) return true;
    const lower = value.toLowerCase();
    // The full name, or its last two words ("Green Belt" for "Lean Six Sigma Green Belt").
    return !names.some(name => {
      const words = name.split(' ');
      const tail = words.length > 2 ? words.slice(-2) : words;
      return words.every(word => lower.includes(word)) || new RegExp(`\\b${tail.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\b`).test(lower);
    });
  });
}
// When a credential the posting needs is missing from the final resume, a note that
// says a credential was kept or included contradicts the note that says it was left
// out, so it is dropped. Advice and questions are not inclusion claims.
const CREDENTIAL_NOUN_MENTION = /\b(?:certif\w*|licen[cs]\w*|credentials?)\b/i;
const INCLUSION_VERB = /\b(?:kept|keeps|retain\w*|includ(?:ed|es)|listed|lists|shown|shows|preserved|carried|added|adds)\b/i;
// `missing` holds the missing credentials; a note counts as being about one when it
// uses a credential noun or names one of those credentials' own acronyms or name
// words, never merely because it contains some other acronym (US, SQL).
export function dropCredentialInclusionClaims(suggestions, missing = []) {
  const names = (Array.isArray(missing) ? missing : []).flatMap(item => {
    const { acronyms, phrase } = credentialName(item?.text || item?.label || '');
    return [...acronyms.map(acronym => new RegExp(`\\b${acronym}\\b`)), ...(phrase ? [new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i')] : [])];
  });
  return (Array.isArray(suggestions) ? suggestions : []).filter(text => {
    const value = String(text ?? '');
    const about = CREDENTIAL_NOUN_MENTION.test(value) || names.some(pattern => pattern.test(value));
    return !(about && INCLUSION_VERB.test(value) && !QUESTION_OR_ADVICE.test(value));
  });
}
export function accomplishmentSuggestion({ roles = [], sections = [] } = {}) {
  const where = sections.filter(Boolean).join(', ') || 'heading-less sections';
  return `Check role placement: the resume has ${roles.length} Experience roles, so the lines in ${where} were left where the draft put them. Move each line under the role it belongs to.`;
}
export function guardSuggestions(suggestions, resume = [], coverLetter = '') {
  const shown = (Array.isArray(resume) ? resume : []).map(entry => [entry?.section, entry?.heading?.org, entry?.heading?.title, entry?.heading?.location, entry?.heading?.dates, entry?.text].filter(Boolean).join(' ')).join(' ');
  const haystack = ` ${suggestionText(`${shown} ${coverLetter}`)} `;
  return (Array.isArray(suggestions) ? suggestions : []).map(suggestion => {
    const claim = suggestionItem(suggestion);
    if (!claim) return suggestion;
    if (claim.credentialNoun) {
      // The documents hold no credential mention at all, so the claim is false.
      if (CREDENTIAL_CONTENT.test(shown)) return suggestion;
      return `Left out: the ${claim.item.toLowerCase()}.`;
    }
    const missing = claim.named.filter(word => !haystack.includes(` ${suggestionText(word)} `));
    if (!missing.length) return suggestion;
    // Name only what is actually absent: "includes AWS and Kubernetes" with AWS present
    // becomes "Left out: Kubernetes", never a false omission of AWS.
    if (missing.length < claim.named.length) return `Left out: ${missing.join(' ')}.`;
    const item = claim.item.charAt(0).toUpperCase() + claim.item.slice(1);
    return `Left out: ${item}.`;
  });
}
// A suggestion is optional advice to the candidate, not a factual claim in the resume,
// letter or answers. When the reviewer's only blocking issues target a suggestion or
// note, dropping those notes resolves them without another drafting pass. The test is
// deliberately narrow: an issue that mentions a document fact still goes to the redraft.
const SUGGESTION_ISSUE = /\b(?:suggestions?|notes?)\b/i;
const DOCUMENT_ISSUE = /\b(?:resume|cv|cover letter|letter|answers?|bullets?|claims?|employers?|job titles?|dates?|degrees?|certifications?|licen[cs]es?|numbers?|salary|compensation)\b/i;
export function dropSuggestionIssues(packet, review) {
  const issues = Array.isArray(review?.issues) ? review.issues : [];
  const suggestions = Array.isArray(packet?.suggestions) ? packet.suggestions : [];
  if (!issues.length || !suggestions.length) return null;
  const onlySuggestions = issues.every(issue => {
    const text = String(issue || '');
    return SUGGESTION_ISSUE.test(text) && !DOCUMENT_ISSUE.test(text.replace(SUGGESTION_ISSUE, ' '));
  });
  if (!onlySuggestions) return null;
  packet.suggestions = [];
  return { dropped: suggestions, reviewerIssues: [...issues] };
}
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

// U14: the master and the packet can apply the humanizer rules inside the drafting
// call instead of spending a second model call on them. The rules travel in the
// draft's INPUT (humanizeRules), so the instruction text stays the product contract
// the controlled fixture dispatches on, and the old two-call path stays available.
// Default off: a folded draft has no pre-rewrite to check, so safeRewrite (numbers
// and {company}/{role} slots unchanged) cannot run. PLAINHAND_FOLD_HUMANIZE=1/0
// overrides the setting for one harness run without editing the setting in state.
export function foldedHumanize(state) {
  const env = process.env.PLAINHAND_FOLD_HUMANIZE;
  if (env === '1') return true;
  if (env === '0') return false;
  return state?.settings?.foldHumanize === true;
}
const foldInput = folded => folded ? { humanizeRules: HUMANIZE_INSTRUCTION } : {};
// The report the UI and evidence use when no separate rewrite happened. tellsAfter is
// measured on the final text, so a folded draft that still reads like AI prose is
// visible instead of being reported as clean.
const foldedHumanizer = packet => {
  const tellsAfter = [...new Set(humanizeItems(packet).flatMap(item => aiTells(item.text)))];
  return { folded: true, changed: 0, kept: [], tellsBefore: tellsAfter.length, tellsAfter, remaining: [] };
};

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
    // The candidate's own samples set this run's register target. An excluded source
    // never reaches the provider, so it must not shape the letter either.
    const voiceSamples = context.sources.some(source => source.id === 'writing-samples') ? state.writingSamples || [] : [];
    const voiceTarget = voiceTargetOf(voiceSamples);
    // The candidate's saved resume format owns the section order when it names one;
    // otherwise normalizeResume applies the conventional resume order.
    const formatSections = state.resumeFormat?.sections || [];
    const job = task.jobId ? structuredClone(state.jobs.find(j => j.id === task.jobId)) : null;
    const original = job ? structuredClone(job) : null; // to commit only what this task changed
    const originalJobHash = job ? digest([job.url, job.company, job.title, job.description]) : null;
    const assertJob = current => { if (!current || digest([current.url, current.company, current.title, current.description]) !== originalJobHash) throw new Error('The job changed during this task. Retry with the current description.'); };
    const attempts = new Map();
    // Per-purpose, per-attempt recording on the job: a live run's calls can then show
    // whether a preparation needed a second draft (prepare 2 / humanize 2 / review 2)
    // and which purpose caused it. `attempt` is the ordinal within this task.
    const recordCall = (purpose, attempt) => {
      if (!job) return;
      job.callLog = [...(job.callLog || []), { purpose, attempt }].slice(-60);
    };
    const run = async (instruction, extra) => {
      check();
      const purpose = instruction === REVIEW_INSTRUCTION ? 'review' : instruction === HUMANIZE_INSTRUCTION ? 'humanize' : task.kind;
      const attempt = (attempts.get(purpose) || 0) + 1; attempts.set(purpose, attempt);
      recordCall(purpose, attempt);
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
        // Re-evaluating the same job against the same profile asks the same question.
        // The profile context hash and the sanitized posting are that question's
        // identity; a hit skips the provider call and keeps the stored, validated result.
        const provider = state.provider || this.defaultProvider;
        const evaluationData = { job: providerJob(job) };
        const cache = new AgentCache(this.workspace);
        // Key on what the judgment actually depends on: the profile context and the
        // sanitized posting. The rest of providerJob is bookkeeping (verification time,
        // stage, the previous evaluation) that this task itself changes, so including it
        // would make an otherwise identical re-evaluation miss its own cache entry.
        const cacheKey = cache.key({ provider, instruction: EVALUATE_INSTRUCTION, data: { contextHash: context.hash, job: { url: job.url, company: job.company, title: job.title, description: providerDescription(job.description || '') } } });
        const cached = await cache.get(cacheKey);
        const result = cached || await run(EVALUATE_INSTRUCTION, evaluationData);
        if (typeof result.score !== 'number' || result.score < 0 || result.score > 5 || !['Apply', 'Investigate', 'Skip'].includes(result.recommendation)) throw new Error('The agent returned an invalid evaluation. Retry.');
        requireText(result.summary, 'evaluation summary');
        for (const key of ['gaps', 'questions', 'legitimacyNotes']) result[key] = strings(result[key], key);
        list(result.matches, 'matches');
        if (result.matches.some(m => !hasEvidence(m, context) || !cleanEntry(m.text))) throw new Error('An evaluation claim lacks valid source evidence. Retry after checking your profile.');
        result.score = Math.round(result.score * 10) / 10;
        // The stored label is app policy; keep the model's own label for measurement.
        result.modelRecommendation = result.recommendation;
        if (result.score < 4 && result.recommendation === 'Apply') result.recommendation = 'Investigate';
        // Only a result that passed every check and policy adjustment is cached, so a
        // malformed reply is retried against the provider, never replayed.
        if (!cached) await cache.put(cacheKey, { provider, purpose: 'evaluate', result });
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
        const folded = foldedHumanize(state);
        let draft, review, humanizer;
        const reviewAttempts = [];
        // The master must cover the candidate's own resume. A first draft that leaves
        // lines out gets one more pass with those lines named; a revision the
        // candidate asked for is not second-guessed.
        const ownResume = context.sources.find(source => source.id === 'cv')?.text || '';
        // The candidate's own resume lines and every role, credential, degree and
        // numbered result in the sources: the two views of what a master must keep.
        const missingItems = entries => [...new Set([
          ...masterCoverage(ownResume, entries).missing,
          ...masterCompleteness(context.sources, entries).missing.map(item => item.label || item.text),
        ])];
        let missing = [], fallback = null, evidencePrompt = [], repairs = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const base = attempt ? draft : previous;
          try {
            draft = await run(STANDARD_INSTRUCTION, { ...lineData, ...foldInput(folded), ...(voiceTarget ? { voiceTarget } : {}), ...(request || attempt ? { previous: base } : {}), ...(request ? { revisionRequest: request } : {}), ...(attempt ? { reviewFeedback: [...evidencePrompt, ...(review?.issues || [])] } : {}), ...(attempt && missing.length ? { missingFromResume: missing } : {}) });
            requireText(draft.headline, 'headline'); requireText(draft.coverLetter, 'cover letter', 25000); list(draft.resume, 'resume', MASTER_RESUME_LIMIT);
            draft.suggestions = strings(draft.suggestions || [], 'optional suggestions');
            draft.resume = normalizeResume(dedupeResume(draft.resume.filter(keepMasterRow)), { sections: formatSections });
            const uncited = draft.resume.filter(item => !hasEvidence(item, context));
            if (!draft.resume.length) throw new Error(MASTER_EVIDENCE_ERROR);
            if (uncited.length) {
              if (attempt === 1) throw new Error(MASTER_EVIDENCE_ERROR);
              // This redraft is happening for the evidence failure; name the completeness
              // gaps in the same pass so they never cost a second retry of their own.
              missing = request ? [] : missingItems(draft.resume);
              evidencePrompt = evidenceRetryFeedback(uncited.map((item, index) => ({ kind: 'Resume entry', index, item })));
              await this.progress(id, 'Correcting claims without an exact source reference');
              continue;
            }
            for (const item of draft.resume) { requireText(item.section, 'resume section', 100); if (!headingOnlyRow(item) && !headingOnlyRoleRow(item)) requireText(item.text, 'resume entry', 10000); }
            verifyHeadings(draft.resume, context.sources.map(s => s.text).join('\n'));
            draft.resume = normalizeResume(draft.resume.filter(item => !blankText(item) || Boolean(item?.heading)), { sections: formatSections });
            if (!draft.resume.length) throw new Error(MASTER_EVIDENCE_ERROR);
            // On the last drafting pass, a stated credential or source role the draft
            // still omits is added from its exact quote before the review, so the
            // reviewer checks the complete master and the suggestions describe it.
            if (attempt === 1 && !request) {
              const completed = completeMasterResume(context.sources, draft.resume);
              repairs = completed.added;
              if (completed.added.length) {
                draft.resume = normalizeResume(completed.resume, { sections: formatSections });
                draft.suggestions = dropRepairedOmissions(draft.suggestions, completed.added);
              }
            }
            // A blank education or credential row is legal; the humanizer rewrites lines,
            // so restore its empty text if a pass added filler the renderer would show.
            const blankRows = draft.resume.map((item, index) => blankText(item) ? index : -1).filter(index => index >= 0);
            if (folded) humanizer = foldedHumanizer({ ...draft, answers: [] });
            else {
              await this.progress(id, 'Removing AI writing patterns');
              ({ packet: draft, report: humanizer } = applyHumanized({ ...draft, answers: [] }, await run(HUMANIZE_INSTRUCTION, { items: humanizeItems({ ...draft, answers: [] }), ...(voiceTarget ? { voiceTarget } : {}) }), { voiceTarget, voiceSamples }));
            }
            for (const index of blankRows) if (draft.resume[index]) draft.resume[index].text = '';
            draft.suggestions = guardSuggestions(draft.suggestions, draft.resume, draft.coverLetter);
            await this.progress(id, 'Checking factual claims against the original sources');
            review = await run(REVIEW_INSTRUCTION, { job: STANDARD_JOB, packet: { ...draft, answers: [] }, ...lineData });
            if (typeof review.passed !== 'boolean') throw new Error('The reviewer returned an invalid result. Retry.');
            review.issues = strings(review.issues, 'review issues');
            reviewAttempts.push({ attempt: attempt + 1, ...review });
            // A note-only finding never redrafts the master; the notes are dropped and
            // the reviewer's original issues stay in reviewAttempts for the record.
            const suggestionOnly = dropSuggestionIssues(draft, review);
            if (suggestionOnly) {
              review = { ...review, passed: true, issues: [], resolved: { kind: 'dropped-suggestions', ...suggestionOnly } };
              break;
            }
          } catch (error) {
            // A redraft that only added missing lines must not lose the reviewed first draft.
            check(); if (!fallback || error instanceof TaskPaused) throw error;
            ({ draft, review, humanizer } = fallback); repairs = []; break;
          }
          const reviewed = review.passed && !review.issues.length;
          if (attempt === 1 && fallback) {
            // Keep the first reviewed draft when the redraft is worse by either
            // measure: the candidate's own resume lines, or the completeness items
            // (roles, credentials, degrees, numbered results) parsed from the sources.
            const coverage = entries => masterCoverage(ownResume, entries).covered;
            const gaps = entries => masterCompleteness(context.sources, entries).counts.missing;
            if (!reviewed || coverage(draft.resume) < coverage(fallback.draft.resume) || gaps(draft.resume) > gaps(fallback.draft.resume)) { ({ draft, review, humanizer } = fallback); repairs = []; break; }
          }
          // The master must also keep every role, credential, degree and numbered
          // result the candidate's own sources state. Missing items join the resume
          // lines in the same one retry, so a dropped credential or old role costs no
          // extra drafting pass and is never silently absent (U03).
          missing = attempt === 0 && !request ? missingItems(draft.resume) : [];
          if (reviewed && !missing.length) break;
          if (reviewed) fallback = { draft, review, humanizer };
          if (attempt === 0) await this.progress(id, reviewed ? 'Adding resume lines the first draft left out' : 'Correcting unsupported claims using the reviewer’s source checks');
        }
        if (!review.passed || review.issues.length) throw new Error(`The factual review found issues in your master resume: ${review.issues.slice(0, 3).join(' ')}`);
        // Last resort after the one retry: a credential the candidate stated, or a role
        // the source resume states, is never lost because the draft omitted it. Each
        // added row carries its exact source quote; nothing is invented.
        if (!request) {
          const completed = completeMasterResume(context.sources, draft.resume);
          if (completed.added.length) {
            repairs = [...repairs, ...completed.added];
            draft.resume = normalizeResume(completed.resume, { sections: formatSections });
            draft.suggestions = dropRepairedOmissions(draft.suggestions, completed.added);
          }
        }
        const clean = { headline: draft.headline, resume: draft.resume.map(({ section, heading, text, evidence }) => ({ section, heading: heading || null, text, evidence })), coverLetter: draft.coverLetter, suggestions: draft.suggestions };
        const calibration = { ...gradePacket({ ...clean, answers: [] }, context.sources, review.calibration, candidateLine(state)), gradedAt: now() };
        await this.workspace.mutate(async latest => {
          check(); await this.assertContext(latest, context);
          latest.standard = { kind: 'master', draft: clean, review, reviewAttempts, humanizer, calibration, coverage: masterCoverage(ownResume, clean.resume), completeness: masterCompleteness(context.sources, clean.resume), ...(repairs.length ? { repairs: repairs.map(({ section, heading, text }) => ({ section, heading, text })) } : {}), contextHash: context.hash, createdAt: now(), approvedAt: null, approvedHash: null };
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
        const folded = foldedHumanize(state);
        let packet, humanizer, memory = null;
        let review, scopeGaps = [], credentialGaps = [];
        const reviewAttempts = [];
        let evidencePrompt = [];
        const draftStarted = now(), line = lineInput(state, job.id), lineData = { ...(line ? { candidateLine: line } : {}), ...(state.resumeFormat?.sections?.length ? { format: { sections: state.resumeFormat.sections } } : {}) };
        const jobText = `${job.title}\n${providerDescription(job.description || '')}`;
        for (let attempt = 0; attempt < 2; attempt++) {
          // roleOrder is the candidate's own order for experience; on a revision their request wins over it.
          packet = await run(PACKET_INSTRUCTION, { job: providerJob(job), roleAnswers: job.roleAnswers || '', ...lineData, ...foldInput(folded), ...(voiceTarget ? { voiceTarget } : {}), roleOrder: roleOrderOf(state), ...(standard && !revising ? { master: standard } : {}),
            ...(revising ? { revisionRequest: request, previousPacket: attempt ? packet : job.packet } : attempt ? { previousPacket: packet } : {}), ...(attempt ? { reviewFeedback: [...evidencePrompt, ...(review?.issues || [])] } : {}),
            ...(attempt && credentialGaps.length ? { missingFromResume: credentialGaps.map(item => `Keep the relevant credential: ${item.label || item.text}`) } : {}) });
          requireText(packet.headline, 'headline'); requireText(packet.coverLetter, 'cover letter', 25000);
          list(packet.resume, 'resume', 60); list(packet.answers, 'answers', 40); packet.questions = strings(packet.questions, 'questions');
          packet.suggestions = strings(packet.suggestions || [], 'optional suggestions');
          // A blank row is a lost line everywhere except an education or credential
          // heading that already states the school or issuer, the credential and the
          // dates; that row is legal and renders as the heading alone. The same
          // accomplishment written twice is dropped before humanize, review and
          // calibration, so their resume:<index> keys stay aligned.
          packet.resume = normalizeResume(dedupeResume(packet.resume.filter(keepResumeRow)), { sections: formatSections });
          const uncited = [
            ...packet.resume.map((item, index) => ({ kind: 'Resume entry', index, item })),
            ...packet.answers.map((item, index) => ({ kind: 'Answer', index, item })),
          ].filter(({ item }) => !hasEvidence(item, context));
          if (!packet.resume.length) throw new Error(PACKET_EVIDENCE_ERROR);
          if (uncited.length) {
            if (attempt === 1) throw new Error(PACKET_EVIDENCE_ERROR);
            // One retry carries every deterministic finding, so the letter check adds
            // no model call: the evidence failures and any repeated resume sentences
            // go in the same reviewFeedback.
            evidencePrompt = [...evidenceRetryFeedback(uncited), ...letterRetryFeedback(letterOverlaps(packet.coverLetter, packet.resume))];
            await this.progress(id, 'Correcting claims without an exact source reference');
            continue;
          }
          for (const item of packet.resume) { requireText(item.section, 'resume section', 100); if (!headingOnlyRow(item)) requireText(item.text, 'resume entry', 10000); }
          for (const item of packet.answers) { requireText(item.question, 'question', 2000); requireText(item.answer, 'answer', 15000); }
          verifyHeadings(packet.resume, context.sources.map(s => s.text).join('\n'));
          // A heading the sources cannot confirm may lose fields; keep a blank row only
          // while some part of its heading survives, never as an invisible empty line.
          packet.resume = normalizeResume(packet.resume.filter(item => !blankText(item) || Boolean(item?.heading)), { sections: formatSections });
          if (!packet.resume.length) throw new Error(PACKET_EVIDENCE_ERROR);
          // An accomplishment under no role, when the resume has exactly one Experience
          // role, belongs under it: move it and drop a line that only repeats the title.
          // With several roles the placement is ambiguous, so the draft is asked once and
          // the final packet names the problem in suggestions instead of guessing.
          const placement = repairMisplacedAccomplishments(packet.resume);
          if (placement.moved || placement.dropped) {
            packet.resume = normalizeResume(dedupeResume(placement.resume.filter(keepResumeRow)), { sections: formatSections });
            if (!packet.resume.length) throw new Error(PACKET_EVIDENCE_ERROR);
          }
          // Deterministic findings ride the existing one retry, before humanize and
          // review so their resume:<index> keys name the entries that will ship:
          // a misplaced accomplishment section, a plural the item's own evidence never
          // uses (scope stretch), and a credential the posting names or relates to that
          // the resume left out.
          scopeGaps = pluralScopeIssues(packet, { sources: context.sources });
          credentialGaps = relevantMissingCredentials({ master: standard, sources: context.sources, packet, jobText });
          if (attempt === 0 && (placement.ambiguous || scopeGaps.length || credentialGaps.length)) {
            evidencePrompt = [
              ...(placement.ambiguous ? [accomplishmentRetryFeedback(placement)] : []),
              ...scopeRetryFeedback(scopeGaps),
              ...credentialRetryFeedback(credentialGaps),
              ...letterRetryFeedback(letterOverlaps(packet.coverLetter, packet.resume)),
            ];
            await this.progress(id, placement.ambiguous ? 'Putting each accomplishment under its role' : credentialGaps.length ? 'Adding the credential this posting needs' : 'Keeping counts exactly as the sources state');
            continue;
          }
          // No retry is left: a credential the posting needs that the draft still omits
          // is carried from the approved master, row, heading and exact quote as the
          // candidate approved them, rather than shipping a packet without it.
          if (credentialGaps.length && standard) {
            const carried = masterCredentialRows(state.standard?.draft?.resume, credentialGaps)
              .filter(row => hasEvidence(row, context))
              .map(({ section, heading, text, evidence }) => ({ section, heading: heading || null, text, evidence }));
            if (carried.length) {
              packet.resume = normalizeResume([...packet.resume, ...carried], { sections: formatSections });
              packet.suggestions = dropRepairedOmissions(packet.suggestions, carried);
              credentialGaps = relevantMissingCredentials({ master: standard, sources: context.sources, packet, jobText });
            }
          }
          // Reuse before humanize and review: an approved factual answer whose quote is in
          // the current shared sources replaces the draft and carries its provenance. Held,
          // expired, out-of-scope or unproved entries and every candidate assertion stay out,
          // and the answer records why, so review still sees the sentence that will ship.
          const reusableAnswers = await new AnswerBank(this.workspace).load();
          applyReusableAnswers(packet, { answers: reusableAnswers, job, sources: context.sources, asOf: now().slice(0, 10) });
          // Deterministic memory pre-check: a question the profile, bank or this packet
          // already answers is not asked again, and a contradiction blocks only when this
          // packet cites one of its sources. Excluded sources are compared locally; their
          // text never enters a question.
          memory = prepareMemoryCheck({
            packet,
            sources: (await this.workspace.context({ ...state, contextPrefs: {} })).sources,
            profile: state.profile,
            decisions: state.conflictReview?.decisions || [],
            excludedSources: state.contextPrefs?.excludedSources || [],
            bank: reusableAnswers, job, asOf: now().slice(0, 10),
          });
          // The humanizer rewrites lines; a heading-only row that was blank before the
          // pass stays blank, so a rewrite cannot turn it into "Graduated." filler.
          const blankRows = packet.resume.map((item, index) => blankText(item) ? index : -1).filter(index => index >= 0);
          if (folded) humanizer = foldedHumanizer(packet);
          else {
            await this.progress(id, 'Removing AI writing patterns');
            ({ packet, report: humanizer } = applyHumanized(packet, await run(HUMANIZE_INSTRUCTION, { items: humanizeItems(packet), ...(voiceTarget ? { voiceTarget } : {}) }), { voiceTarget, voiceSamples }));
          }
          for (const index of blankRows) if (packet.resume[index]) packet.resume[index].text = '';
          // The final attempt never blocks on these quality findings; it records them
          // for the candidate. Recomputed on the rewritten text, so a humanizer pass
          // cannot hide a count or credential finding behind changed wording.
          const finalScope = pluralScopeIssues(packet, { sources: context.sources });
          const finalCredentials = relevantMissingCredentials({ master: standard, sources: context.sources, packet, jobText });
          packet.suggestions = guardSuggestions(packet.suggestions, packet.resume, packet.coverLetter);
          if (placement.ambiguous) packet.suggestions = [accomplishmentSuggestion(placement), ...packet.suggestions].slice(0, 40);
          if (finalScope.length) packet.suggestions = [...scopeSuggestions(finalScope), ...packet.suggestions].slice(0, 40);
          if (finalCredentials.length) packet.suggestions = [...finalCredentials.map(credentialSuggestion), ...dropCredentialInclusionClaims(packet.suggestions, finalCredentials)].slice(0, 40);
          await this.progress(id, 'Checking factual claims against the original sources');
          review = await run(REVIEW_INSTRUCTION, { job: providerJob(job), packet, ...lineData });
          if (typeof review.passed !== 'boolean') throw new Error('The reviewer returned an invalid result. Retry.');
          review.issues = strings(review.issues, 'review issues');
          reviewAttempts.push({ attempt: attempt + 1, ...review });
          // A review issue that clearly targets a suggestion or note is fixed by
          // dropping the notes, not by spending a full draft+humanize+review cycle.
          // Any issue naming a document fact still goes to the redraft.
          const suggestionOnly = dropSuggestionIssues(packet, review);
          if (suggestionOnly) {
            review = { ...review, passed: true, issues: [], resolved: { kind: 'dropped-suggestions', ...suggestionOnly } };
            break;
          }
          if (review.passed && !review.issues.length) break;
          if (attempt === 0) {
            // The reviewer's own retry already re-runs the drafter; name any repeated
            // resume sentences there too instead of spending another call on them.
            // Letter overlap alone never starts a retry: it rides on this one, and
            // after the loop it becomes a suggestion only.
            evidencePrompt = [...evidencePrompt, ...letterRetryFeedback(letterOverlaps(packet.coverLetter, packet.resume))];
            await this.progress(id, 'Correcting unsupported claims using the reviewer’s source checks');
          }
        }
        // Quality, never a factual gate: the packet is kept, and the overlap is left in
        // suggestions for the next draft.
        const repeatedInLetter = letterOverlaps(packet.coverLetter, packet.resume);
        if (repeatedInLetter.length) packet.suggestions = [overlapSuggestion(repeatedInLetter), ...packet.suggestions].slice(0, 40);
        job.review = review;
        job.reviewAttempts = reviewAttempts;
        if (!review.passed || review.issues.length) {
          await this.workspace.mutate(latest => { const current = latest.jobs.find(j => j.id === job.id); current.review = review; current.reviewAttempts = reviewAttempts; if (job.callLog) current.callLog = job.callLog; current.stage = 'review-blocked'; current.approvedHash = null; });
          throw new Error('The factual review found issues. Review the findings in the application and add missing evidence before retrying.');
        }
        // How each claim compares with its evidence: undersold, balanced, stretched or unsupported.
        // The saved description is never rewritten; grade against the same sanitized copy the
        // provider sees, so a sentence addressed to AI tools cannot whitelist a number.
        job.calibration = { ...gradePacket(packet, context.sources, review.calibration, candidateLine(state), { jobText: providerDescription(job.description || '') }), gradedAt: now(), line: Boolean(line) };
        job.fromStandard = compareToStandard(packet, standard);
        job.humanizer = humanizer;
        // The evaluation runner persists the packet, not the job: carry the call log on
        // the packet so a live run shows which purpose produced a second attempt.
        packet.callLog = job.callLog;
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
          recordQuestionChecks(latest, memory?.settled, { jobId: job.id });
          markApplied(latest, job.id, draftStarted);
          if (revising) latest.revisions = [...(latest.revisions || []), { at: now(), jobId: job.id, request }].slice(-200);
          await this.workspace.write(`output/packet-${job.id}.json`, JSON.stringify({ jobId: job.id, company: job.company, role: job.title, contextHash: context.hash, packet, review, reviewAttempts, calibration: job.calibration, callLog: job.callLog, ...artifacts }, null, 2));
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
        // A failed preparation keeps its call log too: the attempt ordinals are the
        // evidence for why a live run spent a second draft cycle.
        const current = job ? latest.jobs.find(j => j.id === job.id) : null;
        if (current) {
          if (job.callLog) current.callLog = job.callLog;
          if (job.verification) current.verification = job.verification;
        }
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
