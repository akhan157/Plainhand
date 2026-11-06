import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { MemoryStorage } from '../plainhand/storage.mjs';
import { Workspace, digest } from '../plainhand/store.mjs';
import { PostgresStorage } from '../plainhand/cloud/postgres-storage.mjs';
import { renderCloudPacket, renderCloudDocuments, verifyCloudJob } from '../plainhand/cloud/runtime.mjs';
import { validateCloudEnv } from '../plainhand/cloud/config.mjs';
import { scrubDiagnostics } from '../plainhand/cloud/diagnostics.mjs';
import { importResume } from '../plainhand/cloud/resume-import.mjs';
import { freshDatabase, skip } from './cloud-test-db.mjs';
const db = freshDatabase();
const state = { profile: { name: 'Synthetic Candidate', email: 'test@example.invalid', location: 'Remote', links: 'http://169.254.169.254/' } };
const job = { company: 'Synthetic', title: 'Engineer', description: 'Synthetic fixture', url: 'https://example.invalid/job', reportPath: 'reports/synthetic.md' };
const packet = { resume: [{ section: 'Experience', text: 'Built synthetic test systems.' }], coverLetter: 'Synthetic cover letter.', answers: [{question:'Why?',answer:'Synthetic.',evidence:[{sourceId:'cv.md'}]}] };
async function checkPacket(workspace, label) {
  const start = performance.now();
  const result = await renderCloudPacket(workspace, state, job, packet);
  const pdf = await workspace.readBinary(result.pdf);
  assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
  assert.equal(result.pdfHash, digest(pdf));
  const extracted=await importResume({name:'synthetic.pdf',content:pdf.toString('base64')});
  assert.match(extracted.text,/Synthetic Candidate/);assert.match(extracted.text,/Built synthetic test systems/);
  assert.equal(result.artifacts.length, 3);
  const meta = await workspace.read(result.pdf.replace('.pdf','.meta.md'));
  assert.match(meta, /artifact_type: resume/); assert.match(meta, /page_count: 1/);
  const cover = await workspace.readBinary(result.artifacts[1]); assert.equal(cover.subarray(0,5).toString(), '%PDF-');
  console.log(JSON.stringify({render:label,ms:Math.round(performance.now()-start),resumeBytes:pdf.length,coverBytes:cover.length}));
  return result;
}
test('bundled Chromium produces real cloud workspace PDFs cold and warm', async () => {
  const workspace = new Workspace(null, {storage:new MemoryStorage()});
  await checkPacket(workspace,'first'); await checkPacket(workspace,'warm');
});
test('real PDFs persist in Postgres and remain isolated', {skip}, async () => {
  const a = randomUUID(), b = randomUUID();
  for (const id of [a,b]) await db.sql`insert into plainhand.accounts (user_id,email) values (${id},${id+'@example.invalid'})`;
  const one = new Workspace(null,{storage:new PostgresStorage(db.sql,a)}), two = new Workspace(null,{storage:new PostgresStorage(db.sql,b)});
  const result = await checkPacket(one,'postgres'); assert.equal(await two.readBinary(result.pdf),null);
});
test('untrusted HTML cannot trigger network requests or script execution', async () => {
  let requests=0;
  const server = http.createServer((req,res)=>{requests++;res.end('secret');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const [pdf] = await renderCloudDocuments([`<style>@import url('${url}/css');</style><img src="${url}/image"><iframe src="${url}/frame"></iframe><script>fetch('${url}/script')</script><p>Safe PDF</p>`]);
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.equal(requests,0);
  } finally { await new Promise(r=>server.close(r)); }
});
test('timeout closes a browser that launches after the deadline', async () => {
  let closed=0;
  await assert.rejects(renderCloudDocuments(['x'],{timeoutMs:5, launch:async()=>{await new Promise(r=>setTimeout(r,30));return {close:async()=>{closed++;}};}}),/could not finish/);
  await new Promise(r=>setTimeout(r,50));assert.equal(closed,1);
});
test('hosted verifier honestly reports unconfirmed without fetching', async () => {
  const v=await verifyCloudJob(job);assert.equal(v.state,'unconfirmed');assert.match(v.reason,/manually/);
});
test('production config requires canonical HTTPS and secrets; extensions default disabled', () => {
  const env={SITE_URL:'https://example.invalid',DATABASE_URL:'fixture',SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',SESSION_SECRET:'s'.repeat(32),CRON_SECRET:'c'.repeat(32)};
  assert.equal(validateCloudEnv(env).extensionEnabled,false);
  for(const site of ['http://example.invalid','https://example.invalid/','https://example.invalid/path','https://user:pass@example.invalid','https://example.invalid?secret=x']) assert.throws(()=>validateCloudEnv({...env,SITE_URL:site}));
  for(const name of ['DATABASE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','SESSION_SECRET','CRON_SECRET']) assert.throws(()=>validateCloudEnv({...env,[name]:''}));
});
test('diagnostics drops secrets, payloads, arbitrary names and URLs', () => {
 const id=randomUUID();assert.deepEqual(scrubDiagnostics({errorId:id,status:500,method:'POST',headers:{authorization:'secret'},message:'candidate resume',url:'?token=secret',stack:'secret',userId:'private'}),{errorId:id,status:500,method:'POST'});
 assert.deepEqual(scrubDiagnostics({errorId:'secret',method:'secret',status:'secret'}),{errorId:'invalid',method:'OTHER',status:500});
});

test('timeout closes an already launched browser when a page operation hangs', async () => {
  let closed=0;
  await assert.rejects(renderCloudDocuments(['fixture'],{timeoutMs:5,launch:async()=>({newContext:()=>new Promise(()=>{}),close:async()=>{closed++;}})}),/could not finish/);
  assert.equal(closed,1);
});
