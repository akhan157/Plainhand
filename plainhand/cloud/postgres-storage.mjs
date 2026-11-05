// Hosted workspace storage: one row per file per candidate (plainhand/cloud/schema.sql).
// Same interface as FileStorage/MemoryStorage in plainhand/storage.mjs, plus exclusive(),
// which Workspace.mutate uses so two serverless instances never interleave one
// candidate's read-modify-write: the whole mutation runs in one transaction holding a
// per-candidate advisory lock.
import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import { normalizePath, StorageError } from '../storage.mjs';

export const DEFAULT_QUOTA_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Supabase's transaction pooler (port 6543) does not support prepared statements.
export function connect(url, options = {}) {
  if (!url) throw new Error('DATABASE_URL is not set.');
  return postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {}, ...options });
}

export class QuotaError extends StorageError {}

export class PostgresStorage {
  constructor(sql, userId, { quotaBytes = DEFAULT_QUOTA_BYTES } = {}) {
    if (!UUID.test(String(userId))) throw new StorageError('Invalid account.');
    this.sql = sql; this.userId = String(userId).toLowerCase(); this.quotaBytes = quotaBytes; this.local = false;
    this.scope = new AsyncLocalStorage();
  }
  // Inside exclusive(), every query in that async call tree uses the locked transaction.
  get db() { return this.scope.getStore() || this.sql; }
  async resolve() { throw new StorageError('This workspace has no local folder.'); }
  async read(relative) {
    const [row] = await this.db`select content from plainhand.workspace_files where user_id = ${this.userId} and path = ${normalizePath(relative)}`;
    return row ? Buffer.from(row.content) : null;
  }
  async write(relative, data) {
    const file = normalizePath(relative), content = Buffer.from(data);
    const [{ used }] = await this.db`select coalesce(sum(octet_length(content)), 0)::bigint as used from plainhand.workspace_files where user_id = ${this.userId} and path <> ${file}`;
    if (Number(used) + content.length > this.quotaBytes) throw new QuotaError('Your Plainhand storage is full. Remove old roles or packets, or export your workspace.');
    await this.db`insert into plainhand.workspace_files (user_id, path, content, updated_at) values (${this.userId}, ${file}, ${content}, now())
      on conflict (user_id, path) do update set content = excluded.content, updated_at = now()`;
  }
  async list(directory) {
    const prefix = normalizePath(directory) + '/';
    const rows = await this.db`select substr(path, ${prefix.length + 1}) as name from plainhand.workspace_files
      where user_id = ${this.userId} and starts_with(path, ${prefix}) and strpos(substr(path, ${prefix.length + 1}), '/') = 0 order by 1`;
    return rows.map(row => row.name);
  }
  async remove(relative) { await this.db`delete from plainhand.workspace_files where user_id = ${this.userId} and path = ${normalizePath(relative)}`; }
  async usage() {
    const [{ used, files }] = await this.db`select coalesce(sum(octet_length(content)), 0)::bigint as used, count(*)::int as files from plainhand.workspace_files where user_id = ${this.userId}`;
    return { bytes: Number(used), files, quotaBytes: this.quotaBytes };
  }
  async exclusive(fn) {
    if (this.scope.getStore()) return fn(); // already inside this candidate's transaction
    return this.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'plainhand:' + this.userId}, 0))`;
      return this.scope.run(tx, fn);
    });
  }
}
