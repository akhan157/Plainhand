#!/usr/bin/env node
// Writes or checks the frozen baseline manifest (measurement design §8).
//   node scripts/baseline-manifest.mjs --write   regenerate docs/internal/baseline/BASELINE-MANIFEST.json
//   node scripts/baseline-manifest.mjs --check   exit 1 if any hashed file changed since the freeze
// The manifest is root-owned. The baseline SHA is the commit that contains it; a run on
// any other tree, or a dirty one, is not the baseline.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/internal/baseline/BASELINE-MANIFEST.json');
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Every file whose change would change what the baseline measures.
const HASHED = [
  'docs/internal/lanes/measurement-design/ASSIGNMENT.md',
  'docs/internal/lanes/measurement-design/REVIEW.md',
  'plainhand/evaluation/corpus.mjs',
  'plainhand/evaluation/corpus-holdout.mjs',
  'plainhand/evaluation/corpus-holdout-2.mjs',
  'plainhand/evaluation/roles.mjs',
  'plainhand/evaluation/score.mjs',
  'plainhand/evaluation/agent.mjs',
  'plainhand/evaluation/runner.mjs',
  'plainhand/evaluation/claims.mjs',
  'plainhand/evaluation/judge.mjs',
  'plainhand/evaluation/pdf-evidence.mjs',
  'plainhand/evaluation/portals.mjs',
  'plainhand/evaluation/sandbox.mjs',
  'plainhand/evaluation/browser.mjs',
  'plainhand/benchmarks/profile-bench.mjs',
  'plainhand/agents.mjs',
  'plainhand/workflow.mjs',
  'plainhand/claim-calibration.mjs',
  'plainhand/store.mjs',
  'plainhand/usage.mjs',
  'scripts/rescore.mjs',
  'benchmarks/benchmark-eval.mjs',
  'benchmarks/benchmark-judge.mjs',
];

