#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { createDemoFixture } from './onboarding.mjs';

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));
const SYSTEM_FONT_CANDIDATES = Object.freeze([
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf'),
  '/System/Library/Fonts/Supplemental/Arial.ttf',
]);
const DEFAULT_DASHBOARD_PORT = 3761;

const APPLICATIONS = `# Synthetic Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-10 | Example Robotics | Demo Platform Engineer | 4.7/5 | Apply | ❌ | [1](reports/001-example-robotics.md) | Synthetic sandbox row |
| 2 | 2026-08-11 | Fictional Transit Labs | Demo Systems Engineer | 4.4/5 | Interview | ❌ | [2](reports/002-fictional-transit-labs.md) | Synthetic sandbox row |
`;

const REPORTS = Object.freeze({
  'reports/001-example-robotics.md': `# Example Robotics — Demo Platform Engineer

**URL:** https://jobs.example.invalid/example-robotics-platform
**Legitimacy:** unconfirmed
**TL;DR:** Fictional platform role used only by the local Career-Ops sandbox.

## Verdict
Apply is visible in the tracker, but this fixture never submits an application.
`,
  'reports/002-fictional-transit-labs.md': `# Fictional Transit Labs — Demo Systems Engineer

**URL:** https://jobs.example.invalid/fictional-transit-systems
**Legitimacy:** unconfirmed
**TL;DR:** Fictional interview-stage role used only by the local Career-Ops sandbox.

## Verdict
Interview workflow data is synthetic and safe for local dashboard inspection.
`,
});

const PIPELINE = `# Synthetic Scan Queue

## Pending

### Demonstration
- [ ] https://jobs.example.invalid/pending-observability | Sample Aerospace Works | Demo Observability Engineer | Remote | 100000 XXX | Synthetic pending role
`;

const FOLLOW_UPS = `# Synthetic Follow-ups

| # | Application | Company | Role | Date | Channel | Contact | Note | Next Date | Next Action |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | Fictional Transit Labs | Demo Systems Engineer | 2026-08-11 | email | Demo Recruiter | Synthetic interview follow-up | 2026-08-12 | Confirm fictional interview time |
`;

