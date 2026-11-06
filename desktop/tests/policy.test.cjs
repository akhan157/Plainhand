const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { externalAllowed, localAllowed, runtimePath, nodeEnvironment } = require('../src/policy.cjs');
test('external destinations reject protocols, host spoofing, credentials and ports', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://auth.openai.com', 'https://auth.openai.com.evil.test/a', 'https://user:pw@chatgpt.com', 'https://chatgpt.com:444', 'https://evil.test', 'https://github.com/other/repo', 'https://github.com/akhan157/Plainhand-evil']) assert.equal(externalAllowed(url), false, url);
  for (const url of ['https://auth.openai.com/oauth/authorize?state=abc', 'https://chatgpt.com/settings/usage', 'https://github.com/akhan157/Plainhand/issues/new/choose']) assert.equal(externalAllowed(url), true, url);
});
test('renderer can navigate only to exact local origin', () => {
  const origin = 'http://127.0.0.1:33123';
  assert.equal(localAllowed(origin + '/?a=1#settings', origin), true);
  for (const url of ['http://localhost:33123/', 'http://127.0.0.1:33124/', 'http://user@127.0.0.1:33123/', 'https://127.0.0.1:33123/', 'file:///tmp/a', 'about:blank']) assert.equal(localAllowed(url, origin), false, url);
});
test('packaged runtime uses real resources outside ASAR; Node child environment survives', () => {
  assert.equal(runtimePath({ packaged: true, resourcesPath: '/opt/Plainhand/resources', projectRoot: '/dev/app' }), path.join('/opt/Plainhand/resources', 'runtime'));
  assert.equal(runtimePath({ packaged: false, resourcesPath: '/opt/r', projectRoot: '/dev/app' }), '/dev/app');
  const env = nodeEnvironment({ PATH: '/bin', NODE_OPTIONS: '--inspect', ELECTRON_NO_ASAR: '1' }, '/home/user/browsers');
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1'); assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '/home/user/browsers');
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.ELECTRON_NO_ASAR, undefined); assert.equal(env.PATH, '/bin');
});
