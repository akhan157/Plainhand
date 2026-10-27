/** Real-site dry run: does Plainhand's application browser work on live employer
 * postings? Finds one current posting per portal through its public job API, opens
 * it in the guarded browser (writes blocked, submit never pressed), inspects the
 * real form and reports what Plainhand would fill and what it would flag for the
 * candidate. Nothing is filled, uploaded or submitted.
 *
 *   node benchmark-real-sites.mjs            Greenhouse, Lever, Ashby, Workday
 *   options: --only greenhouse,lever
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ApplicationBrowser, ATS_HOSTS } from './plainhand/jobs.mjs';
import { suggestFormAnswers } from './plainhand/workflow.mjs';
import { presubmitCheck } from './plainhand/presubmit.mjs';
import { candidate, fixtureAgent } from './plainhand/test-fixtures.mjs';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const getJson = async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json(); };
const finders = {
  greenhouse: async () => {
    for (const board of ['gitlab', 'figma', 'discord', 'cloudflare']) {
      try {
        const { jobs } = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
        const job = jobs?.find(j => j.id);
        if (job) return { company: board, title: job.title, url: `https://job-boards.greenhouse.io/${board}/jobs/${job.id}` };
      } catch {}
    }
  },
  lever: async () => {
    for (const company of ['palantir', 'spotify', 'plaid']) {
      try { const [job] = await getJson(`https://api.lever.co/v0/postings/${company}?mode=json&limit=1`); if (job) return { company, title: job.text, url: job.applyUrl || `${job.hostedUrl}/apply` }; } catch {}
    }
  },
  ashby: async () => {
    for (const org of ['ramp', 'linear', 'notion']) {
      try { const { jobs } = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${org}`); const job = jobs?.[0]; if (job) return { company: org, title: job.title, url: `${job.jobUrl}/application` }; } catch {}
    }
  },
  workday: async () => {
    const data = await getJson('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: 'engineer' }) });
    const job = data.jobPostings?.[0];
    if (job) return { company: 'nvidia', title: job.title, url: `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite${job.externalPath}/apply` };
  },
};

const packet = fixtureAgent('codex', 'Prepare a packet', {});
// A fuller fictional profile, as a real user would have.
const profile = { ...candidate, phone: '+1 617 555 0100', links: 'https://www.linkedin.com/in/test-graduate-example https://github.com/test-graduate-example' };
const results = [];
for (const [portal, find] of Object.entries(finders)) {
  if (only && !only.includes(portal)) continue;
  const started = Date.now();
  let posting = null;
  const browser = new ApplicationBrowser({});
  try {
    posting = await find();
    if (!posting) throw new Error('No live posting found through the public API.');
    const job = { id: `dry-${portal}`, ...posting };
    const fields = await browser.open(job, true);
    const observation = await browser.status(job.id);
    const answers = suggestFormAnswers(fields, profile, packet, { bank: [] });
    const check = presubmitCheck({ fields, answers, profile });
    const reasons = {};
    for (const item of check.items.filter(i => i.status === 'flagged')) reasons[item.reason] = (reasons[item.reason] || 0) + 1;
    results.push({ portal, posting, knownAts: ATS_HOSTS.has(new URL(posting.url).hostname), opened: true, observation: observation.state, fields: fields.length, required: fields.filter(f => f.required).length,
      filled: check.summary.filled, flagged: check.summary.flagged, requiredFlagged: check.summary.requiredFlagged, flaggedReasons: reasons,
      sample: check.items.slice(0, 40).map(i => `${i.status}${i.reason ? '/' + i.reason : ''}${i.required ? '*' : ''}: ${i.label.slice(0, 70)}`), seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (error) {
    results.push({ portal, posting, opened: false, error: error.message.slice(0, 300), seconds: Math.round((Date.now() - started) / 100) / 10 });
  } finally { await browser.close(`dry-${portal}`).catch(() => {}); }
  const r = results.at(-1);
  console.log(r.opened ? `${portal}: ${r.observation} · ${r.fields} fields (${r.required} required) · Plainhand fills ${r.filled} without a model · flags ${r.flagged} (${JSON.stringify(r.flaggedReasons)}) · ${r.seconds}s` : `${portal}: not opened: ${r.error}`);
}
const directory = path.join('output', `real-sites-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'results.json'), JSON.stringify({ date: new Date().toISOString(), note: 'Inspection only: nothing filled, uploaded or submitted. Fill counts use identity and packet answers without a model; in the app the model also answers from your evidence.', results }, null, 2));
console.log('Evidence: ' + directory);
