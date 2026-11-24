import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { ApplicationBrowser } from '../plainhand/jobs.mjs';

// S3 uploads go to the bucket host (and its subdomains). Parse the URL so a request
// to https://s3.amazonaws.com.attacker.example/ is not mistaken for an S3 upload.
const isS3Url = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 's3.amazonaws.com' || url.hostname.endsWith('.s3.amazonaws.com'));
  } catch { return false; }
};

async function fixture({ mode = 'success', delay = 0 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-transfer-'));
  const pdf = path.join(root, 'approved.pdf');
  await writeFile(pdf, '%PDF-1.4\nSynthetic approved resume, not a candidate.\n');
  const observed = []; let page;
  const browser = new ApplicationBrowser({ launch: async () => {
    const engine = await chromium.launch({ headless: true });
    const original = engine.newContext.bind(engine);
    engine.newContext = async options => {
      const context = await original(options);
      // Mock the network behind the real guard. Rejected requests never arrive here.
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<h1>Synthetic Ashby application</h1><label>Resume<input type="file" name="resume"></label><button type="submit">Submit application</button><script>
          window.finished=false;window.error='';document.querySelector('input').onchange=async e=>{try{
            const file=e.target.files[0];if('${mode}'==='local'){window.finished=true;return;}
            const h=await fetch('https://api.ashbyhq.com/file.createFileUploadHandle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileUploadContext:'ApplicationForm',filename:${mode === 'wrong-name' ? "'other.pdf'" : 'file.name'},contentType:'application/pdf',contentLength:file.size})}).then(r=>r.json());
            const data=new FormData();data.append('Content-Type','application/pdf');for(const [k,v]of Object.entries(h.results.fields))data.append(k,v);data.append('file',${mode === 'wrong-bytes' ? "new File(['not the approved file'],file.name,{type:'application/pdf'})" : 'file'});
            ${mode === 'extra-field' ? "data.append('applicationForm','unexpected');" : ''}
            const r=await fetch(h.results.url,{method:'POST',body:data});if(!r.ok)throw Error('Upload rejected');
            ${mode === 'try-submit' ? "await fetch('https://api.ashbyhq.com/applicationForm.submit',{method:'POST',body:'{}'});" : ''}
          }catch(e){window.error=e.message}finally{window.finished=true}};
          </script>` });
        observed.push({ url: request.url(), method: request.method(), containsApprovedBytes: !!request.postDataBuffer()?.includes(Buffer.from('%PDF-1.4\nSynthetic approved resume, not a candidate.\n')) });
        const headers = { 'access-control-allow-origin': 'https://jobs.ashbyhq.com', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (request.url().endsWith('/file.createFileUploadHandle')) return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ success: true, results: { url: mode === 'unsafe-destination' ? 'https://untrusted.example/upload' : 'https://synthetic.s3.amazonaws.com/resume', fields: { key: 'synthetic/resume', policy: 'synthetic-signature' }, handle: 'synthetic-handle' } }) });
        if (request.url() === 'https://synthetic.s3.amazonaws.com/resume') {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          return route.fulfill({ status: mode === 'rejected' ? 403 : 204, headers });
        }
        return route.fulfill({ status: 500, headers });
      });
      const create = context.newPage.bind(context);
      context.newPage = async () => page = await create();
      return context;
    };
    return engine;
  } });
  const job = { id: 'transfer', url: 'https://jobs.ashbyhq.com/synthetic/123' };
  await browser.open(job, true);
  return { browser, job, pdf, observed, get page() { return page; }, close: async () => { await browser.closeAll(); await rm(root, { recursive: true, force: true }); } };
}

for (const mode of ['success', 'local', 'wrong-name', 'wrong-bytes', 'rejected', 'try-submit', 'unsafe-destination', 'extra-field']) {
  test(`approved attachment transfer: ${mode}`, async () => {
    const h = await fixture({ mode, delay: mode === 'success' ? 400 : 0 });
    try {
      const fields = await h.browser.inspect(h.job);
      const result = await h.browser.fill(h.job, { [fields[0].key]: '__resume__' }, h.pdf);
      await h.page.waitForFunction(() => window.finished);
      assert.equal(h.observed.some(r => r.url.includes('applicationForm.submit')), false, 'Final submission never reaches the network fixture.');
      if (mode === 'local') {
        assert.equal(result.uploads[0].state, 'selected');
        assert.deepEqual(result.filled, ['Resume']);
        assert.equal(h.observed.length, 0);
      } else if (mode === 'success') {
        assert.equal(result.uploads[0].state, 'server-accepted', JSON.stringify({result,observed:h.observed,error:await h.page.evaluate(()=>window.error)}));
        assert.deepEqual(result.failed, []);
        assert.equal(h.observed.find(r => isS3Url(r.url)).containsApprovedBytes, true, 'Outbound multipart contains the approved file, including reconstructed disk bytes.');
        assert.equal(h.observed.filter(r => isS3Url(r.url) && r.method === 'POST').length, 1);
      } else {
        assert.equal(result.uploads[0].state, 'failed');
        assert.deepEqual(result.failed, ['Resume']);
        assert.deepEqual(result.filled, []);
        if (mode === 'wrong-name') assert.equal(h.observed.filter(r => r.method === 'POST').length, 0);
        if (mode === 'wrong-bytes') assert.equal(h.observed.some(r => isS3Url(r.url)), false);
      }
      const unrelated = await h.page.evaluate(async () => { try { await fetch('https://api.ashbyhq.com/file.createFileUploadHandle',{method:'POST',body:'{}'});return true; } catch { return false; } });
      assert.equal(unrelated, false, 'Upload permission expires when fill returns.');
    } finally { await h.close(); }
  });
}

test('observed ATS asset paths can load while private paths and asset-host writes stay blocked', async () => {
  const h = await fixture({ mode: 'local' });
  try {
    for (const url of ['https://cdn.ashbyprd.com/frontend_non_user/test/manifest.json', 'https://cdn.ashbyprd.com/cdn_assets/test/fonts/font.css', 'https://job-boards.cdn.greenhouse.io/assets/client.js', 'https://job-boards.cdn.greenhouse.io/locales/en/job_post.json', 'https://api-geocode-earth-proxy.greenhouse.io/v1/autocomplete?text=San+Francisco', 'https://cdn.lever.co/fonts/test.woff2', 'https://app.ashbyhq.com/api/images/org-theme-logo/test.png']) {
      const reached = await h.page.evaluate(async url => { try { return (await fetch(url)).status; } catch { return 0; } }, url);
      assert.equal(reached, 500, 'Allowed read reaches the synthetic network fixture: ' + url);
    }
    for (const [url, method] of [['https://app.ashbyhq.com/api/private/data', 'GET'], ['https://cdn.ashbyprd.com/private/data', 'GET'], ['https://cdn.ashbyprd.com/frontend_non_user/test/data', 'POST'], ['https://job-boards.cdn.greenhouse.io/assets/submit', 'POST'], ['https://job-boards.cdn.greenhouse.io/locales/en/job_post.json', 'POST'], ['https://api-geocode-earth-proxy.greenhouse.io/v1/autocomplete', 'POST'], ['https://api-geocode-earth-proxy.greenhouse.io/admin', 'GET']]) {
      const reached = await h.page.evaluate(async ({ url, method }) => { try { await fetch(url, { method }); return true; } catch { return false; } }, { url, method });
      assert.equal(reached, false);
      assert.equal(h.observed.some(r => r.url === url && r.method === method), false);
    }
  } finally { await h.close(); }
});

const ASHBY_GRAPHQL_HANDLE_QUERY = `mutation ApiCreateFileUploadHandle($organizationHostedJobsPageName: String!, $fileUploadContext: FileUploadContext!, $filename: String!, $contentType: String!, $contentLength: Int!) {
  fileUploadHandle: createFileUploadHandle(
    organizationHostedJobsPageName: $organizationHostedJobsPageName
    fileUploadContext: $fileUploadContext
    filename: $filename
    contentType: $contentType
    contentLength: $contentLength
  ) {
    handle
    url
    fields
    __typename
  }
}`;

async function graphqlFixture({ mode = 'success' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-gql-transfer-'));
  const pdf = path.join(root, 'approved.pdf');
  await writeFile(pdf, '%PDF-1.4\nSynthetic approved resume, not a candidate.\n');
  const observed = []; let page;
  const query = mode === 'wrong-query' ? ASHBY_GRAPHQL_HANDLE_QUERY.replace('handle', 'handle id') : ASHBY_GRAPHQL_HANDLE_QUERY;
  const org = mode === 'wrong-org' ? 'other-company' : 'synthetic';
  const browser = new ApplicationBrowser({ launch: async () => {
    const engine = await chromium.launch({ headless: true });
    const original = engine.newContext.bind(engine);
    engine.newContext = async options => {
      const context = await original(options);
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<h1>Synthetic Ashby GraphQL application</h1><label>Resume<input type="file" name="resume"></label><button type="submit">Submit application</button><script>
          window.finished=false;window.error='';document.querySelector('input').onchange=async e=>{try{
            const file=e.target.files[0];
            const h=await fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiCreateFileUploadHandle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationName:'ApiCreateFileUploadHandle',variables:{organizationHostedJobsPageName:${JSON.stringify(org)},fileUploadContext:'NonUserFormEngine',filename:${mode === 'wrong-name' ? "'other.pdf'" : 'file.name'},contentType:'application/pdf',contentLength:file.size},query:${JSON.stringify(query)}})}).then(r=>r.json());
            const handle=h.data.fileUploadHandle;
            const data=new FormData();data.append('Content-Type','application/pdf');for(const [k,v]of Object.entries(handle.fields))data.append(k,v);data.append('file',${mode === 'wrong-bytes' ? "new File(['not the approved file'],file.name,{type:'application/pdf'})" : 'file'});
            const r=await fetch(handle.url,{method:'POST',body:data});if(!r.ok)throw Error('Upload rejected');
            ${mode === 'try-submit' ? "await fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiApplicationFormSubmit',{method:'POST',body:'{}'});" : ''}
          }catch(e){window.error=e.message}finally{window.finished=true}};
          </script>` });
        observed.push({ url: request.url(), method: request.method(), containsApprovedBytes: !!request.postDataBuffer()?.includes(Buffer.from('%PDF-1.4\nSynthetic approved resume, not a candidate.\n')) });
        const headers = { 'access-control-allow-origin': 'https://jobs.ashbyhq.com', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (request.url() === 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiCreateFileUploadHandle') return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ data: { fileUploadHandle: { handle: 'synthetic-handle', url: mode === 'unsafe-destination' ? 'https://untrusted.example/upload' : 'https://synthetic.s3.amazonaws.com/resume', fields: { key: 'synthetic/resume', policy: 'synthetic-signature' }, __typename: 'FileUploadHandle' } } }) });
        if (request.url() === 'https://synthetic.s3.amazonaws.com/resume') return route.fulfill({ status: 204, headers });
        return route.fulfill({ status: 500, headers });
      });
      const create = context.newPage.bind(context);
      context.newPage = async () => page = await create();
      return context;
    };
    return engine;
  } });
  const job = { id: 'gql-transfer', url: 'https://jobs.ashbyhq.com/synthetic/123/application' };
  await browser.open(job, true);
  return { browser, job, pdf, observed, get page() { return page; }, close: async () => { await browser.closeAll(); await rm(root, { recursive: true, force: true }); } };
}

