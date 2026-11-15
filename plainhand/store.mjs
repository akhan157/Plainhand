import { randomUUID, createHash } from 'node:crypto';
import { FileStorage } from './storage.mjs';
import yaml from 'js-yaml';
import { trackerNote } from './application-record.mjs';

export const now = () => new Date().toISOString();
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function requireText(value, label, max = 100000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must contain 1–${max} characters.`);
  return value.trim();
}
export const cleanText = (value, max = 100000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const emptyProfile = () => ({ name: '', email: '', phone: '', location: '', timezone: '', roles: '', compensation: '', eligibility: '', graduation: '', links: '', resume: '', story: '', voice: '', constraints: '' });
export function initialState() {
  return { version: 1, revision: 0, profile: emptyProfile(), provider: null, jobs: [], sources: [], tasks: [], conversation: [], understanding: null, events: [] };
}

export class Workspace {
  // new Workspace(root) is the local app (a folder). Hosted Plainhand passes its own
  // { storage } (one Postgres-backed store per user); root is then only a label.
  constructor(root, { storage } = {}) {
    this.storage = storage || new FileStorage(root);
    this.root = this.storage.root || String(root || '');
    this.file = 'data/plainhand/workspace.json'; this.chain = Promise.resolve(); this.listeners = new Set();
  }
  // True when the workspace is a folder on this computer (browser form filling, lib/ tools).
  get local() { return this.storage.local === true; }
  // Called with the new revision after every committed mutation (the live event stream uses this).
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  // Absolute path of a workspace file. Local workspaces only; hosted ones throw.
  async safe(relative) { return this.storage.resolve(relative); }
  async read(relative, fallback = '') {
    const data = await this.storage.read(relative);
    return data === null ? fallback : data.toString('utf8');
  }
  async readBinary(relative) { return this.storage.read(relative); }
  async write(relative, content) { await this.storage.write(relative, typeof content === 'string' ? Buffer.from(content, 'utf8') : content); }
  async list(directory) { return this.storage.list(directory); }
  async remove(relative) { return this.storage.remove(relative); }
  browserCheckpointFile(id) {
    return `data/plainhand/checkpoints/${digest(String(id))}.json`;
  }
  async saveBrowserCheckpoint(job) {
    if (!job.approvedHash || job.browserCheckpoint?.packetHash !== job.approvedHash) throw new Error('Cannot journal a checkpoint without its exact packet approval.');
    await this.write(this.browserCheckpointFile(job.id), JSON.stringify(job.browserCheckpoint, null, 2) + '\n');
  }
  async restoreBrowserCheckpoints(state) {
    for (const job of state.jobs) {
      const raw = await this.read(this.browserCheckpointFile(job.id));
      if (!raw) continue;
      const checkpoint = JSON.parse(raw);
      if (!job.approvedHash || checkpoint.packetHash !== job.approvedHash) continue;
      if (!checkpoint.at || !checkpoint.result || !Array.isArray(checkpoint.result.filled) || !Array.isArray(checkpoint.result.skipped)) continue;
      if (!job.browserCheckpoint || checkpoint.at > job.browserCheckpoint.at) job.browserCheckpoint = checkpoint;
    }
    return state;
  }
  async load() {
    const raw = await this.read(this.file);
    if (raw) {
      const state = JSON.parse(raw); // Corrupt state is an error, never silently reset.
      const configRaw = await this.read('config/profile.yml');
      if (configRaw) {
        const config = yaml.load(configRaw) || {};
        const c = config.candidate || {}, p = state.profile;
        for (const [field, value] of Object.entries({ name: c.full_name, email: c.email, phone: c.phone, location: c.location, timezone: config.location?.timezone, eligibility: config.location?.visa_status, compensation: config.compensation?.target_range })) if (typeof value === 'string') p[field] = value;
        if (Array.isArray(config.target_roles?.primary)) p.roles = config.target_roles.primary.join(', ');
      }
      const cv = await this.read('cv.md');
      if (cv) state.profile.resume = cv.trim();
      const tracker = await this.read('data/applications.md');
      for (const line of tracker.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l))) {
        const c = line.split('|').map(s => s.trim());
        const job = state.jobs.find(j => j.company.toLowerCase() === c[3]?.toLowerCase() && j.title.toLowerCase() === c[4]?.toLowerCase());
        if (job) job.status = c[6];
      }
      return this.restoreBrowserCheckpoints(state);
    }
    const state = initialState();
    const config = yaml.load(await this.read('config/profile.yml')) || {};
    const p = state.profile;
    Object.assign(p, { name: config.candidate?.full_name || '', email: config.candidate?.email || '', phone: config.candidate?.phone || '', location: config.candidate?.location || config.location?.city || '', timezone: config.location?.timezone || '', roles: (config.target_roles?.primary || []).join(', '), compensation: config.compensation?.target_range || '', eligibility: config.location?.visa_status || '', resume: await this.read('cv.md') });
    return state;
  }
  mutate(fn) {
    const commit = async () => {
      const state = await this.load();
      const result = await fn(state);
      state.revision += 1;
      await this.write(this.file, JSON.stringify(state, null, 2) + '\n');
      return { result, revision: state.revision };
    };
    // A shared store (hosted Postgres) locks the candidate's workspace for the whole
    // read-modify-write, since other server instances may be mutating it too.
    const operation = this.chain.then(async () => {
      const { result, revision } = this.storage.exclusive ? await this.storage.exclusive(commit) : await commit();
      for (const listener of this.listeners) { try { listener(revision); } catch {} }
      return result;
    });
    this.chain = operation.catch(() => {});
    return operation;
  }
  async context(state) {
    // The candidate decides what reaches the provider: excluded sources and profile fields
    // are left out here, which also changes the fingerprint and so invalidates approvals.
    const prefs = state.contextPrefs || {};
    const excludedFields = new Set(prefs.excludedFields || []), excludedSources = new Set(prefs.excludedSources || []);
    const sources = [
      { id: 'profile', text: JSON.stringify(Object.fromEntries(Object.entries(state.profile).filter(([key]) => key !== 'resume' && !excludedFields.has(key))), null, 2) },
      { id: 'cv', text: state.profile.resume || await this.read('cv.md') },
    ];
    const interview = state.conversation.filter(m => m.role === 'user').map(m => m.text).join('\n\n');
    if (interview) sources.push({ id: 'interview', text: interview });
    for (const [id, file] of [['structured-resume', 'data/resume-source.yml'], ['narrative', 'modes/_profile.md'], ['proof-points', 'article-digest.md'], ['stories', 'interview-prep/story-bank.md']]) {
      const text = await this.read(file);
      const isTemplate = id === 'narrative' && text === await this.read('modes/_profile.template.md');
      if (text && !isTemplate) sources.push({ id, text: text.slice(0, 50000) });
    }
    // Writing samples are the candidate's own text, used for voice rather than facts.
    const samples = (state.writingSamples || []).map(s => `## ${s.title || 'Sample'}\n${s.text}`).join('\n\n');
    if (samples) sources.push({ id: 'writing-samples', text: samples.slice(0, 50000) });
    for (let i = sources.length - 1; i >= 0; i--) if (sources[i].id !== 'profile' && excludedSources.has(sources[i].id)) sources.splice(i, 1);
    const baseHash = digest(sources);
    if (state.understanding?.approved && state.understanding.contextHash === baseHash) sources.push({ id: 'reviewed-understanding', text: JSON.stringify(state.understanding.result) });
    return { sources, hash: digest(sources), baseHash };
  }
  async saveProfile(input, expectedRevision) {
    return this.mutate(async state => {
      if (expectedRevision !== state.revision) throw new Error('Your workspace changed. Reload before saving.');
      const profile = Object.fromEntries(Object.keys(emptyProfile()).map(key => [key, cleanText(input[key])]));
      if (!profile.name || !profile.resume) throw new Error('Add your name and resume to start your profile.');
      if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new Error('Enter a valid email address.');
      if (await this.read('data/resume-source.yml') && profile.resume !== state.profile.resume) throw new Error('This workspace has a structured resume. Update data/resume-source.yml and rebuild it before changing its mirror.');
      // Back up before an explicit user save; preserve unrecognized legacy fields.
      const oldConfig = await this.read('config/profile.yml');
      const oldCv = await this.read('cv.md');
      const stamp = randomUUID();
      if (oldConfig) await this.write(`data/plainhand/backups/${stamp}-profile.yml`, oldConfig);
      if (oldCv && oldCv !== profile.resume) await this.write(`data/plainhand/backups/${stamp}-cv.md`, oldCv);
      const config = yaml.load(oldConfig) || {};
      config.candidate = { ...config.candidate, full_name: profile.name, email: profile.email, phone: profile.phone, location: profile.location };
      config.target_roles = { ...config.target_roles, primary: profile.roles.split(/[,\n]/).map(s => s.trim()).filter(Boolean) };
      config.location = { ...config.location, timezone: profile.timezone, visa_status: profile.eligibility };
      config.compensation = { ...config.compensation, target_range: profile.compensation };
      await this.write('config/profile.yml', yaml.dump(config));
      if (!await this.read('data/resume-source.yml')) await this.write('cv.md', profile.resume + '\n');
      if (!await this.read('modes/_profile.md')) await this.write('modes/_profile.md', '# Candidate narrative\n\n' + profile.story + '\n');
      if (!await this.read('portals.yml')) await this.write('portals.yml', 'tracked_companies: []\n');
      state.profile = profile;
      state.understanding = null;
      for (const job of state.jobs) { job.approvedHash = null; if (job.packet) job.stage = 'needs-refresh'; }
      state.events.unshift({ at: now(), text: 'Profile saved. Existing application approvals were cleared.' });
    });
  }
}

