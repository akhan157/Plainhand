import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
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
  constructor(root) { this.root = path.resolve(root); this.file = 'data/plainhand/workspace.json'; this.chain = Promise.resolve(); this.listeners = new Set(); }
  // Called with the new revision after every committed mutation (the live event stream uses this).
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async safe(relative) {
    const full = path.resolve(this.root, relative);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Path outside workspace.');
    let current = this.root;
    for (const part of path.relative(this.root, full).split(path.sep)) {
      current = path.join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Workspace files cannot be symbolic links.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return full;
  }
  async read(relative, fallback = '') {
    try { return await readFile(await this.safe(relative), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async write(relative, content) {
    const file = await this.safe(relative);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomUUID() + '.tmp';
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, file);
  }
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
    const operation = this.chain.then(async () => {
      const state = await this.load();
      const result = await fn(state);
      state.revision += 1;
      await this.write(this.file, JSON.stringify(state, null, 2) + '\n');
      for (const listener of this.listeners) { try { listener(state.revision); } catch {} }
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

export function hasEvidence(item, context) {
  return Array.isArray(item?.evidence) && item.evidence.length > 0 && item.evidence.every(e => e.sourceId !== 'reviewed-understanding' && typeof e.quote === 'string' && e.quote.trim().length >= 8 && context.sources.some(s => s.id === e.sourceId && s.text.includes(e.quote)));
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
