import test from 'node:test';
import assert from 'node:assert/strict';
import { headingOnlyRow } from '../plainhand/workflow.mjs';

// The legacy typed-preparation benchmark accepts the same heading-only rows the product does.
test('typed preparation accepts a heading-only education row and still rejects a blank experience row', async () => {
  const src = await import('node:fs/promises').then(fs => fs.readFile(new URL('../plainhand/benchmarks/typed-preparation.mjs', import.meta.url), 'utf8'));
  assert.match(src, /if \(!headingOnlyRow\(entry\)\) requireText\(entry\.text/);
  assert.equal(headingOnlyRow({ section: 'Education', heading: { org: 'Example University', title: 'B.S. Biology', location: '', dates: '2014 to 2018' }, text: '' }), true);
  assert.equal(headingOnlyRow({ section: 'Experience', heading: { org: 'Example Co', title: 'Analyst', location: '', dates: '2020 to 2024' }, text: '' }), false);
});