async function build() {
  const files = {};
  for (const file of HASHED) files[file] = sha256(await readFile(path.join(root, file)));
  const { scenarios } = await import('../plainhand/evaluation/corpus.mjs');
  const { profileScenarios } = await import('../plainhand/evaluation/runner.mjs');
  const { RUBRIC, RUBRIC_INSTRUCTION } = await import('../plainhand/evaluation/judge.mjs');
  const { CLAIMS_INSTRUCTION } = await import('../plainhand/evaluation/claims.mjs');
  const { SCORER_VERSION } = await import('../plainhand/evaluation/score.mjs');
  const all = [...profileScenarios, ...scenarios];
  const ids = all.map(s => s.id);
  const pairs = ['fin', 'analyst', 'sci'].flatMap(pair => ['built', 'seeded', 'minimal'].map(mode => `profile-effect-${pair}-${mode}`));
  const holdout = scenarios.filter(s => s.holdout).map(s => s.id);
  const seen = scenarios.filter(s => s.holdout && s.holdoutSet !== 2).map(s => s.id);
  const fresh = scenarios.filter(s => s.holdout && s.holdoutSet === 2).map(s => s.id);
  return {
    version: 3,
    scorerVersion: SCORER_VERSION,
    previous: [{ version: 1, commit: '00ce1bfbffa4ec0edec6045f0caf3b0b5333384f', note: 'v1 live baseline; re-scored offline with scripts/rescore.mjs and reported beside later versions, never mixed.' }, { version: 2, commit: '5e4a000', note: 'v2 freeze; never run live.' }],
    note: 'Frozen baseline manifest. The baseline SHA is the commit containing this file. Any change to a hashed file invalidates the baseline and requires a re-freeze.',
    design: { commit: 'b6c0b562732b45455e4709e5e390fe00d2a4874d', review: 'docs/internal/lanes/measurement-design/REVIEW.md' },
    files,
    scenarios: {
      count: ids.length,
      idsSha256: sha256(ids.join('\n')),
      ids,
      expectedFailures: all.filter(s => s.expectFail).map(s => s.id),
      heldOut: holdout,
      heldOutSet2: fresh,
      seenHeldOut: { ids: seen, reason: 'Run live against v1 on 2026-11-15; seen since. A v2 comparison on them measures product change, not generalisation; fresh held-out fixtures are needed for that.' },
      seenControls: { ids: ['fin-mismatch', 'journey-sci'], reason: 'Run by the scorer lane before the freeze; kept as controlled regression checks, not held out. Unseen versions: holdout-mismatch, holdout-journey-stem.' },
      wiringOnlyInControlled: holdout,
    },
    controlledGate: { command: 'node benchmarks/benchmark-eval.mjs --concurrency 2', expect: '0 unexpected failures; expected-failure set exactly scenarios.expectedFailures', tier: 'fixture' },
    live: {
      provider: 'codex', cli: 'codex-cli 0.167.1', ownerDecision: '2026-11-15',
      paired: { scenarios: pairs, repeat: 3, command: `node benchmarks/benchmark-eval.mjs --provider codex --scenarios ${pairs.join(',')} --repeat 3 --concurrency 1 --agent-timeout 900` },
      smoke: { scenarios: [...fresh, 'journey-sci'], repeat: 1, note: 'Unseen held-out set 2 plus journey-sci. Set 1 is seen; run it only to compare with the v1 baseline (rescore).', command: `node benchmarks/benchmark-eval.mjs --provider codex --scenarios ${[...fresh, 'journey-sci'].join(',')} --concurrency 1 --agent-timeout 900` },
      pilot: 'Pre-freeze: profile-effect-fin-built took 13 calls, 331k input and 3.7k output tokens, 163 s (EVIDENCE.codex_pilot).',
    },
    judge: {
      provider: 'claude', cli: 'claude 2.1.325 (Claude Code)', familyDiffersFromProviderUnderTest: true,
      actualModel: 'recorded at run time from the CLI result; null means familyProof catalog-only',
      samples: { claims: 1, rubric: 3 },
      promptSha256: { CLAIMS_INSTRUCTION: sha256(CLAIMS_INSTRUCTION), RUBRIC_INSTRUCTION: sha256(RUBRIC_INSTRUCTION), RUBRIC: sha256(JSON.stringify(RUBRIC)) },
      calibration: 'uncalibrated: no human ratings exist',
    },
    budgets: { modelCalls: 900, wallClockMinutes: 480, callTimeoutSeconds: 900, onCap: 'blocked: budget, not a pass', onQuota: 'blocked: provider-quota; partial evidence kept; no aggregate reported' },
    thresholds: { existing: 'unchanged: factCoverage >= 0.66, leadShare >= 0.67, Apply >= 4, Skip <= maxScore (default 3.9), zero absent claims/unsupported numbers/banned words, review/calibration and first-person gates', v3: 'Lead share no longer gates: kept experience roles must follow the run roleOrder (recent: newest first by heading dates; match: the required-fact role first, rest newest first), and a role holding a required fact may not be dropped. Within-role curation is a diagnostic.',
      v2: 'An honest zero-match Skip (Skip band, gaps naming posting requirements) passes evidenceValid; PDF line matching picks the occurrence consistent with order so far. Reordered-line and Apply-without-evidence controls still fail.',
      new: 'Investigate within job.scoreBand with the below-4 prepare guard; recent-role jobs keep their retainFactIds', proposed: 'design §8.8, not approved; diagnostic only' },
    usage: 'Every live run records calls, input/output/cached/reasoning tokens, promptChars (Plainhand prompt size) and wall time per scenario. Codex exec --json states no model id, so actualModel is null with a reason.',
  };
}

const manifest = await build();
if (process.argv.includes('--write')) {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, out)}: ${manifest.scenarios.count} scenarios, ${Object.keys(manifest.files).length} hashed files.`);
} else if (process.argv.includes('--check')) {
  const frozen = JSON.parse(await readFile(out, 'utf8'));
  const changed = Object.keys(frozen.files).filter(file => frozen.files[file] !== manifest.files[file]);
  const idsChanged = frozen.scenarios.idsSha256 !== manifest.scenarios.idsSha256;
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  if (changed.length || idsChanged || dirty) {
    console.error(`Baseline invalid: ${changed.length ? 'changed ' + changed.join(', ') : ''}${idsChanged ? ' scenario ids changed' : ''}${dirty ? ' working tree dirty' : ''}`);
    process.exit(1);
  }
  console.log('Baseline manifest matches the tree; working tree clean.');
} else {
  console.log('Usage: node scripts/baseline-manifest.mjs --write | --check');
}