function isPathWithin(parent, candidate) {
  const child = relative(parent, candidate);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function assertSafeOutputPath(outputPath) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new TypeError('Sandbox output path is required');
  }
  if (!isAbsolute(outputPath)) {
    throw new Error('Sandbox output path must be absolute');
  }

  const root = resolve(outputPath);
  const repositoryRoot = resolve(SOURCE_ROOT);
  if (isPathWithin(repositoryRoot, root)) {
    throw new Error(`Refusing to use the Career-Ops repository root or a descendant as sandbox output: ${root}`);
  }

  const forbidden = new Map([
    [parse(root).root, 'filesystem root'],
    [resolve(homedir()), 'user home directory'],
  ]);
  if (forbidden.has(root)) {
    throw new Error(`Refusing to use ${forbidden.get(root)} as sandbox output: ${root}`);
  }

  if (existsSync(root)) {
    const metadata = lstatSync(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Sandbox output must be a real directory: ${root}`);
    }
    if (readdirSync(root).length > 0) {
      throw new Error(`Refusing to use non-empty sandbox output: ${root}`);
    }
  }
  return root;
}

function assertSourcePath(path, label) {
  if (!existsSync(path)) throw new Error(`Sandbox setup error: ${label} is missing at ${path}`);
  return path;
}

function selectFontSource() {
  const projectFonts = join(SOURCE_ROOT, 'fonts');
  if (existsSync(projectFonts) && lstatSync(projectFonts).isDirectory() && readdirSync(projectFonts).length > 0) {
    return { kind: 'directory', path: projectFonts };
  }
  const fallback = SYSTEM_FONT_CANDIDATES.find((path) => existsSync(path) && lstatSync(path).isFile());
  if (fallback) return { kind: 'file', path: fallback };
  throw new Error(
    `Sandbox setup error: no project fonts or supported system fallback found (${SYSTEM_FONT_CANDIDATES.join(', ')})`,
  );
}

function destination(root, relativePath) {
  const target = resolve(root, relativePath);
  const child = relative(root, target);
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error(`Sandbox path escapes output root: ${relativePath}`);
  }
  return target;
}

function assertAbsent(root, relativePath) {
  const target = destination(root, relativePath);
  if (existsSync(target)) throw new Error(`Refusing to replace existing sandbox path: ${relativePath}`);
  return target;
}

function writeFixtureFile(root, relativePath, content, files) {
  const target = assertAbsent(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
  files.push(relativePath);
}

function collectFiles(root, relativePath, files) {
  const target = destination(root, relativePath);
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = join(relativePath, entry.name);
    if (entry.isDirectory()) collectFiles(root, child, files);
    else files.push(child);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function buildViewCommands(root, port) {
  const node = shellQuote(process.execPath);
  const doctor = shellQuote(join(SOURCE_ROOT, 'doctor.mjs'));
  const lifecycle = shellQuote(join(SOURCE_ROOT, 'lifecycle-runner.mjs'));
  const dashboard = shellQuote(join(SOURCE_ROOT, 'web-dashboard-server.mjs'));
  const quotedRoot = shellQuote(root);
  const dashboardUrl = `http://127.0.0.1:${port}/terminal`;
  return Object.freeze({
    doctor: `${node} ${doctor} --target ${quotedRoot}`,
    lifecycle: `${node} ${lifecycle} --root ${quotedRoot} --url 'https://jobs.example.invalid/demo-role' --company 'Demo Company' --role 'Demo Engineer' --demo`,
    dashboardServer: `${node} ${dashboard} --path ${quotedRoot} --host 127.0.0.1 --port ${port}`,
    dashboardApi: `curl -fsS http://127.0.0.1:${port}/api/apps`,
    browser: dashboardUrl,
  });
}

export function createSandboxFixture(outputPath, options = {}) {
  const port = options.port ?? DEFAULT_DASHBOARD_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Sandbox dashboard port must be an integer from 1 through 65535');
  }

  const root = assertSafeOutputPath(outputPath);
  const statesSource = assertSourcePath(join(SOURCE_ROOT, 'templates', 'states.yml'), 'canonical states fixture');
  const dashboardSource = assertSourcePath(join(SOURCE_ROOT, 'dashboard-web'), 'dashboard web assets');
  const dependenciesSource = assertSourcePath(join(SOURCE_ROOT, 'node_modules'), 'source project dependencies');
  const fontSource = selectFontSource();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });

  const demo = createDemoFixture(root);
  const files = [...demo.createdFiles];

  const statesTarget = assertAbsent(root, 'templates/states.yml');
  mkdirSync(dirname(statesTarget), { recursive: true });
  copyFileSync(statesSource, statesTarget, 0);
  files.push('templates/states.yml');

  const dashboardTarget = assertAbsent(root, 'dashboard-web');
  cpSync(dashboardSource, dashboardTarget, { recursive: true, errorOnExist: true, force: false });
  collectFiles(root, 'dashboard-web', files);

  writeFixtureFile(root, 'data/applications.md', APPLICATIONS, files);
  for (const [relativePath, content] of Object.entries(REPORTS)) {
    writeFixtureFile(root, relativePath, content, files);
  }
  writeFixtureFile(root, 'data/pipeline.md', PIPELINE, files);
  writeFixtureFile(root, 'data/follow-ups.md', FOLLOW_UPS, files);

  const fontsTarget = assertAbsent(root, 'fonts');
  if (fontSource.kind === 'directory') {
    cpSync(fontSource.path, fontsTarget, { recursive: true, errorOnExist: true, force: false });
    collectFiles(root, 'fonts', files);
  } else {
    mkdirSync(fontsTarget);
    const relativeFont = join('fonts', `fallback${extname(fontSource.path) || extname(basename(fontSource.path))}`);
    copyFileSync(fontSource.path, destination(root, relativeFont), 0);
    files.push(relativeFont);
  }

  const modulesTarget = assertAbsent(root, 'node_modules');
  try {
    symlinkSync(dependenciesSource, modulesTarget, 'dir');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    symlinkSync(dependenciesSource, modulesTarget, 'junction');
  }
  files.push('node_modules');

  return {
    root,
    files: Object.freeze([...files]),
    viewCommands: buildViewCommands(root, port),
  };
}

function parseArgs(args) {
  const allowed = new Set(['--help', '-h', '--output']);
  for (const arg of args) {
    if (arg.startsWith('-') && !allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
  }
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const outputIndex = args.indexOf('--output');
  if (outputIndex === -1) return { output: null };
  const output = args[outputIndex + 1];
  if (!output || output.startsWith('-')) throw new Error('--output requires an absolute path');
  if (outputIndex + 2 < args.length) throw new Error(`Unexpected argument: ${args[outputIndex + 2]}`);
  return { output };
}

function printHelp() {
  console.log(`Usage: node sandbox-demo.mjs [--output <absolute-path>]

Build a personal-data-free Career-Ops sandbox without contacting job providers.

Options:
  --output <absolute-path>  Persist the sandbox at a nonexistent or empty directory.
  --help, -h                Show this help.

Without --output, a persistent temporary sandbox is created and its path is printed.
The result includes exact doctor, demo lifecycle, dashboard server/API, and browser commands.
No server is started automatically.`);
}

function printFixture(fixture) {
  console.log(`Sandbox root: ${fixture.root}`);
  console.log(`Doctor: ${fixture.viewCommands.doctor}`);
  console.log(`Lifecycle: ${fixture.viewCommands.lifecycle}`);
  console.log(`Dashboard server: ${fixture.viewCommands.dashboardServer}`);
  console.log(`Dashboard API: ${fixture.viewCommands.dashboardApi}`);
  console.log(`Browser: ${fixture.viewCommands.browser}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const output = args.output ?? mkdtempSync(join(tmpdir(), 'career-ops-sandbox-'));
      printFixture(createSandboxFixture(output));
    }
  } catch (error) {
    console.error(`sandbox-demo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
