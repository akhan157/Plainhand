#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeOutcomes,
  getCapabilityReport,
  parseMachineSummary,
  parseTrackerRows,
} from './outcome-intelligence.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-outcome-intelligence-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
try {
  const trackerPath = join(root, 'data', 'applications.md');
  const reportPath = join(root, 'reports', '103-acme.md');
  const tracker = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 101 | 2026-02-01 | Low Co | Engineer | 2.0/5 | Rejected | ❌ | ❌ | observed rejection |
| 102 | 2026-02-02 | Mid Co | Engineer | 3.2/5 | Interview | ❌ | ❌ | observed interview |
| 103 | 2026-02-03 | Acme | AI Engineer | 4.2/5 | Applied | ✅ | [103](reports/103-acme.md) | report says offer |
| 104 | 2026-01-01 | Quiet Co | Engineer | 4.8/5 | Applied | ❌ | ❌ | no reply |
| 105 | 2026-02-04 | Pending Co | Engineer | 3.7/5 | Evaluated | ❌ | ❌ | not yet applied |
| 106 | 2026-02-05 | Filtered Co | Engineer | 2.2/5 | Discarded | ❌ | ❌ | self-filtered |
`;
  writeFileSync(trackerPath, tracker);
  writeFileSync(reportPath, `# Acme report

## Machine Summary

\`\`\`yaml
company: Acme
role: AI Engineer
outcome: offer
archetype: Applied AI
narrative_variant: systems narrative
resume_framing: delivery proof
follow_up_channel: recruiter email
portal_configuration: greenhouse
\`\`\`
`);
  const before = readFileSync(trackerPath, 'utf8');

  const rows = parseTrackerRows(tracker);
  assert.equal(rows.length, 6);
  assert.equal(rows[2].score, 4.2);
  assert.equal(rows[2].normalizedStatus, 'applied');
  assert.equal(rows[5].normalizedStatus, 'discarded');

  const summary = parseMachineSummary(readFileSync(reportPath, 'utf8'));
  assert.equal(summary.outcome, 'offer');
  assert.equal(summary.narrative_variant, 'systems narrative');
  assert.equal(parseMachineSummary('not a machine summary'), null);

  const result = analyzeOutcomes(root, {
    asOf: '2026-02-15',
    minimumObservedPerBand: 1,
    minimumObservedForRecommendation: 5,
    minimumPositiveForRecommendation: 1,
  });

  assert.equal(result.phase, 5);
  assert.equal(result.readOnly, true);
  assert.equal(result.counts.trackerRows, 6);
  assert.equal(result.counts.scoredRows, 6);
  assert.equal(result.counts.excludedRows, 1);
  assert.equal(result.counts.observedOutcomes, 3);
  assert.equal(result.counts.assumedOutcomes, 1);
  assert.deepEqual(result.evidence.observed.sort((a, b) => a - b), [101, 102, 103]);
  assert.deepEqual(result.evidence.assumed, [104]);
  assert.equal(result.records.find((row) => row.num === 103).outcome, 'offer');
  assert.equal(result.records.find((row) => row.num === 103).outcomeSource, 'report');
  assert.equal(result.records.find((row) => row.num === 104).outcome, 'silence');
  assert.equal(result.records.find((row) => row.num === 104).evidence, 'assumed');
  // Evaluated means never applied: not a pending application, and kept out of band metrics.
  assert.equal(result.records.find((row) => row.num === 105).outcome, 'not-applied');

  const highBand = result.scoreBands.find((band) => band.key === '4.0-4.4');
  assert.equal(highBand.outcomes.offer, 1);
  assert.equal(highBand.observed, 1);
  assert.equal(highBand.assumed, 0);
  assert.equal(result.dimensions.archetype['Applied AI'].observed, 1);
  assert.equal(result.dimensions.resumeFraming['delivery proof'].observed, 1);
  assert.equal(result.overall.outcomes.rejection, 1);
  assert.equal(result.overall.outcomes.interview, 1);
  assert.equal(result.overall.outcomes.offer, 1);
  assert.equal(result.overall.outcomes.silence, 1);
  assert.ok(result.warnings.some((warning) => warning.code === 'assumed-silence'));
  assert.ok(result.warnings.some((warning) => warning.code === 'insufficient-observed-outcomes'));
  assert.equal(readFileSync(trackerPath, 'utf8'), before);

  const disabled = getCapabilityReport();
  assert.equal(disabled.phase, 5);
  assert.equal(disabled.readOnly, true);
  assert.equal(disabled.phase6.enabled, false);
  assert.equal(disabled.phase6.hosted, false);
  assert.equal(disabled.phase6.ecosystem, false);

  assert.throws(() => analyzeOutcomes(), /explicit root path/);
  const emptyRoot = mkdtempSync(join(tmpdir(), 'career-ops-outcome-empty-'));
  try {
    const empty = analyzeOutcomes(emptyRoot);
    assert.equal(empty.counts.trackerRows, 0);
    assert.ok(empty.warnings.some((warning) => warning.code === 'missing-tracker'));
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }

  // Band gaps and intent-only rows.
  const gapRoot = mkdtempSync(join(tmpdir(), 'career-ops-outcome-gaps-'));
  try {
    mkdirSync(join(gapRoot, 'data'), { recursive: true });
    writeFileSync(join(gapRoot, 'data', 'applications.md'), `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-01-01 | A | Engineer | 4.45/5 | Interview | ❌ | ❌ | between bands |
| 2 | 2026-01-01 | B | Engineer | 3.45/5 | Rejected | ❌ | ❌ | between bands |
| 3 | 2026-01-01 | C | Engineer | 2.95/5 | Rejected | ❌ | ❌ | between bands |
| 4 | 2025-06-01 | D | Engineer | 4.1/5 | Apply | ❌ | ❌ | intended, never sent |
`);
    const gaps = analyzeOutcomes(gapRoot, { asOf: '2026-03-01', minimumObservedPerBand: 1 });
    const count = key => gaps.scoreBands.find(band => band.key === key).observed;
    assert.equal(count('4.0-4.4'), 1, 'a 4.45 score lands in 4.0-4.4 instead of no band');
    assert.equal(count('3.0-3.4'), 1, 'a 3.45 score lands in 3.0-3.4');
    assert.equal(count('0.0-2.9'), 1, 'a 2.95 score lands in 0.0-2.9');
    assert.equal(gaps.records.find(row => row.num === 4).outcome, 'not-applied', 'Apply is an intention, never assumed silence');
  } finally {
    rmSync(gapRoot, { recursive: true, force: true });
  }

  console.log('outcome intelligence: passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