// Claim evidence: only sources that state facts about the candidate can ground a
// claim. Writing samples guide voice, and the reviewed understanding is the agent's
// own summary, so neither one is factual evidence.
export const FACTUAL_SOURCE_IDS = Object.freeze(['profile', 'cv', 'structured-resume', 'narrative', 'proof-points', 'stories', 'interview']);
const FACTUAL_SOURCES = new Set(FACTUAL_SOURCE_IDS);
// The specific refusal a non-factual source gets, so answer storage and corrections
// can say why instead of only "invalid evidence".
export const NON_FACTUAL_SOURCE_REASONS = Object.freeze({
  'writing-samples': 'a factual source quote, not a writing sample: samples record how you write, never what is true',
  'reviewed-understanding': 'a factual source quote, not the reviewed understanding: it is the agent’s summary of your sources, not a source',
});
export const factualSource = sourceId => FACTUAL_SOURCES.has(sourceId);
export const nonFactualSource = sourceId => Object.hasOwn(NON_FACTUAL_SOURCE_REASONS, sourceId) ? NON_FACTUAL_SOURCE_REASONS[sourceId] : null;

// Identity negative control. An answer may not introduce an employer, seniority
// title, date or name that the candidate's factual sources never state. The check
// is deliberately narrow so ordinary prose is not mistaken for an identity claim:
//   - every four-digit year must be a token in a factual source (dates are identity);
//   - a seniority title directly before "at <Organisation>" in a sentence that also
//     carries a year, or a past "worked at <Organisation>" frame with a year, must
//     appear in the sources; the organisation must appear there too;
//   - an explicit name introduction ("my name is …") must appear in the sources.
// A title or employer asserted without any date is left to the reviewer; see
// docs/internal/lanes/durable-memory/RESULT.md for that residual.
const SENIORITY_TITLES = ['director', 'manager', 'head', 'lead', 'president', 'vice president', 'vp', 'chief', 'ceo', 'cto', 'cfo', 'coo', 'founder', 'co-founder', 'owner', 'partner', 'principal', 'supervisor'];
const escapeWord = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SENIORITY = new RegExp(`\\b(?:${SENIORITY_TITLES.map(escapeWord).join('|')})\\b`, 'gi');
const ORG_AT = /\b[Aa]t\s+(?:the\s+)?((?:[A-Z][\w'’&.-]*)(?:\s+(?:[A-Z][\w'’&.-]*|of|and|&)){0,4})/g;
const WORKED_AT = /\b(?:worked|served|employed)\s+at\s+(?:the\s+)?((?:[A-Z][\w'’&.-]*)(?:\s+(?:[A-Z][\w'’&.-]*|of|and|&)){0,4})/g;
const NAME_INTRO = /\b(?:[Mm]y name is|[Ii] go by|[Cc]all me)\s+([A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,2})/g;
const YEAR = /(?<![$\d])\b(?:19|20)\d{2}\b(?![%\d])/g;
const ORG_STOPWORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in', '&']);
const claimWords = value => String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
// Seniority words are compared on a short stem so "manager" matches "managed" and
// "director" matches "directed"; an absent title still fails.
const titleStem = word => word.length > 5 ? word.slice(0, 5) : word;
const vocabularyCache = new WeakMap();
function sourceVocabulary(sources) {
  if (!Array.isArray(sources)) return { words: new Set(), stems: new Set() };
  const cached = vocabularyCache.get(sources);
  if (cached) return cached;
  const words = new Set(), stems = new Set();
  for (const source of sources) {
    if (!factualSource(source?.id)) continue;
    for (const word of claimWords(source.text)) { words.add(word); stems.add(titleStem(word)); }
  }
  const vocabulary = { words, stems };
  vocabularyCache.set(sources, vocabulary);
  return vocabulary;
}
export function identityProblem(text, sources) {
  const claim = String(text || '');
  if (!claim.trim()) return null;
  const { words, stems } = sourceVocabulary(sources);
  const problems = [];
  // Only history is identity. A year before this one must be in the sources; this
  // year or later need not be ("I can start in June 2026", "June 2026 works for me").
  // No word list: wording around a historical claim cannot exempt it.
  const thisYear = new Date().getFullYear();
  const sentences = claim.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const years = sentence => sentence.match(YEAR) || [];
  const missingYears = [...new Set(sentences.flatMap(years))].filter(year => Number(year) < thisYear && !words.has(year));
  if (missingYears.length) problems.push(`date ${missingYears.join(', ')}`);
  for (const sentence of sentences) {
    // A dated role or employer frame is identity, including one dated this year
    // ("Director at Northwind, 2026"); a future-dated one is an ambition.
    if (!years(sentence).some(year => Number(year) <= thisYear)) continue;
    const checkOrg = (match, withTitle) => {
      if (withTitle) {
        const titles = [...sentence.slice(0, match.index).matchAll(SENIORITY)].map(item => item[0]);
        const title = titles.at(-1);
        if (!title) return;
        if (!stems.has(titleStem(title.toLowerCase()))) problems.push(`title ${title}`);
      }
      const missing = claimWords(match[1]).filter(word => !ORG_STOPWORDS.has(word) && !words.has(word));
      if (missing.length) problems.push(`employer ${[...new Set(missing)].join(' ')}`);
    };
    for (const match of sentence.matchAll(ORG_AT)) checkOrg(match, true);
    for (const match of sentence.matchAll(WORKED_AT)) checkOrg(match, false);
  }
  for (const match of claim.matchAll(NAME_INTRO)) {
    const missing = claimWords(match[1]).filter(word => !words.has(word));
    if (missing.length) problems.push(`name ${[...new Set(missing)].join(' ')}`);
  }
  return problems.length ? [...new Set(problems)].join('; ') : null;
}

