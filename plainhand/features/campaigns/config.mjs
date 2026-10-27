// Campaign configuration and storage. One user-layer file holds every campaign
// (data/plainhand/campaigns.json), so pausing or changing a campaign is a single
// write. Run history, health, the seen-role ledger and daily evaluation counts
// are runtime data in data/plainhand/campaign-runs.json; deleting that file only
// forgets history, never a campaign.
import { randomUUID } from 'node:crypto';
import { validateCampaignConfig } from '../../../campaign-state.mjs';

export const CONFIG_FILE = 'data/plainhand/campaigns.json';
export const RUNS_FILE = 'data/plainhand/campaign-runs.json';
export const SCAN_HISTORY_FILE = 'data/plainhand/scan-history.json';
export const MIN_HOURS = 6;
export const MAX_HOURS = 168;
export const MAX_EVALUATIONS = 10;
export const MAX_CAMPAIGNS = 25;
const HOUR = 3600000;

export class CampaignInputError extends Error {}
const fail = message => { throw new CampaignInputError(message); };

// 'manual' | 'daily' | 'every N hours' (N from 6 to 168). Returns the stored form.
export function parseSchedule(value = 'manual') {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text || text === 'manual') return 'manual';
  if (text === 'daily' || text === 'every day' || text === 'every 24 hours') return 'daily';
  const match = /^every (\d{1,3}) ?(?:h|hr|hrs|hour|hours)$/.exec(text);
  if (!match) fail('Schedule must be manual, daily, or "every N hours" (at least 6).');
  const hours = Number(match[1]);
  if (hours < MIN_HOURS) fail(`Scheduled scans run at most every ${MIN_HOURS} hours, so job boards are not checked too often.`);
  if (hours > MAX_HOURS) fail('Use a schedule of at most every 168 hours (one week).');
  return hours === 24 ? 'daily' : `every ${hours} hours`;
}
export function intervalMs(schedule) {
  if (schedule === 'daily') return 24 * HOUR;
  const match = /^every (\d+) hours$/.exec(schedule || '');
  return match ? Number(match[1]) * HOUR : null;
}
export const scheduleLabel = schedule => schedule === 'manual' ? 'Manual only' : schedule === 'daily' ? 'Daily' : `Every ${intervalMs(schedule) / HOUR} hours`;

const list = (value, label, { max = 20, length = 80 } = {}) => {
  if (value === undefined || value === null) return [];
  const items = (Array.isArray(value) ? value : String(value).split(/[,\n]/)).map(item => String(item).trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (items.length > max) fail(`Use at most ${max} ${label}.`);
  for (const item of items) if (item.length > length) fail(`Each of the ${label} must be at most ${length} characters.`);
  return [...new Map(items.map(item => [item.toLowerCase(), item])).values()];
};

// Validates a full campaign (create) or a merged one (update). sources is the
// workspace source list, so unknown source ids are rejected.
export function normalizeCampaign(input, { existing = null, sources = [], campaigns = [], at = new Date().toISOString() } = {}) {
  const merged = { ...(existing || {}), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
  const name = String(merged.name ?? '').trim().replace(/\s+/g, ' ');
  const terms = list(merged.terms, 'role keywords');
  const locations = list(merged.locations, 'locations');
  const exclusions = list(merged.exclusions, 'exclusions', { max: 30 });
  const dailyEvaluationLimit = merged.dailyEvaluationLimit ?? 0;
  // The shared campaign contract checks the name, criteria and daily limit shape.
  const shared = validateCampaignConfig({ name, roles: terms, locations, dailyReviewLimit: dailyEvaluationLimit });
  if (!shared.valid) fail(shared.errors.map(error => error.replace('dailyReviewLimit', 'dailyEvaluationLimit')).join('; ').replace(/^name is required/, 'Give the campaign a name.'));
  if (!terms.length) fail('Add at least one role keyword, so the campaign surfaces a few relevant roles rather than everything on a board.');
  if (dailyEvaluationLimit > MAX_EVALUATIONS) fail(`The daily evaluation limit is at most ${MAX_EVALUATIONS}.`);
  if (campaigns.some(c => c.id !== existing?.id && c.name.toLowerCase() === name.toLowerCase())) fail('Another campaign already has this name.');
  const sourceIds = [...new Set(Array.isArray(merged.sourceIds) ? merged.sourceIds.map(String) : [])];
  for (const id of sourceIds) if (!sources.some(source => source.id === id)) fail('One of the chosen job sources no longer exists. Pick from your current sources.');
  const notify = { inApp: true, desktop: Boolean(input.desktop ?? merged.notify?.desktop ?? false) };
  return {
    id: existing?.id || randomUUID(),
    name, terms, locations, exclusions, sourceIds,
    schedule: parseSchedule(merged.schedule),
    dailyEvaluationLimit,
    liveness: merged.liveness !== false,
    paused: Boolean(merged.paused),
    notify,
    createdAt: existing?.createdAt || at,
    updatedAt: at,
  };
}

// Serialised read-modify-write per workspace (the files are only written here).
const chains = new WeakMap();
async function readJson(workspace, file, fallback) {
  const raw = await workspace.read(file);
  if (!raw) return fallback();
  try { return JSON.parse(raw); } catch { throw new Error(`${file} is not valid JSON. Fix or remove it; Plainhand never overwrites an unreadable campaign file.`); }
}
export const emptyConfig = () => ({ version: 1, campaigns: [] });
export const emptyRuns = () => ({ version: 1, runs: {}, health: {}, seen: {}, evaluations: {} });
export async function loadConfig(workspace) {
  const config = await readJson(workspace, CONFIG_FILE, emptyConfig);
  if (!Array.isArray(config.campaigns)) config.campaigns = [];
  return config;
}
export async function loadRuns(workspace) {
  const runs = await readJson(workspace, RUNS_FILE, emptyRuns);
  for (const key of ['runs', 'health', 'seen', 'evaluations']) if (!runs[key] || typeof runs[key] !== 'object') runs[key] = {};
  return runs;
}
// fn(config, runs) mutates either; both are written only if fn succeeds.
export function mutateCampaigns(workspace, fn) {
  const previous = chains.get(workspace) || Promise.resolve();
  const operation = previous.then(async () => {
    const config = await loadConfig(workspace), runs = await loadRuns(workspace);
    const before = [JSON.stringify(config), JSON.stringify(runs)];
    const result = await fn(config, runs);
    if (JSON.stringify(config) !== before[0]) await workspace.write(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
    if (JSON.stringify(runs) !== before[1]) await workspace.write(RUNS_FILE, JSON.stringify(runs, null, 2) + '\n');
    return result;
  });
  chains.set(workspace, operation.catch(() => {}));
  return operation;
}

// When a campaign is next due: never for manual or paused ones; right away for a
// scheduled one that has never run; otherwise one interval after the last start.
// A run missed while Plainhand was closed is due once, never once per missed slot.
export function nextRunAt(campaign, health, { ignorePause = false } = {}) {
  const interval = intervalMs(campaign.schedule);
  if (!interval || (campaign.paused && !ignorePause)) return null;
  const last = health?.lastRunAt ? Date.parse(health.lastRunAt) : null;
  return new Date(last ? last + interval : Date.parse(campaign.updatedAt || campaign.createdAt)).toISOString();
}
export function isDue(campaign, health, now) { const next = nextRunAt(campaign, health); return Boolean(next) && Date.parse(next) <= now.getTime(); }

export function localDay(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