for (const mode of ['success', 'wrong-org', 'wrong-query', 'wrong-name', 'wrong-bytes', 'unsafe-destination', 'try-submit']) {
  test(`approved Ashby GraphQL attachment transfer: ${mode}`, async () => {
    const h = await graphqlFixture({ mode });
    try {
      const fields = await h.browser.inspect(h.job);
      const result = await h.browser.fill(h.job, { [fields[0].key]: '__resume__' }, h.pdf);
      await h.page.waitForFunction(() => window.finished);
      assert.equal(h.observed.some(r => r.url.includes('ApiApplicationFormSubmit')), false, 'Final submission never reaches the network fixture.');
      if (mode === 'success') {
        assert.equal(result.uploads[0].state, 'server-accepted', JSON.stringify({ result, observed: h.observed, error: await h.page.evaluate(() => window.error) }));
        assert.deepEqual(result.failed, []);
        assert.equal(h.observed.find(r => isS3Url(r.url)).containsApprovedBytes, true);
      } else {
        assert.equal(result.uploads[0].state, 'failed');
        assert.deepEqual(result.failed, ['Resume']);
        if (['wrong-org', 'wrong-query', 'wrong-name'].includes(mode)) assert.equal(h.observed.filter(r => r.method === 'POST').length, 0);
        if (mode === 'wrong-bytes') assert.equal(h.observed.some(r => isS3Url(r.url)), false);
      }
    } finally { await h.close(); }
  });
}

