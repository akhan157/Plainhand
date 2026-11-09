// Owned application sandbox. It accepts the exact values an evaluation run
// extracted from the browser, validates them server-side, and records a receipt.
// Nothing leaves the loopback interface. A real employer is never contacted, and
// the app itself still refuses to press a submit control.
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { portalDefinition, renderPortal } from './portals.mjs';
import { expectedFor, jobById, personaById } from './corpus.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function valueOf(entry) {
  if (!entry) return '';
  if (typeof entry.value === 'boolean') return entry.value ? 'on' : '';
  return String(entry.value ?? '').trim();
}

export function validateSubmission(scenario, payload) {
  const portal = portalDefinition(scenario);
  const persona = personaById(scenario.persona);
  const job = jobById(scenario.job);
  const errors = [];
  if (!payload || payload.scenarioId !== scenario.id) errors.push('scenario mismatch');
  if (payload?.candidateConfirmed !== true) errors.push('candidate confirmation missing');
  const fields = payload?.fields && typeof payload.fields === 'object' ? payload.fields : {};
  for (const field of portal.fields) {
    const entry = fields[field.name];
    const value = valueOf(entry);
    const expected = expectedFor(field, persona, job);
    if (field.required && !value && !entry?.file) errors.push(`required:${field.name}`);
    if (field.type === 'file' && field.required && !entry?.file?.name) errors.push(`file:${field.name}`);
    if (field.sensitive && value && entry?.source !== 'candidate') errors.push(`sensitive:${field.name}`);
    if (expected.kind === 'blank' && value) errors.push(`unexpected-answer:${field.name}`);
    if (field.type === 'select-one' && value && !(field.options || []).some(option => option.value === value)) errors.push(`invalid-choice:${field.name}`);
    if (field.type === 'checkbox' && field.required && !['on', 'true', 'yes'].includes(value.toLowerCase())) errors.push(`unchecked:${field.name}`);
    if (entry?.file) {
      const file = entry.file;
      if (!file.name || !file.base64) errors.push(`file-bytes:${field.name}`);
      else {
        const bytes = Buffer.from(file.base64, 'base64');
        if (bytes.subarray(0, 5).toString() !== '%PDF-') errors.push(`not-pdf:${field.name}`);
        if (bytes.length < 100) errors.push(`empty-pdf:${field.name}`);
        if (file.sha256 && hash(bytes) !== file.sha256) errors.push(`hash:${field.name}`);
      }
    }
  }
  // A resume is mandatory on every template in the corpus.
  if (!fields.resume?.file?.base64) errors.push('required:resume');
  return { ok: errors.length === 0, errors };
}

export function receiptFor(scenario, payload) {
  const fields = payload.fields || {};
  return {
    id: randomUUID(),
    scenarioId: scenario.id,
    receivedAt: new Date().toISOString(),
    candidateConfirmed: payload.candidateConfirmed === true,
    fields: Object.fromEntries(Object.entries(fields).map(([name, entry]) => [name, {
      value: valueOf(entry),
      source: entry?.source || null,
      file: entry?.file ? { name: entry.file.name, bytes: Buffer.from(entry.file.base64, 'base64').length, sha256: hash(Buffer.from(entry.file.base64, 'base64')) } : null,
    }])),
    errors: validateSubmission(scenario, payload).errors,
  };
}

export async function createSandbox({ scenario }) {
  const submissions = [];
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, scenario: scenario.id });
      if (req.method === 'GET' && req.url.startsWith('/portal')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        const step = Number(url.searchParams.get('step') || '1');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(renderPortal({ scenario, step }));
      }
      if (req.method === 'GET' && req.url === '/api/submissions') return send(200, { submissions });
      if (req.method === 'POST' && req.url === '/api/submissions') {
        let text = '';
        for await (const chunk of req) { text += chunk; if (text.length > 8 * 1024 * 1024) return send(413, { ok: false, errors: ['payload too large'] }); }
        const payload = JSON.parse(text || '{}');
        const check = validateSubmission(scenario, payload);
        if (!check.ok) return send(422, check);
        const receipt = receiptFor(scenario, payload);
        submissions.push(receipt);
        return send(200, { ok: true, receipt });
      }
      return send(404, { ok: false, errors: ['not found'] });
    } catch (error) { return send(422, { ok: false, errors: [error.message] }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    scenario,
    submissions,
    url: `http://127.0.0.1:${server.address().port}`,
    validate: payload => validateSubmission(scenario, payload),
    submit: payload => {
      const check = validateSubmission(scenario, payload);
      if (!check.ok) return { ok: false, ...check };
      const receipt = receiptFor(scenario, payload);
      submissions.push(receipt);
      return { ok: true, receipt };
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
