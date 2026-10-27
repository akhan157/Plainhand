import { readFile } from 'node:fs/promises';
import path from 'node:path';

const HANDLE = 'https://api.ashbyhq.com/file.createFileUploadHandle';
function handleBody(request, file) {
  try {
    const body = request.postDataJSON();
    return request.method() === 'POST' && Object.keys(body).sort().join(',') === 'contentLength,contentType,fileUploadContext,filename' &&
      body.fileUploadContext === 'ApplicationForm' && body.filename === file.name && body.contentType === 'application/pdf' && body.contentLength === file.bytes.length;
  } catch { return false; }
}
function uploadDestination(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /(?:^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname);
  } catch { return false; }
}
// Parse only this narrow presigned multipart format; never log bodies or tokens.
function signedMultipart(request, grant, file) {
  const type = request.headers()['content-type'] || '';
  const boundary = type.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))$/i);
  if (!boundary) return false;
  const marker = Buffer.from('--' + (boundary[1] || boundary[2]));
  const body = request.postDataBuffer();
  if (!body || body.length > file.bytes.length + 100000) return false;
  const values = new Map(); let offset = 0, foundFile = false, outbound = body;
  while (offset < body.length) {
    if (!body.subarray(offset, offset + marker.length).equals(marker)) return false;
    offset += marker.length;
    if (body.subarray(offset, offset + 2).toString() === '--') return foundFile && values.size === Object.keys(grant.fields).length ? outbound : false;
    if (body.subarray(offset, offset + 2).toString() !== '\r\n') return false;
    offset += 2;
    const endHeader = body.indexOf('\r\n\r\n', offset);
    if (endHeader < 0 || endHeader - offset > 10000) return false;
    const header = body.subarray(offset, endHeader).toString();
    const disposition = header.match(/^content-disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?\r?$/im);
    if (!disposition) return false;
    const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), marker]), endHeader + 4);
    if (next < 0) return false;
    const content = body.subarray(endHeader + 4, next), name = disposition[1];
    if (name === 'file') {
      if (foundFile || values.size !== Object.keys(grant.fields).length || disposition[2] !== file.name || !/^content-type: application\/pdf\r?$/im.test(header) || content.length && !content.equals(file.bytes)) return false;
      // Chromium's protocol omits disk-file bytes in intercepted multipart data.
      // Rebuild that part from our already approved bytes before it leaves.
      if (!content.length) outbound = Buffer.concat([body.subarray(0, endHeader + 4), file.bytes, body.subarray(next)]);
      foundFile = true;
    } else {
      if (foundFile || disposition[2] || values.has(name) || !Object.hasOwn(grant.fields, name) || content.toString() !== grant.fields[name]) return false;
      values.set(name, true);
    }
    offset = next + 2;
  }
  return false;
}

// Each grant exists only during one explicitly requested approved-resume fill.
// A signed URL is never a general host allowlist and never enters model context.
export class ResumeTransfers {
  constructor(context) {
    this.active = null;
    this.pending = Promise.resolve();
    context.on('response', response => {
      const active = this.active;
      if (!active || response.request() !== active.handleRequest) return;
      this.pending = (async () => {
        try {
          const json = await response.json(), result = json.results;
          if (!response.ok() || json.success !== true || !result || !uploadDestination(result.url) || !result.fields || typeof result.fields !== 'object' || Array.isArray(result.fields) || !Object.values(result.fields).every(v => typeof v === 'string')) return;
          if (result.fields['Content-Type'] && result.fields['Content-Type'] !== 'application/pdf') return;
          if (this.active === active) active.grant = { url: result.url, fields: { 'Content-Type': 'application/pdf', ...result.fields } };
        } catch {}
      })();
    });
  }
  async begin(filePath, frame) {
    if (this.active) throw new Error('An attachment transfer is already active.');
    const bytes = await readFile(filePath);
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || bytes.length > 20 * 1024 * 1024) throw new Error('The approved attachment must be a PDF under 20 MB.');
    const active = { frame, file: { name: path.basename(filePath), bytes }, expires: Date.now() + 15000, events: [], inflight: new Set(), handleRequest: null, grant: null };
    this.active = active;
    return active;
  }
  async allow(request) {
    const active = this.active;
    if (!active || Date.now() > active.expires || !['xhr', 'fetch'].includes(request.resourceType())) return false;
    // Do not permit a request from an unrelated frame/tab to consume this grant.
    let origin;
    try { if (request.frame() !== active.frame) return false; origin = new URL(request.frame().url()).origin; } catch { return false; }
    if (origin !== 'https://jobs.ashbyhq.com') return false;
    if (request.url() === HANDLE && !active.handleRequest && handleBody(request, active.file)) {
      active.handleRequest = request;
      this.observe(request, active, 'handle');
      return {};
    }
    await this.pending;
    if (this.active !== active || !active.grant || active.consumed || request.url() !== active.grant.url || request.method() !== 'POST') return false;
    const postData = signedMultipart(request, active.grant, active.file);
    if (!postData) return false;
    active.consumed = true;
    this.observe(request, active, 'transfer');
    return { postData };
  }
  observe(request, active, kind) {
    const event = { kind, state: 'pending' };
    active.events.push(event);
    const settled = new Promise(resolve => {
      const page = request.frame().page();
      const finish = state => { event.state = state; page.off('response', received); page.off('requestfinished', finished); page.off('requestfailed', failed); resolve(); };
      // A 204 acknowledgement may be followed by Chromium ERR_ABORTED even
      // though fetch received the successful response. Observe HTTP status.
      const received = response => { if (response.request() === request) finish(response.ok() ? 'accepted' : 'failed'); };
      const finished = async req => { if (req === request) { const response = await req.response().catch(() => null); finish(response?.ok() ? 'accepted' : 'failed'); } };
      const failed = req => { if (req === request) finish('failed'); };
      page.on('response', received); page.on('requestfinished', finished); page.on('requestfailed', failed);
      active.cleanup ||= []; active.cleanup.push(() => finish(event.state));
    });
    active.inflight.add(settled);
    settled.finally(() => active.inflight.delete(settled));
  }
  async finish(active) {
    // Give change handlers time to start their transfer; then await bounded work.
    await new Promise(resolve => setTimeout(resolve, 150));
    while (Date.now() < active.expires) {
      if (active.events.some(e => e.state === 'failed')) break;
      if (active.events.some(e => e.kind === 'transfer' && e.state === 'accepted')) break;
      if (!active.events.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const events = active.events.map(({ kind, state }) => ({ kind, state }));
    for (const cleanup of active.cleanup || []) cleanup();
    if (this.active === active) this.active = null;
    if (events.some(e => e.state === 'failed')) return { state: 'failed' };
    if (events.some(e => e.state === 'pending')) return { state: 'pending' };
    if (events.some(e => e.kind === 'transfer' && e.state === 'accepted')) return { state: 'server-accepted' };
    if (events.length) return { state: 'unconfirmed' };
    return { state: 'selected' };
  }
}
