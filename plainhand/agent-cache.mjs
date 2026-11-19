// A content-hash cache for provider results whose input is fully determined by the
// workspace. Re-evaluating an unchanged job against an unchanged profile sends the
// same instruction and the same data, so the stored evaluation is reused and the
// provider call is skipped. The key is the provider, the instruction text and whatever
// data the caller uses to identify the call; the evaluate site passes the profile
// context hash and the sanitized posting, so any profile, source or job change misses.
// Failures are never stored, and the version prefix retires entries when the shape
// changes or when a stored result's meaning changes (a policy change needs a bump).
import { digest } from './store.mjs';

export const AGENT_CACHE_VERSION = 1;

export class AgentCache {
  constructor(workspace) { this.workspace = workspace; }
  key({ provider, instruction, data }) {
    // JSON stringify order is the call's own construction order, so the same call
    // always hashes the same way; the digest is over a plain object of scalars.
    return digest({ version: AGENT_CACHE_VERSION, provider, instruction, data });
  }
  file(key) { return `data/plainhand/agent-cache/${key}.json`; }
  async get(key) {
    const raw = await this.workspace.read(this.file(key));
    if (!raw) return null;
    try {
      const record = JSON.parse(raw);
      return record.version === AGENT_CACHE_VERSION && record.key === key ? record.result : null;
    } catch { return null; }
  }
  async put(key, { provider, purpose, result }) {
    await this.workspace.write(this.file(key), JSON.stringify({
      version: AGENT_CACHE_VERSION, key, provider, purpose,
      createdAt: new Date().toISOString(), result,
    }));
  }
}
