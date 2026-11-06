const path = require('node:path');
// Owner sets the confirmed hosted destination before distribution.
const { onlineUrl } = require('./release-config.json');
const ONLINE = onlineUrl && /^https:\/\/[^/?#]+\/?$/.test(onlineUrl) && !new URL(onlineUrl).username && !new URL(onlineUrl).password ? onlineUrl : null;
const HELP = 'https://github.com/akhan157/Plainhand/issues/new/choose';
const EXTERNAL_HOSTS = new Set(['auth.openai.com', 'chatgpt.com', 'developers.openai.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com', 'code.claude.com', 'www.antigravity.google', 'github.com']);
function externalAllowed(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || (!EXTERNAL_HOSTS.has(u.hostname) && (!ONLINE || u.origin !== new URL(ONLINE).origin))) return false;
    // GitHub is a support/download destination, not an arbitrary repo launcher.
    return u.hostname !== 'github.com' || /^\/akhan157\/plainhand(?:\/|$)/i.test(u.pathname);
  } catch { return false; }
}
function localAllowed(raw, origin) {
  try { const u = new URL(raw); return u.origin === origin && u.protocol === 'http:' && !u.username && !u.password; } catch { return false; }
}
function runtimePath({ packaged, resourcesPath, projectRoot }) {
  return packaged ? path.join(resourcesPath, 'runtime') : projectRoot;
}
function nodeEnvironment(env, browsersPath) {
  const result = { ...env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: browsersPath };
  delete result.NODE_OPTIONS; delete result.ELECTRON_NO_ASAR;
  return result;
}
module.exports = { ONLINE, HELP, externalAllowed, localAllowed, runtimePath, nodeEnvironment };
