const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportFile, importFile, readImport, MAX_IMPORT } = require('../src/transfer.cjs');
test('transfer uses authenticated export contract, previews and requires explicit confirmation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plainhand-transfer-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = { version: 1, profile: { name: 'Example' }, jobs: [], exportedAt: '2026-11-06' }; const calls = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers['x-plainhand-token'], 'test-token');
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/export' ? data : req.url === '/api/import/preview' ? { jobs: 0, sources: 0 } : { jobs: 0, backup: 'test-backup' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const connection = { origin: `http://127.0.0.1:${server.address().port}`, token: 'test-token' }, filename = path.join(root, 'export.json');
  await exportFile(connection, filename); assert.deepEqual(await readImport(filename), data);
  assert.equal(await importFile(connection, filename, async () => false), null); assert.equal(calls.some(c => c.url === '/api/import'), false);
  await importFile(connection, filename, async summary => { assert.equal(summary.jobs, 0); return true; });
  assert.deepEqual(calls.at(-1), { url: '/api/import', body: { data, confirm: true } });
  await fs.writeFile(filename, '{bad json'); await assert.rejects(readImport(filename), SyntaxError);
  await fs.writeFile(filename, Buffer.alloc(MAX_IMPORT + 1)); await assert.rejects(readImport(filename), /smaller/);
});
