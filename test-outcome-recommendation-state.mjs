#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OutcomeRecommendationLedger,
  approveRecommendation,
  buildRecommendation,
  createRecommendation,
  createRecommendationLedgerState,
  deferRecommendation,
  fingerprintAnalysisSnapshot,
  fingerprintSourceBasis,
  recommendationId,
  rejectRecommendation,
  replayRecommendationJournal,
} from './outcome-recommendation-state.mjs';

const root = mkdtempSync(join(tmpdir(), 'outcome-recommendation-'));
const sourceFiles = {
  tracker: join(root, 'data', 'applications.md'),
  report: join(root, 'reports', 'role.md'),
  config: join(root, 'config', 'profile.yml'),
};
for (const [key, path] of Object.entries(sourceFiles)) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${key}-source-before`, { encoding: 'utf8' });
}
const sourceBefore = Object.fromEntries(Object.entries(sourceFiles).map(([key, path]) => [key, readFileSync(path, 'utf8')]));
const analysisSnapshot = {
  phase: 5,
  asOf: '2026-08-11T10:00:00Z',
  counts: { observedOutcomes: 8, trackerRows: 10 },
  calibration: { minimumObservedForRecommendation: 8 },
  warnings: [],
  scoreBands: [{ key: 'high', observed: 8, positive: 3 }],
};
const sourceBasis = { trackerPath: sourceFiles.tracker, trackerFingerprint: 'tracker-snapshot-1', reportFingerprint: 'reports-snapshot-1' };
const candidate = {
  type: 'review-score-calibration',
  status: 'candidate',
  direction: 'higher-score-underperforming',
  message: 'Review the lower score threshold against observed outcomes.',
  requiresApproval: true,
};
const input = { analysisSnapshot, sourceBasis, candidate };
const analysisBefore = JSON.stringify(analysisSnapshot);
const sourceBeforeJson = JSON.stringify(sourceBasis);

// Stable recommendation fingerprint and ID are derived from the analysis/source pair.
const first = buildRecommendation(input, { now: '2026-08-11T10:01:00Z' });
const second = buildRecommendation(input, { now: '2026-08-11T11:01:00Z' });
assert.equal(first.fingerprint, second.fingerprint);
assert.equal(first.id, second.id);
assert.equal(first.id, recommendationId(input));
assert.equal(first.analysisFingerprint, fingerprintAnalysisSnapshot(analysisSnapshot));
assert.equal(first.sourceFingerprint, fingerprintSourceBasis(sourceBasis));
assert.equal(JSON.stringify(analysisSnapshot), analysisBefore);
assert.equal(JSON.stringify(sourceBasis), sourceBeforeJson);

// Candidate creation and each explicit decision transition are pure state changes.
let state = createRecommendationLedgerState({ now: '2026-08-11T10:01:00Z' });
state = createRecommendation(state, input, { now: '2026-08-11T10:01:00Z' });
assert.equal(state.recommendations[first.id].status, 'candidate');
state = approveRecommendation(state, first.id, { ...input, actor: 'candidate-1' }, { now: '2026-08-11T10:02:00Z' });
assert.equal(state.recommendations[first.id].status, 'approved');
assert.equal(state.recommendations[first.id].decidedBy, 'candidate-1');
assert.throws(() => rejectRecommendation(state, first.id, { ...input, actor: 'candidate-1', reason: 'change' }), /cannot transition/);

const rejectedInput = { ...input, candidate: { ...candidate, message: 'Use the observed rejection pattern for targeting review.' } };
const rejected = buildRecommendation(rejectedInput, { now: '2026-08-11T10:03:00Z' });
let rejectedState = createRecommendation(createRecommendationLedgerState({ now: '2026-08-11T10:03:00Z' }), rejectedInput, { now: '2026-08-11T10:03:00Z' });
rejectedState = rejectRecommendation(rejectedState, rejected.id, { ...rejectedInput, actor: 'candidate-1', reason: 'Not enough strategic value.' }, { now: '2026-08-11T10:04:00Z' });
assert.equal(rejectedState.recommendations[rejected.id].status, 'rejected');
const deferredInput = { ...input, candidate: { ...candidate, message: 'Defer until another observed outcome arrives.' } };
const deferred = buildRecommendation(deferredInput, { now: '2026-08-11T10:05:00Z' });
let deferredState = createRecommendation(createRecommendationLedgerState({ now: '2026-08-11T10:05:00Z' }), deferredInput, { now: '2026-08-11T10:05:00Z' });
deferredState = deferRecommendation(deferredState, deferred.id, { ...deferredInput, actor: 'candidate-1', reason: 'Await more evidence.' }, { now: '2026-08-11T10:06:00Z' });
assert.equal(deferredState.recommendations[deferred.id].status, 'deferred');

// Stale analysis and stale source contexts cannot approve a recommendation.
const staleAnalysis = { ...analysisSnapshot, asOf: '2026-08-12T10:00:00Z' };
assert.throws(() => approveRecommendation(createRecommendation(createRecommendationLedgerState(), input), first.id, { ...input, analysisSnapshot: staleAnalysis, actor: 'candidate-1' }), /stale|fingerprint/i);
const staleSource = { ...sourceBasis, trackerFingerprint: 'tracker-snapshot-2' };
assert.throws(() => approveRecommendation(createRecommendation(createRecommendationLedgerState(), input), first.id, { ...input, sourceBasis: staleSource, actor: 'candidate-1' }), /source fingerprint/i);

// Insufficient and non-actionable candidates are protected before persistence.
const insufficientInput = {
  analysisSnapshot: { ...analysisSnapshot, counts: { observedOutcomes: 2 }, warnings: [{ code: 'insufficient-observed-outcomes', message: 'need more outcomes' }] },
  sourceBasis,
  candidate,
};
assert.throws(() => buildRecommendation(insufficientInput), /insufficient/i);
assert.throws(() => buildRecommendation({ ...input, candidate: { ...candidate, status: 'insufficient-data' } }), /insufficient/i);
assert.throws(() => buildRecommendation({ ...input, candidate: { ...candidate, requiresApproval: false } }), /actionable/i);

// Durable state/journal writes are local, append-only, and duplicate operations are idempotent.
const ledger = new OutcomeRecommendationLedger({ rootPath: root });
ledger.create(input, { now: '2026-08-11T10:10:00Z' });
ledger.create(input, { now: '2026-08-11T10:11:00Z' });
ledger.approve(first.id, { ...input, actor: 'candidate-1' }, { now: '2026-08-11T10:12:00Z' });
ledger.approve(first.id, { ...input, actor: 'candidate-1' }, { now: '2026-08-11T10:13:00Z' });
const journalLines = readFileSync(join(root, 'outcome-recommendation-journal.jsonl'), 'utf8').trim().split('\n');
assert.equal(journalLines.length, 2);
assert.equal(JSON.parse(journalLines[0]).type, 'recommendation_created');
assert.equal(JSON.parse(journalLines[1]).type, 'recommendation_approved');
assert.equal(ledger.load().recommendations[first.id].status, 'approved');
const replayJournal = ledger.journal();
const replayed = replayRecommendationJournal(replayJournal.concat(replayJournal.map((event) => ({ ...event, eventId: `replay-${event.eventId}` }))));
assert.equal(replayed.recommendations[first.id].status, 'approved');
assert.equal(replayed.recommendations[first.id].fingerprint, first.fingerprint);

for (const [key, path] of Object.entries(sourceFiles)) assert.equal(readFileSync(path, 'utf8'), sourceBefore[key], `${key} source was mutated`);
assert.equal(JSON.stringify(analysisSnapshot), analysisBefore);
assert.equal(JSON.stringify(sourceBasis), sourceBeforeJson);
console.log('outcome-recommendation-state tests passed');