test('approved Greenhouse presigned S3 attachment transfer accepts approved PDF and blocks tampered keys (#21)', async () => {
  for (const mode of ['success', 'wrong-key']) {
    const root = await mkdtemp(path.join(tmpdir(), 'plainhand-gh-transfer-'));
    const pdf = path.join(root, 'approved.pdf');
    await writeFile(pdf, '%PDF-1.4\nSynthetic approved resume, not a candidate.\n');
    const observed = []; let page;
    const browser = new ApplicationBrowser({ launch: async () => {
      const engine = await chromium.launch({ headless: true });
      const original = engine.newContext.bind(engine);
      engine.newContext = async options => {
        const context = await original(options);
        await context.route('**/*', async route => {
          const request = route.request();
          if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<h1>Synthetic Greenhouse application</h1><label>Attach<input id="resume" type="file"></label><button type="submit">Submit application</button><script>
            window.finished=false;window.presigned=null;
            const ready = fetch('https://boards.greenhouse.io/uncacheable_attributes/presigned_fields?fields[]=resume').then(r=>r.json()).then(j=>{window.presigned=j;});
            document.querySelector('#resume').onchange=async e=>{try{
              await ready; const file=e.target.files[0]; const p=window.presigned;
              const data=new FormData(); data.append('utf8','✓');
              for(const [k,v] of Object.entries(p.resume.fields)) data.append(k,v);
              data.append('key', ${mode === 'wrong-key' ? "'other/path/resume.pdf'" : "'stash/applications/resumes/123-abc'"});
              data.append('authenticity_token','1234'); data.append('Content-Type','application/octet-stream'); data.append('file',file);
              const r=await fetch(p.url,{method:'POST',body:data}); if(!r.ok) throw Error('rejected');
            }catch(e){}finally{window.finished=true}};
          </script>` });
          observed.push({ url: request.url(), method: request.method(), containsApprovedBytes: !!request.postDataBuffer()?.includes(Buffer.from('%PDF-1.4\nSynthetic approved resume, not a candidate.\n')) });
          const headers = { 'access-control-allow-origin': 'https://job-boards.greenhouse.io', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (request.url().includes('/uncacheable_attributes/presigned_fields')) return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ url: 'https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/', resume: { fields: { policy: 'synthetic-policy', 'x-amz-signature': 'sig' }, key: 'stash/applications/resumes/{timestamp}-{unique_id}' } }) });
          if (request.url() === 'https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/') return route.fulfill({ status: 201, headers });
          return route.fulfill({ status: 500, headers });
        });
        const create = context.newPage.bind(context);
        context.newPage = async () => page = await create();
        return context;
      };
      return engine;
    } });
    const job = { id: 'gh-transfer', url: 'https://job-boards.greenhouse.io/synthetic/jobs/123' };
    try {
      await browser.open(job, true);
      await page.waitForFunction(() => !!window.presigned);
      const fields = await browser.inspect(job);
      const result = await browser.fill(job, { [fields[0].key]: '__resume__' }, pdf);
      await page.waitForFunction(() => window.finished);
      if (mode === 'success') {
        assert.equal(result.uploads[0].state, 'server-accepted', JSON.stringify(result));
        assert.deepEqual(result.failed, []);
        assert.equal(observed.find(r => isS3Url(r.url)).containsApprovedBytes, true);
      } else {
        assert.equal(result.uploads[0].state, 'failed');
        assert.equal(observed.some(r => isS3Url(r.url)), false);
      }
    } finally { await browser.closeAll(); await rm(root, { recursive: true, force: true }); }
  }
});

test('a same-page retry reuses the accepted upload instead of sending the PDF twice', async () => {
  const h = await fixture({ mode: 'success' });
  try {
    const fields = await h.browser.inspect(h.job);
    const first = await h.browser.fill(h.job, { [fields[0].key]: '__resume__' }, h.pdf);
    await h.page.waitForFunction(() => window.finished);
    assert.equal(first.uploads[0].state, 'server-accepted');
    const posts = () => h.observed.filter(r => isS3Url(r.url) && r.method === 'POST').length;
    assert.equal(posts(), 1);

    const second = await h.browser.fill(h.job, { [fields[0].key]: '__resume__' }, h.pdf);
    assert.equal(second.uploads[0].state, 'server-accepted');
    assert.equal(second.uploads[0].reused, true, 'The accepted upload is reused, not repeated.');
    assert.deepEqual(second.failed, []);
    assert.equal(posts(), 1, 'A same-page retry must not create a second server-side object.');
  } finally { await h.close(); }
});
