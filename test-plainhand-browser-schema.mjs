import test from 'node:test';
import assert from 'node:assert/strict';
import { ashbySchemaRead, ashbySchemaMetadata } from './plainhand/browser-schema.mjs';
const job = '1fc309c8-da20-4ff2-84c7-8b863ece2b0a';
const frameUrl = `https://jobs.ashbyhq.com/notion/${job}/application`;
const hash = 'e1e9e81eb52affddbe9e9dd6ed68ccbfe653e59d8a7402f237ac94094c89cff1';
const variables = { organizationHostedJobsPageName: 'notion', jobPostingId: job };

test('pinned schema metadata binds public reads to the current board and posting', () => {
  assert.equal(ashbySchemaMetadata('ApiJobPosting', hash, variables, frameUrl), true);
  assert.equal(ashbySchemaMetadata('ApiJobPosting', hash, { ...variables, jobPostingId: '00000000-0000-0000-0000-000000000000' }, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApiJobPosting', hash, { ...variables, organizationHostedJobsPageName: 'other' }, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApiJobPosting', hash, { ...variables, applicationForm: {} }, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApiJobPosting', hash, variables, frameUrl.replace('jobs.ashbyhq.com', 'untrusted.example')), false);
  assert.equal(ashbySchemaMetadata('ApiJobPosting', 'changed-document', variables, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApplicationFormSubmit', hash, variables, frameUrl), false);
});

test('organization schema reads accept only the pinned document and JobPosting context', () => {
  const hash = '90e5a406dbfe8b7f4529188fbbadd4a9f3e85a2c81b5445eab28115f886257a2';
  const vars = { organizationHostedJobsPageName: 'notion', searchContext: 'JobPosting' };
  assert.equal(ashbySchemaMetadata('ApiOrganizationFromHostedJobsPageName', hash, vars, frameUrl), true);
  assert.equal(ashbySchemaMetadata('ApiOrganizationFromHostedJobsPageName', hash, { ...vars, searchContext: 'Candidate' }, frameUrl), false);
});

test('operation names do not authorize changed queries, batches, mutations or alternate endpoints', () => {
  const request = body => ({ url: () => 'https://jobs.ashbyhq.com/api/non-user-graphql', method: () => 'POST', resourceType: () => 'fetch', frame: () => ({ url: () => frameUrl }), postDataJSON: () => body });
  for (const query of ['query ApiJobPosting { candidate { email } }', 'mutation ApiJobPosting { applicationFormSubmit { id } }', 'query ApiJobPosting { jobPosting { id } }']) assert.equal(ashbySchemaRead(request({ operationName: 'ApiJobPosting', variables, query })), false);
  assert.equal(ashbySchemaRead(request([{ operationName: 'ApiJobPosting', variables, query: 'mutation { submit }' }])), false);
  const altered = request({ operationName: 'ApiJobPosting', variables, query: 'query { jobPosting { id } }' });
  altered.url = () => 'https://jobs.ashbyhq.com/api/non-user-graphql?op=submit';
  assert.equal(ashbySchemaRead(altered), false);
});

test('pinned location autocomplete stays read-only, bounded and limited to the observed location types', () => {
  const hash = 'bd60a76c77bdb2a361ed0d6108c284db0ac195d06ea238d6a5a0fc419bf0cfec';
  const variables = { text: 'Boston', locationTypes: ['City', 'Country'] };
  assert.equal(ashbySchemaMetadata('ApiAutocompleteGeoLocation', hash, variables, frameUrl), true);
  assert.equal(ashbySchemaMetadata('ApiAutocompleteGeoLocation', hash, { ...variables, text: 'x'.repeat(201) }, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApiAutocompleteGeoLocation', hash, { ...variables, candidateId: 'unexpected' }, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApiAutocompleteGeoLocation', hash, { ...variables, locationTypes: ['Candidate'] }, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApiAutocompleteGeoLocation', 'changed', variables, frameUrl), false);
  assert.equal(ashbySchemaMetadata('ApiOrganizationFromHostedJobsPageName', '90e5a406dbfe8b7f4529188fbbadd4a9f3e85a2c81b5445eab28115f886257a2', { organizationHostedJobsPageName: 'notion' }, frameUrl), true);
});
