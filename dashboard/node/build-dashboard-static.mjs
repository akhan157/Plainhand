import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardPayload, loadArtifactMap } from './dashboard-data.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Build the read-only dashboard into a deployable static directory. `rootPath`
// holds the candidate workspace (data, reports, output); `codeRoot` holds the
// dashboard shell and templates. They are the same directory in the default
// layout and differ when the app runs with --data-root.
export async function buildStaticDashboard({
  rootPath = process.cwd(),
  codeRoot = APP_ROOT,
  outDir = path.join(path.resolve(rootPath), 'dashboard-static'),
  artifactMapPath = null,
  log = console.log,
} = {}) {
  rootPath = path.resolve(rootPath);
  codeRoot = path.resolve(codeRoot);
  outDir = path.resolve(outDir);

  // outDir gets rm -rf'd below — refuse obviously catastrophic targets.
  const dangerous = [path.parse(outDir).root, os.homedir(), rootPath, codeRoot];
  if (dangerous.includes(outDir)) {
    throw new Error(`Refusing to use dangerous output dir: ${outDir}`);
  }
  artifactMapPath = artifactMapPath ? path.resolve(artifactMapPath) : null;

  // Wipe the output dir BEFORE copying artifacts into it. The artifact copy
  // used to run first, so the rm() below silently deleted every report and
  // output file from the deploy — all artifact links 404'd in production.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(path.join(outDir, 'assets'), { recursive: true });

  const importedMap = await loadArtifactMap(artifactMapPath);
  const availableMap = await indexLocalArtifacts({ rootPath, importedMap });
  const payload = await buildDashboardPayload({
    rootPath,
    codeRoot,
    linkMode: 'hybrid',
    artifactMap: availableMap,
  });
  const copiedArtifacts = await copyReferencedArtifacts({ rootPath, outDir, payload, availableMap });

  await writeDashboardPage({
    sourcePath: path.join(codeRoot, 'dashboard-web', 'terminal.html'),
    destinationPath: path.join(outDir, 'index.html'),
    dataUrl: '/dashboard-data.json',
  });
  await writeDashboardPage({
    sourcePath: path.join(codeRoot, 'dashboard-web', 'terminal.html'),
    destinationPath: path.join(outDir, 'terminal', 'index.html'),
    dataUrl: '/dashboard-data.json',
  });
  await copyFile(path.join(codeRoot, 'dashboard-web', 'login.html'), path.join(outDir, 'login', 'index.html'));

  await copyFile(path.join(codeRoot, 'dashboard-web', 'app.js'), path.join(outDir, 'assets', 'app.js'));
  await copyFile(path.join(codeRoot, 'dashboard-web', 'favicon.svg'), path.join(outDir, 'assets', 'favicon.svg'));
  await copyFile(path.join(codeRoot, 'dashboard', 'node', 'dashboard-auth-middleware.js'), path.join(outDir, 'middleware.js'));

  const fontsDir = path.join(codeRoot, 'fonts');
  const fontsAvailable = existsSync(fontsDir);
  if (fontsAvailable) await fs.mkdir(path.join(outDir, 'assets', 'fonts'), { recursive: true });
  await copyCssWithFontRewrite({
    sourcePath: path.join(codeRoot, 'dashboard-web', 'styles.css'),
    destinationPath: path.join(outDir, 'assets', 'styles.css'),
    fontsAvailable,
  });
  await copyCssWithFontRewrite({
    sourcePath: path.join(codeRoot, 'dashboard-web', 'terminal.css'),
    destinationPath: path.join(outDir, 'assets', 'terminal.css'),
    fontsAvailable,
  });
  await copyCssWithFontRewrite({
    sourcePath: path.join(codeRoot, 'dashboard-web', 'login.css'),
    destinationPath: path.join(outDir, 'assets', 'login.css'),
    fontsAvailable,
  });

  if (fontsAvailable) {
    for (const fontName of await fs.readdir(fontsDir)) {
      await copyFile(path.join(fontsDir, fontName), path.join(outDir, 'assets', 'fonts', fontName));
    }
  }

  await fs.writeFile(path.join(outDir, 'dashboard-data.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(outDir, 'vercel.json'),
    `${JSON.stringify({
      cleanUrls: false,
      headers: [
        {
          source: '/(dashboard-data\\.json|reports/.*|output/.*)',
          headers: [
            { key: 'Cache-Control', value: 'private, no-store' },
          ],
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );

  log(`Built static dashboard in ${outDir}`);
  log(`Apps: ${payload.counts.all}`);
  log(`Artifacts copied: ${copiedArtifacts}`);
  return { outDir, payload, artifactCount: copiedArtifacts };
}

// Index report/output files without copying them. The payload is built against
// this map, then only the files the payload actually links are published. Test
// evidence and unrelated files in output/ would otherwise be uploaded too.
async function indexLocalArtifacts({ rootPath, imported }) {
  const resolved = { ...imported };
  for (const directory of ['reports', 'output']) {
    for (const relative of await listFiles(path.join(rootPath, directory))) {
      const normalized = normalizeRelativePath(path.join(directory, relative));
      resolved[normalized] = `/${normalized}`;
    }
  }
  return resolved;
}

async function copyReferencedArtifacts({ rootPath, outDir, payload, availableMap }) {
  const text = JSON.stringify(payload);
  let copied = 0;
  for (const [relative, url] of Object.entries(availableMap)) {
    if (!relative.startsWith('reports/') && !relative.startsWith('output/')) continue;
    if (!text.includes(url)) continue;
    const sourcePath = path.join(rootPath, relative);
    try {
      await copyFile(sourcePath, path.join(outDir, relative));
      copied++;
    } catch {
      // The payload can keep a link to a file the candidate moved after the tracker edit.
    }
  }
  return copied;
}

async function listFiles(directory, prefix = '') {
  let entries;
  try { entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function writeDashboardPage({ sourcePath, destinationPath, dataUrl }) {
  const raw = await fs.readFile(sourcePath, 'utf8');
  const updated = raw.replace(
    /<meta name="dashboard-data-url" content="[^"]*">/,
    `<meta name="dashboard-data-url" content="${dataUrl}">`,
  );
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, updated, 'utf8');
}

// The shell ships without the optional Iosevka font files. Keep the CSS usable
// by dropping the @font-face blocks that would otherwise request 404s; the font
// stacks below them still resolve to the system fallbacks.
async function copyCssWithFontRewrite({ sourcePath, destinationPath, fontsAvailable }) {
  let raw = await fs.readFile(sourcePath, 'utf8');
  if (!fontsAvailable) raw = raw.replace(/@font-face\s*\{[^}]*\}\s*/g, '');
  raw = raw.replaceAll('/file/fonts/', '/assets/fonts/');
  await fs.writeFile(destinationPath, raw, 'utf8');
}

async function copyFile(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

function printHelp() {
  console.log('Usage: node dashboard/node/build-dashboard-static.mjs [--path <workspace-dir>] [--code-root <app-dir>] [--out <dir>] [--artifact-map <json-path>]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    await buildStaticDashboard({
      rootPath: path.resolve(args.path || process.cwd()),
      codeRoot: path.resolve(args['code-root'] || APP_ROOT),
      ...(args.out ? { outDir: path.resolve(args.out) } : {}),
      ...(args['artifact-map'] ? { artifactMapPath: path.resolve(args['artifact-map']) } : {}),
    });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
