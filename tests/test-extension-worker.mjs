// E2E swarm #15: the popup's "Save this job", "Fill this page" and "I submitted this"
// actions, run through the real service worker against the real extension API. The
// browser is stubbed: chrome.scripting returns one result per frame, as Chrome does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedWorkspace, callApi, WHY_QUESTION } from './extension-fixture.mjs';

const PAGE = 'https://job-boards.greenhouse.io/acme/jobs/4012345';
const READ = {
  url: PAGE, title: 'Apply', top: true, frames: [],
  // Field shape exactly as extension/content/fill.js read() returns it.
  fields: [
    { id: 'co0', label: 'First Name', type: 'text', required: true, options: [], filled: false },
    { id: 'co1', label: 'Email', type: 'email', required: true, options: [], filled: false },
    { id: 'co2', label: WHY_QUESTION, type: 'textarea', required: false, options: [], filled: false },
    { id: 'co3', label: 'Password', type: 'password', required: false, options: [], filled: false },
  ],
};

async function worker({ read = READ, granted = true } = {}) {
  const deps = await approvedWorkspace();
  const storage = { token: 'test-token', site: 'https://plainhand.test' };
  let listener = null;
  const calls = [];
  globalThis.chrome = {
    storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, storage[k]])), set: async entries => Object.assign(storage, entries) } },
    runtime: { onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    action: { setBadgeBackgroundColor() {} },
    tabs: { query: async () => [{ id: 7, url: PAGE }] },
    permissions: { contains: async () => granted, request: async () => granted },
    scripting: {
      async executeScript({ files: injected, func, args }) {
        if (injected) return [{ result: undefined }, { result: undefined }];
        const [method, rest] = args;
        calls.push(method);
        // Two frames: the page, and an iframe without the content script.
        if (method === 'posting') return [{ frameId: 0, result: { company: 'Acme Robotics', title: 'Mechanical Engineer', url: PAGE, description: 'Build robots.' } }, { frameId: 3, result: null }];
        if (method === 'read') return [{ frameId: 0, result: read }, { frameId: 3, result: null }];
        // fill: (fields, answers, identity, files)
        const [fields, answers, , files] = args;
        calls.push({ fill: fields.map(f => f.id), files });
        return [{ frameId: 0, result: { url: PAGE, filled: fields.filter(f => answers[f.id]).map(f => ({ id: f.id, label: f.label })), skipped: [], failed: [] } }];
      },
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    const { pathname, search } = new URL(url);
    const result = await callApi(deps, options.method || 'GET', pathname + search, options.body, { authorization: options.headers?.Authorization });
    return new Response(result.raw, { status: result.status, headers: { 'content-type': result.headers['content-type'] || 'application/json' } });
  };
  await import(`../extension/background/service-worker.js?run=${Math.random()}`);
  const send = type => new Promise(resolve => listener({ type }, {}, resolve));
  return { send, calls, deps };
}

test('Save this job saves the posting instead of throwing on the frame list', async () => {
  const { send } = await worker();
  const response = await send('save-job');
  assert.doesNotMatch(String(response.error || ''), /filter is not a function/);
  assert.equal(response.ok, true, response.error);
});

test('Fill this page plans with the fields the API understands and fills them', async () => {
  const { send } = await worker();
  const response = await send('fill-page');
  assert.equal(response.ok, true, response.error);
  const ids = response.result.filled.map(f => f.id);
  assert.ok(ids.includes('co0') && ids.includes('co1'), `filled ${ids}`);
  assert.equal(ids.includes('co3'), false, 'a password field is never sent or filled');
});

test('I submitted this records the matched role', async () => {
  const { send } = await worker();
  const response = await send('mark-submitted');
  assert.equal(response.ok, true, response.error);
});

// E2E swarm #16: an unpacked build that the hosted site does not trust used to fail with a
// bare "did not finish. Try again." and nothing to act on.
test('a sign-in the site refuses for this extension copy says why and names the ID', async () => {
  const { signInError } = await import('../extension/background/oauth.js');
  const message = signInError('invalid_target', 'https://plainhand-cloud.vercel.app', 'nkfiambfkmaojimmkppjefphbihkmllc');
  assert.match(message, /does not accept this copy of the extension/);
  assert.match(message, /nkfiambfkmaojimmkppjefphbihkmllc/);
  assert.match(message, /PLAINHAND_EXTENSION_IDS/);
  assert.equal(signInError('access_denied', 'x'), 'You cancelled the sign-in.');
  assert.match(signInError('server_error', 'x'), /did not finish/);
});

// Behind the #15 crash, the E2E re-run found three more: the save confirmation printed
// "undefined", files never reached the page (blobToBase64 was missing), and the frame
// permission was requested from the worker, where Chrome refuses it without a gesture.
test('Save this job confirms with the company and title', async () => {
  const { send } = await worker();
  const response = await send('save-job');
  assert.equal(response.result.company, 'Acme Robotics');
  assert.equal(response.result.title, 'Mechanical Engineer');
});

test('Fill this page attaches the approved resume as base64', async () => {
  const read = { ...READ, fields: [...READ.fields, { id: 'co4', label: 'Resume/CV', type: 'file', required: true, options: [], filled: false }] };
  const { send, calls } = await worker({ read });
  const response = await send('fill-page');
  assert.equal(response.ok, true, response.error);
  const fill = calls.find(c => Array.isArray(c?.fill) && c.fill.includes('co4'));
  assert.ok(fill, 'the resume field was sent to the page');
  assert.ok(fill.files.resume?.base64 && Buffer.from(fill.files.resume.base64, 'base64').toString().startsWith('%PDF'), 'the resume bytes arrive intact');
});

test('a form in a frame without access asks the popup to request it, and fills nothing yet', async () => {
  const read = { ...READ, frames: ['https://boards.greenhouse.io/embed/job_app?token=1'] };
  const { send, calls } = await worker({ read, granted: false });
  const response = await send('fill-page');
  assert.equal(response.ok, true, response.error);
  assert.deepEqual(response.result.needsAccess, ['https://boards.greenhouse.io/*']);
  assert.equal(calls.some(c => Array.isArray(c?.fill)), false, 'nothing is filled before access is granted');
});
