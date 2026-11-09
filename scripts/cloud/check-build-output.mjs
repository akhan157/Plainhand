// After `vercel build`: every file under plainhand/web must reach the function bundle
// byte for byte. A transformed browser file (e.g. ES modules compiled to CommonJS)
// breaks the hosted page while every server test still passes.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const bundle = path.join(root, '.vercel/output/functions/api/index.func');
async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(full)); else out.push(full);
  }
  return out;
}
// Files the build leaves untouched may be listed in filePathMap (served from the
// source path) instead of being copied into the bundle directory.
const config = JSON.parse(await readFile(path.join(bundle, '.vc-config.json'), 'utf8'));
const mapped = config.filePathMap || {};
const problems = [];
for (const leaked of ['data', 'output', 'tmp', 'reports']) {
  let found = []; try { found = await files(path.join(bundle, leaked)); } catch {}
  if (found.length) problems.push(`local-only files in the bundle: ${leaked}/ (${found.length})`);
}
for (const source of await files(path.join(root, 'plainhand/web'))) {
  const relative = path.relative(root, source);
  let built;
  if (mapped[relative] === relative) continue; // shipped verbatim from the source path
  try { built = await readFile(path.join(bundle, relative)); } catch { problems.push(`missing: ${relative}`); continue; }
  if (!built.equals(await readFile(source))) problems.push(`changed by the build: ${relative}`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('web files reach the bundle unchanged');
