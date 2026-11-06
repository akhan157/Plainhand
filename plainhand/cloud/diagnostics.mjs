// Allowlist only: never pass Error objects, URL, headers, IP, user, stack or body.
export function scrubDiagnostics(input = {}) {
  return {
    errorId: /^[0-9a-f-]{36}$/.test(input.errorId) ? input.errorId : 'invalid',
    status: [400, 401, 403, 404, 429, 500, 503].includes(input.status) ? input.status : 500,
    method: ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'].includes(input.method) ? input.method : 'OTHER',
  };
}
export function reportServerError(input, log = console.error) { log('plainhand-cloud', scrubDiagnostics(input)); }
