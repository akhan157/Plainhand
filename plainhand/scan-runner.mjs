import { discover, verifyJob, jobUrl } from './jobs.mjs';

// Remember what a scan surfaced even before it is saved, so the next scan does
// not report the same role again.
export function mergeScanHistory(history, added, seenAt, limit = 2000) {
  const merged = [...(Array.isArray(history) ? history : []), ...(added || []).map(job => ({ company: job.company, title: job.title, url: job.url, seenAt }))];
  const unique = new Map();
  for (const entry of merged) unique.set(key(`${entry.company} ${entry.title} ${entry.url}`), entry);
  return [...unique.values()].slice(-limit);
}

const key = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const matches = (value, terms) => !terms.length || terms.some(term => key(value).includes(key(term)));

// One campaign scan: real discovery adapters by default, injected ones in tests.
// Nothing is written here; the caller decides what to persist.
export async function runScan({
  sources = [],
  jobs = [],
  campaign = {},
  scan = discover,
  verify = verifyJob,
  checkLiveness = false,
  limit = 200,
} = {}) {
  const terms = (campaign.terms || []).filter(Boolean);
  const locations = (campaign.locations || []).filter(Boolean);
  const exclude = (campaign.excludeCompanies || []).map(key);
  const seenUrls = new Set(jobs.map(job => { try { return jobUrl(job.url); } catch { return job.url; } }));
  const seenRoles = new Set(jobs.map(job => key(`${job.company} ${job.title}`)));
  const result = { checkedAt: new Date().toISOString(), campaign: campaign.name || null, sources: [], added: [], duplicates: [], ineligible: [], expired: [], errors: [] };

  for (const source of sources) {
    const report = { source: source.name || source.url, found: 0, error: null };
    let found = [];
    try {
      found = await scan(source, terms.join(','), locations[0] || '');
    } catch (error) {
      report.error = error.message;
      result.errors.push({ source: report.source, error: error.message });
      result.sources.push(report);
      continue;
    }
    report.found = found.length;
    for (const job of found) {
      if (result.added.length + result.duplicates.length + result.ineligible.length >= limit) break;
      if (!matches(job.title, terms) || (locations.length && !locations.some(location => matches(job.location, [location])))) { result.ineligible.push(job); continue; }
      if (exclude.includes(key(job.company))) { result.ineligible.push(job); continue; }
      let url;
      try { url = jobUrl(job.url); } catch { result.ineligible.push(job); continue; }
      if (seenUrls.has(url) || seenRoles.has(key(`${job.company} ${job.title}`))) { result.duplicates.push(job); continue; }
      if (checkLiveness) {
        const verification = await verify({ ...job, url });
        if (verification?.state === 'closed' || verification?.state === 'expired') { result.expired.push(job); continue; }
      }
      seenUrls.add(url); seenRoles.add(key(`${job.company} ${job.title}`));
      result.added.push({ ...job, url });
    }
    result.sources.push(report);
  }
  return result;
}
