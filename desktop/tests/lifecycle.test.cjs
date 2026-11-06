const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startServer } = require('../src/lifecycle.cjs');
function fakeChild() {
  const child = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null, connected: true, send(message) { this.sent = message; setImmediate(() => { this.exitCode = 0; this.emit('exit', 0); }); }, kill(signal) { this.signalCode = signal; this.emit('exit', null, signal); } });
  return child;
}
test('readiness validates IPC and stop waits for graceful process exit, idempotently', async () => {
  const child = fakeChild(); let options;
  const service = startServer({ executable: 'electron', entry: '/real/child.mjs', cwd: '/real', env: { ELECTRON_RUN_AS_NODE: '1' }, spawnImpl: (_exe, _args, opts) => { options = opts; return child; } });
  child.emit('message', { type: 'ready', origin: 'https://evil.test', token: 'bad' });
  child.emit('message', { type: 'ready', origin: 'http://127.0.0.1:5000', token: 'a'.repeat(64) });
  assert.equal((await service.ready).origin, 'http://127.0.0.1:5000'); assert.equal(options.stdio[3], 'ipc'); assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  const stop = service.stop(); assert.equal(service.stop(), stop); await stop; assert.deepEqual(child.sent, { type: 'stop' });
});
test('crash before readiness and readiness timeout reject; stop terminates hung child', async () => {
  const child = fakeChild(); const service = startServer({ executable: '', entry: '', spawnImpl: () => child });
  child.emit('exit', 1); await assert.rejects(service.ready, /stopped/);
  const hung = fakeChild(); hung.send = () => {};
  const next = startServer({ executable: '', entry: '', spawnImpl: () => hung, timeout: 5 });
  await assert.rejects(next.ready, /too long/); await next.stop(5); assert.equal(hung.signalCode, 'SIGKILL');
});
