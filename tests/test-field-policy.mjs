import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitiveLabel } from '../plainhand/field-policy.mjs';

test('questions reserved for the candidate are sensitive, in any field', () => {
  for (const label of [
    'Are you authorized to work in the United States?',
    'Will you now or in the future require sponsorship?',
    'Expected compensation',
    'Gender',
    'Veteran status',
    // Hourly, trade and healthcare portals word these their own way.
    'Are you at least 18 years of age?',
    'Date of birth',
    'Have you ever been convicted of a felony?',
    'Do you consent to a background check?',
    'Desired pay rate',
    'Expected hourly rate',
    'Minimum wage you would accept',
    'Social Security Number',
    'SSN',
  ]) assert.equal(isSensitiveLabel(label), true, label);
});

test('ordinary application questions are not sensitive', () => {
  for (const label of [
    'Full name',
    'Most recent employer',
    'Years of experience in this field',
    'List your professional licenses or certifications.',
    'Which shift are you available to work?',
    'Describe a relevant accomplishment.',
    'Manage a team? Tell us how.',
    'Average daily patient load',
    'Percentage of travel you can accept',
  ]) assert.equal(isSensitiveLabel(label), false, label);
});
