#!/usr/bin/env node
// End-to-end Plainhand evaluation: build a profile, draft a resume, fill a real
// (owned) portal, and submit it to a local sandbox. Controlled by default;
// add --provider claude|codex to measure real model quality.
//
//   node benchmarks/benchmark-eval.mjs
//   node benchmarks/benchmark-eval.mjs --provider claude --concurrency 2
//   node benchmarks/benchmark-eval.mjs --scenarios mech-lever,swe-submit
//   node benchmarks/benchmark-eval.mjs --baseline output/evaluation-controlled-...
import { runEvaluation, profileScenarios, exitCodeFor } from '../plainhand/evaluation/runner.mjs';
import { scenarios } from '../plainhand/evaluation/corpus.mjs';

if (process.argv.includes('--list')) {
  for (const scenario of [...profileScenarios, ...scenarios]) console.log(`${scenario.id.padEnd(24)} ${scenario.family.padEnd(12)} ${scenario.persona}${scenario.job ? ' / ' + scenario.job : ''}${scenario.portal ? ' / ' + scenario.portal : ''}`);
  process.exit(0);
}

if (process.argv.includes('--help')) {
  console.log(`Plainhand evaluation harness

  node benchmarks/benchmark-eval.mjs [options]

  --list                Print scenario ids and exit.
  --provider <id>       Use a real installed provider (claude, codex, ...). Opt-in.
  --scenarios <ids>     Comma-separated scenario ids (see plainhand/evaluation/corpus.mjs).
  --profiles <ids>      Limit profile-building scenarios to these profile-bench personas.
  --concurrency <n>     Parallel scenarios (default 2 controlled, 1 live). Each run uses its own workspace.
  --agent-timeout <s>   Per-model-call timeout (default 180 controlled, 600 live).
  --repeat <n>          Run every selected scenario n times to measure variance.
  --out <dir>           Evidence directory (default output/evaluation-<tier>-<timestamp>).
  --baseline <path>     Compare against an earlier results.json or evidence directory.
  --retain              Keep each scenario's temporary workspace for inspection.
`);
  process.exit(0);
}

try {
  const { report } = await runEvaluation(process.argv.slice(2));
  process.exitCode = exitCodeFor(report.summary);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
