// Written exclusively by the authenticated MCP check_connection tool, never by the UI.
export const CONNECTION_CHECK_PATH = 'data/plainhand/connection-check.json';
export async function readConnectionCheck(workspace) {
  const text = await workspace.read(CONNECTION_CHECK_PATH);
  if (!text || text.length > 4096) return null;
  let marker;
  try { marker = JSON.parse(text); } catch { return null; }
  if (!marker || typeof marker.checkedAt !== 'string' || !Number.isFinite(Date.parse(marker.checkedAt)) || typeof marker.read !== 'boolean' || typeof marker.write !== 'boolean') return null;
  return { checkedAt: marker.checkedAt, read: marker.read, write: marker.write,
    provider: typeof marker.provider === 'string' ? marker.provider.slice(0, 100) : null,
    clientId: typeof marker.clientId === 'string' ? marker.clientId.slice(0, 500) : null };
}
