import http from 'node:http';
import { createHmac } from 'node:crypto';
import { createCloudApp, SESSION_COOKIE } from '../../plainhand/cloud/app.mjs';
import { MemoryStorage } from '../../plainhand/storage.mjs';
import { Workspace } from '../../plainhand/store.mjs';
export async function startHostedFixture() {
  const workspaces = new Map(['alice', 'bob'].map(id => [id, new Workspace(id, { storage: new MemoryStorage() })]));
  const env = { SITE_URL: 'http://localhost', SESSION_SECRET: 'test-secret-for-onboarding-at-least-32-characters' };
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  env.SITE_URL = base;
  handler = createCloudApp({ env, sql: async () => [{ count: 1 }],
    accounts: { get: async id => workspaces.has(id) ? { userId: id, email: id + '@example.test' } : null, workspaceFor: id => workspaces.get(id) },
    sessions: { resolve: async cookie => workspaces.has(cookie) ? { userId: cookie } : null }, auth: {},
  });
  const token = id => createHmac('sha256', env.SESSION_SECRET).update('csrf:' + id).digest('base64url');
  const request = (path, { user = 'alice', data, method = data === undefined ? 'GET' : 'POST', csrf = token(user) } = {}) => fetch(base + path, { method, headers: { cookie: `${SESSION_COOKIE}=${user}`, 'x-plainhand-token': csrf, origin: env.SITE_URL, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { base, server, workspaces, token, request, close: () => new Promise(resolve => server.close(resolve)) };
}
// A tiny genuine PDF with correct byte offsets, no fixture candidates or external files.
export function textPdf({ text = 'Candidate supplied resume', pages = 1, repeats = 1, encrypted = false } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < pages; i++) {
    const content = text ? `BT /F1 12 Tf 20 700 Td ${Array.from({ length: repeats }, () => `1 0 0 1 20 700 Tm (${text.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')} ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  if (encrypted) objects.push('<< /Filter /Standard /V 1 /R 2 /O <' + '00'.repeat(32) + '> /U <' + '00'.repeat(32) + '> /P -4 >>');
  let pdf = '%PDF-1.7\n', offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<00000000000000000000000000000000><00000000000000000000000000000000>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
