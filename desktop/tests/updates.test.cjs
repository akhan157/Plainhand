const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { configureUpdates } = require('../src/updates.cjs');
test('updates never run in development or unpacked Linux builds', () => {
  assert.equal(configureUpdates({ app: { isPackaged: false } }), null);
  assert.equal(configureUpdates({ app: { isPackaged: true }, platform: 'linux', env: {} }), null);
});
test('download and restart both require a user choice; ordinary quit cannot install', async () => {
  const updater = new EventEmitter(); let downloads = 0, restarts = 0, response = 1;
  updater.downloadUpdate = async () => { downloads++; }; updater.quitAndInstall = () => { restarts++; };
  const pending = [];
  configureUpdates({ app: { isPackaged: true }, updater, platform: 'win32', dialog: { showMessageBox: async () => ({ response }) }, window: () => ({ setProgressBar() {} }), restart: async fn => fn() });
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  updater.emit('update-available', { version: '2.0.0' }); updater.emit('update-downloaded'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(downloads, 0); assert.equal(restarts, 0);
  response = 0; updater.emit('update-available', { version: '2.0.0' }); updater.emit('update-downloaded'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(downloads, 1); assert.equal(restarts, 1);
});
