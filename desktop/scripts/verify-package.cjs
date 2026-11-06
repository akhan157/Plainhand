const fs = require('node:fs');
const path = require('node:path');
function verifyRuntime(runtime) {
  for (const name of ['plainhand-server.mjs', 'plainhand/web/index.html', 'desktop/server-child.mjs', 'node_modules/playwright/cli.js', 'node_modules/playwright-core/cli.js']) {
    if (!fs.existsSync(path.join(runtime, name))) throw new Error(`Packaged runtime is missing ${name}`);
  }
  const manifest = require('../runtime/package.json');
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const packaged = JSON.parse(fs.readFileSync(path.join(runtime, 'node_modules', name, 'package.json'), 'utf8'));
    if (packaged.version !== version) throw new Error(`Packaged dependency version mismatch: ${name}`);
  }
  for (const name of ['data', 'reports', 'output', 'cv.md', 'config/profile.yml', 'modes/_profile.md', '.env', '.git']) {
    if (fs.existsSync(path.join(runtime, name))) throw new Error(`Personal/workspace file in package: ${name}`);
  }
}
module.exports = async context => {
  const resources = context.electronPlatformName === 'darwin' ? path.join(context.appOutDir, 'Plainhand.app/Contents/Resources') : path.join(context.appOutDir, 'resources');
  verifyRuntime(path.join(resources, 'runtime'));
};
module.exports.verifyRuntime = verifyRuntime;
