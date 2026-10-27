import test from 'node:test';
import assert from 'node:assert/strict';
import { runScan } from './plainhand/scan-runner.mjs';

const job = (company, title, location = 'Remote') => ({ company, title, location, url: `https://jobs.lever.co/${company.toLowerCase().replace(/\W+/g, '-')}/${encodeURIComponent(title)}` });

test('campaign terms, locations and exclusions filter the scan', async () => {
  const found = [
    job('Acme', 'Graduate Mechanical Engineer', 'Boston'),
    job('Acme', 'Senior Sales Manager', 'Boston'),
    job('Beta', 'Graduate Mechanical Engineer', 'London'),
    job('Blocked Co', 'Graduate Mechanical Engineer', 'Boston'),
  ];
  const result = await runScan({
    sources: [{ name: 'Acme', url: 'https://jobs.lever.co/acme' }],
    jobs: [],
    campaign: { name: 'grad-mech', terms: ['Mechanical Engineer'], locations: ['Boston'], excludeCompanies: ['Blocked Co'] },
    scan: async () => found,
  });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].company, 'Acme');
  assert.equal(result.ineligible.length, 3);
  assert.equal(result.duplicates.length, 0);
  assert.equal(result.sources[0].found, 4);
});

test('existing roles and cross-source duplicates are skipped', async () => {
  const shared = job('Acme', 'Graduate Mechanical Engineer');
  const result = await runScan({
    sources: [{ name: 'One', url: 'https://jobs.lever.co/one' }, { name: 'Two', url: 'https://jobs.lever.co/two' }],
    jobs: [{ company: 'Existing', title: 'Graduate Mechanical Engineer', url: 'https://jobs.lever.co/existing/1' }],
    campaign: { terms: ['Engineer'] },
    scan: async source => source.name === 'One' ? [shared] : [shared, job('Existing', 'Graduate Mechanical Engineer')],
  });
  assert.equal(result.added.length, 1, 'first source adds it once');
  assert.equal(result.duplicates.length, 2, 'same URL and same company+role are duplicates');
});

test('liveness removes closed postings when it is enabled', async () => {
  const result = await runScan({
    sources: [{ name: 'One', url: 'https://jobs.lever.co/one' }],
    jobs: [],
    campaign: { terms: ['Engineer'] },
    scan: async () => [job('Acme', 'Graduate Engineer'), job('Beta', 'Graduate Engineer')],
    checkLiveness: true,
    verify: async target => ({ state: target.company === 'Beta' ? 'closed' : 'active' }),
  });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].company, 'Acme');
  assert.equal(result.expired.length, 1);
  assert.equal(result.expired[0].company, 'Beta');
});

test('one failing source is reported without cancelling the others', async () => {
  const result = await runScan({
    sources: [{ name: 'Broken', url: 'https://jobs.lever.co/broken' }, { name: 'Good', url: 'https://jobs.lever.co/good' }],
    jobs: [],
    campaign: { terms: ['Engineer'] },
    scan: async source => { if (source.name === 'Broken') throw new Error('The job source returned HTTP 503. Retry later.'); return [job('Acme', 'Graduate Engineer')]; },
  });
  assert.equal(result.added.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /503/);
  assert.equal(result.sources.find(source => source.source === 'Broken').error, 'The job source returned HTTP 503. Retry later.');
});

test('scan history remembers a surfaced role so the next scan treats it as a duplicate', async () => {
  const { mergeScanHistory } = await import('./plainhand/scan-runner.mjs');
  const first = [{ company: 'Acme', title: 'Graduate Engineer', url: 'https://jobs.lever.co/acme/1' }];
  const history = mergeScanHistory([], first, '2026-10-21T10:00:00.000Z');
  assert.equal(history.length, 1);
  assert.equal(history[0].seenAt, '2026-10-21T10:00:00.000Z');

  const second = await runScan({ sources: [{ name: 'Acme', url: 'https://jobs.lever.co/acme' }], jobs: history, campaign: { terms: ['Engineer'] }, scan: async () => first });
  assert.equal(second.added.length, 0, 'a role seen in an earlier scan is not re-reported');
  assert.equal(second.duplicates.length, 1);

  const merged = mergeScanHistory(history, first, '2026-10-22T10:00:00.000Z');
  assert.equal(merged.length, 1, 're-seeing the same role does not grow history');
});
