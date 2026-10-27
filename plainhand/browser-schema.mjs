import { createHash } from 'node:crypto';

// Exact public query documents observed on jobs.ashbyhq.com, 2026-10-18.
// An operation name alone is not permission: a different document must be
// reviewed and pinned before it can pass. Variables are bound to the live URL.
const queries = new Map([
  ['ApiJobPosting', 'e1e9e81eb52affddbe9e9dd6ed68ccbfe653e59d8a7402f237ac94094c89cff1'],
  ['ApiOrganizationFromHostedJobsPageName', '90e5a406dbfe8b7f4529188fbbadd4a9f3e85a2c81b5445eab28115f886257a2'],
  ['ApiAutocompleteGeoLocation', 'bd60a76c77bdb2a361ed0d6108c284db0ac195d06ea238d6a5a0fc419bf0cfec'],
]);
export function ashbySchemaMetadata(operationName, queryHash, variables, frameUrl) {
  try {
    const frame = new URL(frameUrl), parts = frame.pathname.split('/').filter(Boolean);
    if (frame.origin !== 'https://jobs.ashbyhq.com' || parts.length < 2 || !/^[a-z0-9_-]+$/i.test(parts[0]) || !/^[a-f0-9-]{36}$/i.test(parts[1])) return false;
    if (!variables || typeof variables !== 'object' || Array.isArray(variables) || queryHash !== queries.get(operationName) || !queries.has(operationName)) return false;
    if (operationName === 'ApiAutocompleteGeoLocation') return Object.keys(variables).sort().join(',') === 'locationTypes,text' && typeof variables.text === 'string' && variables.text.length <= 200 && Array.isArray(variables.locationTypes) && variables.locationTypes.join(',') === 'City,Country';
    if (variables.organizationHostedJobsPageName !== decodeURIComponent(parts[0])) return false;
    if (operationName === 'ApiJobPosting') return Object.keys(variables).sort().join(',') === 'jobPostingId,organizationHostedJobsPageName' && variables.jobPostingId === parts[1];
    if (operationName === 'ApiOrganizationFromHostedJobsPageName') return Object.keys(variables).join(',') === 'organizationHostedJobsPageName' || Object.keys(variables).sort().join(',') === 'organizationHostedJobsPageName,searchContext' && variables.searchContext === 'JobPosting';
    return false;
  } catch { return false; }
}
export function ashbySchemaRead(request) {
  if (request.method() !== 'POST' || !['fetch', 'xhr'].includes(request.resourceType())) return false;
  try {
    const url = new URL(request.url()), body = request.postDataJSON();
    if (url.origin !== 'https://jobs.ashbyhq.com' || url.pathname !== '/api/non-user-graphql' || url.username || url.password || url.hash) return false;
    const keys = [...url.searchParams.keys()];
    if (keys.length && (keys.length !== 1 || keys[0] !== 'op' || url.searchParams.get('op') !== body.operationName)) return false;
    if (Object.keys(body).sort().join(',') !== 'operationName,query,variables' || typeof body.query !== 'string' || body.query.length > 100000) return false;
    return ashbySchemaMetadata(body.operationName, createHash('sha256').update(body.query).digest('hex'), body.variables, request.frame().url());
  } catch { return false; }
}
