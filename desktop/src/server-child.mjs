// Runs as Node inside Electron's executable; no Electron renderer privileges.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = process.env.PLAINHAND_RUNTIME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
if (process.argv[2] === 'chromium-verify') {
  const { chromium } = require('playwright');
  try {
    const browser = await chromium.launch({ headless: true });
    try { const page = await browser.newPage(); await page.setContent('<h1>Plainhand browser check</h1>'); await page.pdf(); }
    finally { await browser.close(); }
    process.exit(0);
  } catch { process.exit(3); }
}
if (process.argv[2] === 'chromium-check') {
  const { chromium } = require('playwright');
  if (!existsSync(chromium.executablePath())) process.exit(2);
  process.exit(0);
}
const { createPlainhand } = await import(pathToFileURL(path.join(root, 'plainhand-server.mjs')).href);
const instance = await createPlainhand({ root: process.env.PLAINHAND_WORKSPACE });
// The shared UI's empty popup is denied. Open the existing sign-in result in
// the system browser, preserving its PKCE/state/loopback flow unchanged.
const originalStart = instance.chatgpt.start.bind(instance.chatgpt);
instance.chatgpt.start = async (...args) => {
  const result = await originalStart(...args);
  process.send?.({ type: 'open-signin', url: result.url });
  return result;
};
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await instance.close();
  process.exit(0);
}
process.on('message', message => { if (message?.type === 'stop') close().catch(() => process.exit(1)); });
process.on('disconnect', () => close().catch(() => process.exit(1)));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => close().catch(() => process.exit(1)));
instance.server.on('error', error => { process.send?.({ type: 'failure', message: error.message }); process.exit(1); });
instance.server.listen(0, '127.0.0.1', () => process.send?.({ type: 'ready', origin: `http://127.0.0.1:${instance.server.address().port}`, token: instance.token }));