// Why a claim's evidence is unusable, or null when it is valid. This is the
// specific refusal behind hasEvidence, so a caller that explains a failure can
// name the source kind instead of saying only "invalid evidence".
export function claimEvidenceProblem(item, context) {
  const evidence = item?.evidence;
  if (!Array.isArray(evidence) || !evidence.length) return 'at least one exact source quote of at least 8 characters';
  for (const entry of evidence) {
    const kind = nonFactualSource(entry?.sourceId);
    if (kind) return kind;
    if (!factualSource(entry?.sourceId)) return `a factual source (${FACTUAL_SOURCE_IDS.join(', ')}), not “${entry?.sourceId}”`;
    if (typeof entry.quote !== 'string' || entry.quote.trim().length < 8) return 'an exact source quote of at least 8 characters';
  }
  const sources = Array.isArray(context?.sources) ? context.sources : [];
  if (!evidence.every(entry => sources.some(source => source.id === entry.sourceId && String(source.text).includes(entry.quote)))) return 'a quote that appears in the current source';
  // Identity statements in an answer or form value need their own grounding; resume
  // lines keep their heading check (resume-format.mjs) and the reviewer.
  if (typeof item?.answer === 'string') {
    const identity = identityProblem(item.answer, sources);
    if (identity) return `identity facts that appear in the sources (${identity})`;
  }
  return null;
}

