// Opt-in read-only compatibility observation; never fills, clicks submit or uses a profile.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ApplicationBrowser } from './plainhand/jobs.mjs';
if (!process.argv.includes('--live')) { console.log('Opt-in: node test-plainhand-ats-observe.mjs --live'); process.exit(0); }
const directory = path.join('output', 'ats-observe-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
const sources = [
  { id: 'greenhouse', board: 'https://boards-api.greenhouse.io/v1/boards/figma/jobs' },
  { id: 'lever', board: 'https://api.lever.co/v0/postings/zoox?mode=json' },
  { id: 'ashby', board: 'https://api.ashbyhq.com/posting-api/job-board/notion' },
];
const results = [];
const atsIndex = process.argv.indexOf('--ats');
for (const source of sources.filter(source => atsIndex < 0 || source.id === process.argv[atsIndex + 1])) {
  const failedRequests = []; let page;
  const runtime = new ApplicationBrowser({ launch: async options => {
    const engine = await chromium.launch(options), createContext = engine.newContext.bind(engine);
    engine.newContext = async options => {
      const context = await createContext(options), createPage = context.newPage.bind(context);
      context.on('requestfailed', request => {
        const url = new URL(request.url());
        let operation;
        if (request.method() === 'POST' && url.hostname === 'jobs.ashbyhq.com' && url.pathname === '/api/non-user-graphql') {
          try { const body = request.postDataJSON(); operation = { keys: Object.keys(body), operationName: body.operationName, urlOperation: url.searchParams.get('op'), queryKeys: [...url.searchParams.keys()], variables: body.variables, queryHash: typeof body.query === 'string' ? createHash('sha256').update(body.query).digest('hex') : null, queryHeader: body.query?.slice(0, 150) }; } catch {}
        }
        if (failedRequests.length < 100) failedRequests.push({ operation, host: url.hostname, path: url.pathname, method: request.method(), error: request.failure()?.errorText });
      });
      context.newPage = async () => page = await createPage();
      return context;
    };
    return engine;
  } });
  const result = { ats: source.id, kind: 'read-only public posting observation', candidateDataSent: false, applicationSubmitted: false };
  try {
    const response = await fetch(source.board, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Board HTTP ${response.status}`);
    const data = await response.json(), listing = (Array.isArray(data) ? data : data.jobs).find(j => /engineer/i.test(j.title || j.text));
    if (!listing) throw new Error('No public engineering listing in board response.');
    const job = { id: source.id, url: listing.absolute_url || listing.hostedUrl || listing.jobUrl, title: listing.title || listing.text };
    result.job = job;
    let fields = await runtime.open(job, true);
    // Give the initial client render bounded time; this is observation, not a
    // network-idle guarantee or a reason to suppress missing form diagnostics.
    await page.waitForTimeout(1500);
    fields = await runtime.inspect(job);
    if (!fields.length) {
      result.navigation = await runtime.navigate(job, async ({ controls }) => {
        const control = controls.find(c => /^application$|^apply for this job$/i.test(c.label));
        return control ? { action: 'click', ref: control.ref } : { action: 'stop' };
      });
      fields = await runtime.inspect(job);
    }
    result.observation = await runtime.status(job.id);
    result.fields = fields.map(({ label, type, required, sectionContext, options }) => ({ label, type, required, sectionContext, optionCount: options?.length || 0 }));
    result.url = page.url();
    await page.screenshot({ path: path.join(directory, source.id + '.png'), fullPage: true });
  } catch (error) { result.error = error.message; }
  finally { result.failedRequests = failedRequests; await runtime.closeAll(); }
  results.push(result);
  console.log(JSON.stringify({ ats: source.id, state: result.observation?.state, fields: result.fields?.length, error: result.error }));
}
await writeFile(path.join(directory, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results, limitation: 'Public read-only observation only; no candidate data, fill, upload, or submission compatibility proved.' }, null, 2));
console.log('Evidence: ' + directory);

process.exitCode = results.length && results.every(result => result.fields?.length) ? 0 : 1;
