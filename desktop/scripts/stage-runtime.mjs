import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, copyFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(desktop), target = path.join(desktop, 'build/runtime');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// Tracked system source only. Never copy an entire checkout or workspace.
const system = /^(?:plainhand\/|lib\/|providers\/|dashboard\/node\/|dashboard-web\/|templates\/|modes\/)/;
const excluded = /(?:^|\/)(?:_profile\.md|\.env[^/]*|node_modules)(?:\/|$)/;
for (const name of execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)) {
  if (!(system.test(name) || ['plainhand-server.mjs', 'plainhand-mcp.mjs', 'LICENSE', 'VERSION'].includes(name)) || excluded.test(name)) continue;
  if (!(await lstat(path.join(root, name))).isFile()) throw new Error(`Refusing non-file runtime source: ${name}`);
  const destination = path.join(target, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, name), destination);
}
for (const name of ['package.json', 'package-lock.json']) await copyFile(path.join(desktop, 'runtime', name), path.join(target, name));
await mkdir(path.join(target, 'desktop'), { recursive: true });
await copyFile(path.join(desktop, 'src/server-child.mjs'), path.join(target, 'desktop/server-child.mjs'));
const install = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
if (install.status !== 0) throw new Error('Runtime dependency installation failed');
console.log(`Staged system runtime at ${target}`);
