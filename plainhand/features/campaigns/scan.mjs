// One campaign run: scan each chosen source, keep roles that match, drop roles
// already in the workspace or already seen, check liveness, and explain each
// role that is surfaced. Nothing here writes; the caller persists the outcome.
//
// Re-surfacing rule: a role is surfaced once. It is surfaced again only when it
// meaningfully changed since it was last seen by a campaign:
//   - reposted: it was seen closed (liveness) or gone from its board on an
//     earlier successful scan, and is listed again; or
//   - retitled: the same posting URL now carries a different title.
// A role already in the workspace is never surfaced again (its saved row is the
// single record). Roles reported by the command-line scan history count as seen.
import { runScan } from '../../scan-runner.mjs';
import { jobUrl } from '../../jobs.mjs';

const key = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const roleKey = role => key(`${role.company} | ${role.title}`);
const urlOf = value => { try { return jobUrl(value); } catch { return null; } };
const day = iso => String(iso || '').slice(0, 10);
const LEDGER_LIMIT = 5000;

export function describeReason({ campaign, job, source, firstSeenAt, change, live }) {
  const title = key(job.title);
  const matched = campaign.terms.filter(term => title.includes(key(term)));
  const place = campaign.locations.find(location => key(job.location).includes(key(location)));
  const parts = [
    `matched ${matched.map(term => `"${term}"`).join(', ') || 'your keywords'} in the title`,
    place ? `in ${job.location}` : job.location ? `location ${job.location}` : 'no location listed',
    `source ${source.name} board`,
    `first seen ${day(firstSeenAt)}`,
  ];
  if (change) parts.push(change);
  if (live === 'active') parts.push('posting checked and open');
  else if (live === 'unconfirmed') parts.push('posting could not be confirmed open; check it before applying');
  const text = parts.join('; ');
  return text[0].toUpperCase() + text.slice(1);
}

// deps: { scanner(source, filter, location), verifier(job), now: Date, check() }
export async function runCampaign({ campaign, state, runs, history = [], deps }) {
  const at = deps.now.toISOString();
  const chosen = campaign.sourceIds.length ? state.sources.filter(s => campaign.sourceIds.includes(s.id)) : state.sources;
  const run = { campaignId: campaign.id, campaignName: campaign.name, startedAt: at, status: 'ok', sources: [], surfaced: [], counts: { found: 0, matched: 0, surfaced: 0, alreadySaved: 0, alreadySeen: 0, filtered: 0, closed: 0, resurfaced: 0 }, notes: [] };
  if (!chosen.length) { run.status = 'failed'; run.notes.push(state.sources.length ? 'None of this campaign’s job sources exist any more. Edit the campaign to pick sources.' : 'Add a company career board under Jobs first.'); return { run, seen: {} }; }

  const ledger = { ...(runs.seen || {}) };
  const updates = {};
  const entry = url => updates[url] || ledger[url] || null;
  const byRole = new Map();
  for (const value of Object.values(ledger)) byRole.set(roleKey(value), value);
  for (const value of history) {
    const url = urlOf(value.url);
    if (url && !ledger[url]) { const synthetic = { url, company: value.company, title: value.title, state: 'open', firstSeenAt: value.seenAt || at, lastSeenAt: value.seenAt || at, campaignId: null, sourceId: null, via: 'scan-history' }; ledger[url] ??= synthetic; byRole.set(roleKey(synthetic), synthetic); }
  }
  const taken = [...state.jobs];
  const exclusions = campaign.exclusions.map(key);

  for (const source of chosen) {
    deps.check?.();
    const report = { sourceId: source.id, source: source.name, found: 0, error: null };
    const scan = await runScan({ sources: [source], jobs: taken, campaign: { name: campaign.name, terms: campaign.terms, locations: campaign.locations, excludeCompanies: campaign.exclusions },
      // Location is filtered by runScan across every campaign location, not by the adapter.
      scan: (s, filter) => deps.scanner(s, filter, ''), checkLiveness: false });
    const sourceReport = scan.sources[0] || {};
    if (sourceReport.error) { report.error = sourceReport.error; run.sources.push(report); continue; }
    report.found = sourceReport.found || 0;
    run.counts.found += report.found;
    run.counts.alreadySaved += scan.duplicates.length;
    run.counts.filtered += scan.ineligible.length;
    const listed = new Set([...scan.added, ...scan.duplicates, ...scan.ineligible].map(job => urlOf(job.url)).filter(Boolean));
    // Earlier roles of this campaign and source that are no longer listed are gone.
    for (const value of Object.values(ledger)) if (value.campaignId === campaign.id && value.sourceId === source.id && value.state === 'open' && !listed.has(value.url)) updates[value.url] = { ...value, state: 'gone', closedAt: at };

    for (const job of scan.added) {
      deps.check?.();
      if (exclusions.some(term => key(job.title).includes(term) || key(job.company).includes(term))) { run.counts.filtered++; continue; }
      run.counts.matched++;
      const url = job.url;
      const previous = entry(url) || byRole.get(roleKey(job)) || null;
      let change = null;
      if (previous) {
        const sameUrl = previous.url === url;
        if (previous.state === 'closed' || previous.state === 'gone') change = `reposted after it was ${previous.state === 'closed' ? 'closed' : 'removed from the board'} on ${day(previous.closedAt)}`;
        else if (sameUrl && key(previous.title) !== key(job.title)) change = `title changed from "${previous.title}"`;
        if (!change) { run.counts.alreadySeen++; updates[previous.url] = { ...previous, lastSeenAt: at }; continue; }
      }
      const firstSeenAt = previous?.firstSeenAt || at;
      let live = null;
      if (campaign.liveness) {
        const verification = await deps.verifier({ ...job, url, description: '' });
        live = verification?.state === 'closed' || verification?.state === 'expired' ? 'closed' : verification?.state === 'active' ? 'active' : 'unconfirmed';
        if (live === 'closed') { run.counts.closed++; updates[url] = { url, company: job.company, title: job.title, campaignId: campaign.id, sourceId: source.id, firstSeenAt, lastSeenAt: at, state: 'closed', closedAt: at, surfacedAt: previous?.surfacedAt || null }; continue; }
      }
      const reason = describeReason({ campaign, job, source, firstSeenAt, change, live });
      if (change) run.counts.resurfaced++;
      run.surfaced.push({ company: job.company, title: job.title, url, location: job.location || '', source: source.name, sourceId: source.id, reason, firstSeenAt, change, liveness: live });
      updates[url] = { url, company: job.company, title: job.title, campaignId: campaign.id, sourceId: source.id, firstSeenAt, lastSeenAt: at, state: 'open', closedAt: null, surfacedAt: at };
      taken.push({ company: job.company, title: job.title, url });
    }
    run.sources.push(report);
  }
  run.counts.surfaced = run.surfaced.length;
  const failed = run.sources.filter(s => s.error).length;
  if (failed) run.status = failed === run.sources.length ? 'failed' : 'partial';
  return { run, seen: updates };
}

export function mergeLedger(ledger, updates) {
  const merged = { ...ledger, ...updates };
  const entries = Object.entries(merged);
  if (entries.length <= LEDGER_LIMIT) return merged;
  return Object.fromEntries(entries.sort((a, b) => String(b[1].lastSeenAt).localeCompare(String(a[1].lastSeenAt))).slice(0, LEDGER_LIMIT));
}
