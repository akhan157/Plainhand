import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate } from './score-calibration.mjs';

const job = (index, score, status, submitted = false) => ({
  id: 'j' + index, company: 'Co ' + index, title: 'Role ' + index,
  evaluation: { score }, status, submittedAt: submitted ? '2026-10-01T00:00:00.000Z' : undefined,
});

test('no outcomes means insufficient data, not a zero-percent signal', () => {
  const report = calibrate({ jobs: [] });
  assert.equal(report.sufficientData, false);
  assert.equal(report.outcomesObserved, 0);
  assert.deepEqual(report.bands, []);
  assert.match(report.warning, /Only 0 of the 20 required outcomes/);
});

test('evaluations without outcomes are counted but never converted into rates', () => {
  const report = calibrate({ jobs: [job(1, 4.6, 'Evaluated'), job(2, 4.2, 'Apply'), job(3, 4.8, 'Applied')] });
  assert.equal(report.evaluated, 3);
  assert.equal(report.applied, 1);
  assert.equal(report.outcomesObserved, 0);
  assert.equal(report.sufficientData, false);
  const band = report.bands.find(entry => entry.band === '4.5-5.0');
  assert.equal(band.applied, 1);
  assert.equal(band.pending, 1);
  assert.equal(band.resolved, 0);
  assert.equal(band.interviewRate, null, 'a pending application is not a 0% interview rate');
});

test('bands stay provisional until the minimum outcome count is reached', () => {
  const jobs = [];
  for (let index = 0; index < 10; index++) jobs.push(job(index, 4.6, 'Interview'));
  for (let index = 10; index < 20; index++) jobs.push(job(index, 3.7, 'Rejected'));
  const report = calibrate({ jobs });
  assert.equal(report.outcomesObserved, 20);
  assert.equal(report.sufficientData, true);
  assert.equal(report.warning, null);
  const high = report.bands.find(entry => entry.band === '4.5-5.0');
  const low = report.bands.find(entry => entry.band === '3.5-3.9');
  assert.equal(high.interviewRate, 1);
  assert.equal(low.interviewRate, 0);
  assert.equal(low.rejections, 10);
});

test('a custom minimum can be lowered deliberately', () => {
  const report = calibrate({ jobs: [job(1, 4.6, 'Offer'), job(2, 4.6, 'Rejected')] }, { minimum: 2 });
  assert.equal(report.sufficientData, true);
  assert.equal(report.bands[0].offerRate, 0.5);
});
