const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const desktop = path.resolve(__dirname, '..');
test('staged runtime imports the real server without root node_modules or personal files', { skip: !fs.existsSync(path.join(desktop, 'build/runtime/plainhand-server.mjs')) }, () => {
  const runtime = path.join(desktop, 'build/runtime');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "const {createPlainhand}=await import('./plainhand-server.mjs'); if(typeof createPlainhand !== 'function')process.exit(1)"], { cwd: runtime, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['cv.md', 'config/profile.yml', 'modes/_profile.md', '.env', 'data', 'output', 'reports', '.git']) assert.equal(fs.existsSync(path.join(runtime, name)), false, name);
  for (const name of ['playwright', 'js-yaml', '@modelcontextprotocol/sdk', '@google/generative-ai', 'dotenv', 'postgres']) assert.ok(fs.existsSync(path.join(runtime, 'node_modules', name, 'package.json')), name);
  assert.ok(fs.existsSync(path.join(runtime, 'plainhand/web/index.html')));
  assert.ok(fs.existsSync(path.join(runtime, 'desktop/server-child.mjs')));
});
test('actual unpacked package contains all pinned runtime dependencies outside ASAR', { skip: !fs.existsSync(path.join(desktop, 'dist/linux-unpacked/resources/runtime')) }, () => {
  require('../scripts/verify-package.cjs').verifyRuntime(path.join(desktop, 'dist/linux-unpacked/resources/runtime'));
});