export function hasEvidence(item, context) {
  return claimEvidenceProblem(item, context) === null;
}

const cell = value => String(value ?? '').replace(/[\t\r\n|]/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')');
// A status change is recorded, not overwritten: the canonical tracker keeps the
// current value while the job keeps bounded history for later outcome analysis.
export function recordStatusChange(job, status, at = new Date().toISOString()) {
  const from = job.status || null;
  job.status = status;
  job.statusHistory = [...(Array.isArray(job.statusHistory) ? job.statusHistory : []), { from, to: status, at }].slice(-50);
  return job.statusHistory.at(-1);
}
export async function syncTracker(workspace, state) {
  const header = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|';
  let text = await workspace.read('data/applications.md');
  if (!text) text = '# Applications\n\n' + header + '\n';
  const lines = text.trimEnd().split('\n');
  let max = Math.max(0, ...lines.filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => Number(l.split('|')[1].trim())));
  for (const job of state.jobs.filter(j => j.evaluation)) {
    const index = lines.findIndex(l => {
      const c = l.split('|').map(s => s.trim());
      return c[3]?.toLowerCase() === job.company.toLowerCase() && c[4]?.toLowerCase() === job.title.toLowerCase();
    });
    const old = index >= 0 ? lines[index].split('|').map(s => s.trim()) : null;
    const number = old ? old[1] : String(++max);
    const report = job.reportPath ? `[${number}](${job.reportPath.replace(/^reports\//, '../reports/')})` : '';
    const status = job.status || old?.[6] || 'Evaluated';
    const row = `| ${number} | ${job.createdAt.slice(0, 10)} | ${cell(job.company)} | ${cell(job.title)} | ${job.evaluation.score}/5 | ${cell(status)} | ${job.pdf ? '✅' : '—'} | ${report} | ${cell(trackerNote(job))} |`;
    if (index >= 0) lines[index] = row; else lines.push(row);
    job.trackerNumber = number;
  }
  await workspace.write('data/applications.md', lines.join('\n') + '\n');
}
