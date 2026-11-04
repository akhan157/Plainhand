import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// A merge can drop a closing brace silently; every rule after it then lands inside a
// media query and only applies on some screens. Catch that before a browser test does.
test('every stylesheet has balanced braces and no merge markers', async () => {
  const dir = 'plainhand/web/css';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.css'))) {
    const text = (await readFile(path.join(dir, name), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    text.split('\n').forEach((line, index) => {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      assert.ok(depth >= 0, `${name}:${index + 1} closes a block that was never opened`);
    });
    assert.equal(depth, 0, `${name} leaves ${depth} block(s) unclosed`);
    assert.doesNotMatch(text, /^(<<<<<<<|=======|>>>>>>>)/m, `${name} contains merge markers`);
  }
});
