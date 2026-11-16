#!/usr/bin/env node
// Release gate for Plainhand. Run from a clean checkout of the commit being released:
//
//   npm run release:check -- --tag v1.2.0
//
// It refuses on a dirty tree, checks that the version, release notes and tag agree, and
// runs the gates every release must pass. It does not tag, push or publish: that stays a
// maintainer action. See docs/internal/RELEASE.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The gates in the order a release runs them. `test:plainhand` includes the migration and
// update tests; the UI gate drives a real Chromium; the controlled evaluation and the
// simulation benchmark are offline and use fixture agents, so they spend no model budget.
export const GATES = [
  { key: 'unit', label: 'fast suite and migrations', command: 'npm', args: ['run', 'test:plainhand'] },
  { key: 'ui', label: 'browser UI gate', command: 'npm', args: ['run', 'test:plainhand-ui'] },
  { key: 'evaluation', label: 'controlled evaluation gate', command: 'npm', args: ['run', 'benchmark:eval'] },
  { key: 'simulation', label: 'simulation benchmark', command: 'npm', args: ['run', 'benchmark:simulation'] },
];

function parse(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('--')) { flags._.push(item); continue; }
    const [name, inline] = item.slice(2).split('=');
    if (inline !== undefined) flags[name] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) flags[name] = argv[++index];
    else flags[name] = true;
  }
  return flags;
}

const flags = parse(process.argv.slice(2));
const root = path.resolve(flags.root || DEFAULT_ROOT);
const version = (() => {
  try { return readFileSync(path.join(root, 'VERSION'), 'utf8').trim().split(/\s+/)[0] || null; }
  catch { return null; }
})();
const tag = typeof flags.tag === 'string' ? flags.tag : version ? `v${version}` : null;
const notes = tag ? path.join(root, 'docs', 'releases', `${tag}.md`) : null;

export function preflight({ root: directory = root, tag: releaseTag = tag, version: current = version } = {}) {
  const problems = [];
  if (!current) problems.push('VERSION is missing or empty.');
  if (!releaseTag || !/^v\d+\.\d+\.\d+$/.test(releaseTag)) problems.push(`The release tag must look like vX.Y.Z (got ${releaseTag || 'none'}).`);
  else if (current && releaseTag.replace(/^v/, '') !== current) problems.push(`VERSION is ${current} but the tag is ${releaseTag}. Bump VERSION in the same commit you tag.`);
  const file = releaseTag ? path.join(directory, 'docs', 'releases', `${releaseTag}.md`) : null;
  if (file && !existsSync(file)) problems.push(`Release notes are missing: docs/releases/${releaseTag}.md (the GitHub release workflow requires this file).`);
  let status = '';
  try { status = execFileSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { problems.push('This is not a git checkout; a release runs from one.'); }
  if (status) problems.push(`The tree has uncommitted changes:\n${status}\nCommit or stash them; a release is built from one commit.`);
  return { ok: problems.length === 0, problems, tag: releaseTag, version: current, notes: file };
}

function main() {
  const result = preflight();
  if (flags.json) console.log(JSON.stringify({ ...result, gates: GATES.map(gate => gate.key) }));
  if (!result.ok) {
    console.error('Release check refused:\n');
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exit(1);
  }

  console.log(`Release ${tag} (Plainhand ${version})`);
  if (!/upgrad/i.test(readFileSync(notes, 'utf8'))) console.log('! The release notes have no "Upgrading" section; candidates should be told how to update.');
  for (const gate of GATES) console.log(`  gate ${gate.key.padEnd(11)} ${gate.label}`);

  if (flags['dry-run']) {
    console.log('\nDry run: preflight passed and no gate was run.');
    process.exit(0);
  }

  const results = [];
  for (const gate of GATES) {
    console.log(`\n▶ ${gate.label} — ${gate.command} ${gate.args.join(' ')}`);
    const started = Date.now();
    const run = spawnSync(gate.command, gate.args, { cwd: root, stdio: 'inherit' });
    const ms = Date.now() - started;
    const ok = run.status === 0 && !run.error;
    results.push({ ...gate, ok, ms });
    console.log(`${ok ? '✔' : '✖'} ${gate.label} (${(ms / 1000).toFixed(1)} s)`);
    if (!ok) {
      console.error(`\nRelease check stopped at the ${gate.label}. Nothing was tagged or published.`);
      console.error('Fix the failure and run the whole check again; a partial run is not a release.');
      process.exit(1);
    }
  }

  console.log(`\nAll ${results.length} gates passed.`);
  console.log('Next, as a maintainer with release authority:\n');
  console.log(`  git tag -a ${tag} -m "Plainhand ${tag}"`);
  console.log(`  git push origin ${tag}`);
  console.log(`\nThe tag publishes the GitHub release from docs/releases/${tag}.md. Candidates receive it`);
  console.log('with `plainhand update` (installed copies: the update command runs the installer).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
