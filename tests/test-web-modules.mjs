// Browser modules must be .mjs. Vercel's build transpiles ES-module .js files in the
// function bundle to CommonJS (this package has no "type": "module"), which browsers
// cannot run: the hosted page stopped at "Opening your workspace…" with
// "require is not defined". Plain scripts without import/export may stay .js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const WEB = new URL('../plainhand/web/', import.meta.url).pathname;
async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(full)); else out.push(full);
  }
  return out;
}

test('every browser file with import or export is .mjs', async () => {
  const offenders = [];
  for (const file of await files(WEB)) {
    if (!file.endsWith('.js')) continue;
    const text = await readFile(file, 'utf8');
    if (/^\s*(import|export)\s/m.test(text)) offenders.push(path.relative(WEB, file));
  }
  assert.deepEqual(offenders, [], 'rename these to .mjs so the hosted build serves them unchanged');
});

test('index.html loads the app as a module from app.mjs', async () => {
  const html = await readFile(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="\/app\.mjs"><\/script>/);
});
