const fs = require('node:fs/promises');
const MAX_IMPORT = 12 * 1024 * 1024;
async function request({ origin, token }, route, data) {
  const response = await fetch(`${origin}/api/${route}`, {
    headers: { 'x-plainhand-token': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Workspace transfer failed.');
  return result;
}
async function exportFile(connection, filename) {
  const data = await request(connection, 'export');
  await fs.writeFile(filename, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  return filename;
}
async function readImport(filename) {
  const handle = await fs.open(filename, 'r');
  try {
    if ((await handle.stat()).size > MAX_IMPORT) throw new Error('Choose a workspace export smaller than 12 MB.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function importFile(connection, filename, confirm) {
  const data = await readImport(filename);
  const summary = await request(connection, 'import/preview', { data });
  if (!await confirm(summary)) return null;
  return request(connection, 'import', { data, confirm: true });
}
module.exports = { request, exportFile, readImport, importFile, MAX_IMPORT };
