import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { fixtureProviders } from './plainhand/test-fixtures.mjs';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-events-'));
  const app = await createPlainhand({ root, providers: fixtureProviders });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('static files are served from plainhand/web only, with the session token injected into the page', async () => {
  const h = await harness();
  try {
    const page = await fetch(h.base + '/');
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes(h.app.token));
    const script = await fetch(h.base + '/app.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.equal((await fetch(h.base + '/missing.js')).status, 404);
    for (const hostile of ['/%2e%2e/package.json', '/..%2Fpackage.json', '/.hidden.js', '/app.exe']) {
      const response = await fetch(h.base + hostile);
      assert.notEqual(response.status, 200, hostile);
      assert.doesNotMatch(await response.text(), /"name": "plainhand"/, hostile);
    }
  } finally { await h.close(); }
});

test('the event stream needs the session token and announces every workspace change', async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(h.base + '/api/events')).status, 403);
    const controller = new AbortController();
    const response = await fetch(`${h.base}/api/events?token=${h.app.token}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const nextEvent = async () => {
      while (!buffer.includes('\n\n')) { const { value } = await reader.read(); buffer += decoder.decode(value); }
      const [block] = buffer.split('\n\n'); buffer = buffer.slice(block.length + 2);
      return { event: block.match(/^event: (.*)$/m)[1], data: JSON.parse(block.match(/^data: (.*)$/m)[1]) };
    };
    const first = await nextEvent();
    assert.equal(first.event, 'state');
    assert.equal(first.data.revision, (await h.app.workspace.load()).revision, 'the stream opens with the current revision');
    await h.app.workspace.mutate(state => { state.sources.push({ id: 's', name: 'S', url: 'https://boards.greenhouse.io/s' }); });
    assert.deepEqual(await nextEvent(), { event: 'state', data: { revision: first.data.revision + 1 } });
    controller.abort();
  } finally { await h.close(); }
});
