import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDashboardPayload, loadArtifactMap } from './dashboard-data.mjs';

const args = parseArgs(process.argv.slice(2));
const rootPath = path.resolve(args.path || process.cwd());
const outDir = path.resolve(args.out || path.join(rootPath, 'dashboard-static'));

// outDir gets rm -rf'd below — refuse obviously catastrophic targets.
const dangerous = [path.parse(outDir).root, os.homedir(), rootPath];
if (dangerous.includes(outDir)) {
  console.error(`Refusing to use dangerous output dir: ${outDir}`);
  process.exit(2);
}
const artifactMapPath = args['artifact-map'] ? path.resolve(args['artifact-map']) : null;

// Wipe the output dir BEFORE copying artifacts into it. The artifact copy
// used to run first, so the rm() below silently deleted every report and
// output file from the deploy — all artifact links 404'd in production.
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(path.join(outDir, 'assets'), { recursive: true });
await fs.mkdir(path.join(outDir, 'assets', 'fonts'), { recursive: true });

const importedMap = await loadArtifactMap(artifactMapPath);
const staticArtifactMap = await buildStaticArtifactMap(rootPath, importedMap);
const payload = await buildDashboardPayload({
  rootPath,
  linkMode: 'hybrid',
  artifactMap: staticArtifactMap,
});

await writeDashboardPage({
  sourcePath: path.join(rootPath, 'dashboard-web', 'terminal.html'),
  destinationPath: path.join(outDir, 'index.html'),
  dataUrl: '/dashboard-data.json',
});
await writeDashboardPage({
  sourcePath: path.join(rootPath, 'dashboard-web', 'terminal.html'),
  destinationPath: path.join(outDir, 'terminal', 'index.html'),
  dataUrl: '/dashboard-data.json',
});
await copyFile(path.join(rootPath, 'dashboard-web', 'login.html'), path.join(outDir, 'login', 'index.html'));

await copyFile(path.join(rootPath, 'dashboard-web', 'app.js'), path.join(outDir, 'assets', 'app.js'));
await copyFile(path.join(rootPath, 'dashboard-web', 'favicon.svg'), path.join(outDir, 'assets', 'favicon.svg'));
await copyFile(path.join(rootPath, 'dashboard-auth-middleware.js'), path.join(outDir, 'middleware.js'));
await copyCssWithFontRewrite(
  path.join(rootPath, 'dashboard-web', 'styles.css'),
  path.join(outDir, 'assets', 'styles.css'),
);
await copyCssWithFontRewrite(
  path.join(rootPath, 'dashboard-web', 'terminal.css'),
  path.join(outDir, 'assets', 'terminal.css'),
);
await copyCssWithFontRewrite(
  path.join(rootPath, 'dashboard-web', 'login.css'),
  path.join(outDir, 'assets', 'login.css'),
);

const fontFiles = await fs.readdir(path.join(rootPath, 'fonts'));
for (const fontName of fontFiles) {
  await copyFile(
    path.join(rootPath, 'fonts', fontName),
    path.join(outDir, 'assets', 'fonts', fontName),
  );
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

console.log(`Built static dashboard in ${outDir}`);
console.log(`Apps: ${payload.counts.all}`);
console.log(`Artifacts mapped: ${Object.keys(staticArtifactMap).length}`);

async function buildStaticArtifactMap(root, imported) {
  const resolved = { ...imported };
  await copyDirectory(
    path.join(root, 'reports'),
    path.join(outDir, 'reports'),
    (relativePath) => {
      resolved[normalizeRelativePath(path.join('reports', relativePath))] = `/${normalizeRelativePath(path.join('reports', relativePath))}`;
    },
  );
  await copyDirectory(
    path.join(root, 'output'),
    path.join(outDir, 'output'),
    (relativePath) => {
      resolved[normalizeRelativePath(path.join('output', relativePath))] = `/${normalizeRelativePath(path.join('output', relativePath))}`;
    },
  );
  return resolved;
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

async function copyCssWithFontRewrite(sourcePath, destinationPath) {
  const raw = await fs.readFile(sourcePath, 'utf8');
  const updated = raw.replaceAll('/file/fonts/', '/assets/fonts/');
  await fs.writeFile(destinationPath, updated, 'utf8');
}

async function copyDirectory(sourceDir, destinationDir, onFile) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath, (relativePath) => {
        onFile(path.join(entry.name, relativePath));
      });
      continue;
    }
    await copyFile(sourcePath, destinationPath);
    onFile(entry.name);
  }
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
  console.log('Usage: node build-dashboard-static.mjs [--path <career-ops-dir>] [--out <dir>] [--artifact-map <json-path>]');
}
