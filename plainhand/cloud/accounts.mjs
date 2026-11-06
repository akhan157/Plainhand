// Accounts and website sessions for hosted Plainhand (docs/HOSTED-CONNECTOR-PLAN.md §2).
// An account row is the candidate (user_id = Supabase Auth user id). Deleting it cascades to
// every workspace file, session and OAuth grant. A session cookie is 32 random bytes; only
// its sha256 hash is stored, so a database leak never yields a usable cookie.
import { randomBytes, createHash } from 'node:crypto';
import { Workspace } from '../store.mjs';
import { PostgresStorage, DEFAULT_QUOTA_BYTES } from './postgres-storage.mjs';

export const SESSION_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const hashToken = value => createHash('sha256').update(String(value)).digest('hex');

function userIdOf(userId) {
  if (!UUID.test(String(userId))) throw new Error('Invalid account.');
  return String(userId).toLowerCase();
}

export function createAccounts({ sql, quotaBytes = DEFAULT_QUOTA_BYTES }) {
  return {
    async upsert({ userId, email }) {
      const id = userIdOf(userId), address = String(email || '').trim().toLowerCase();
      if (!EMAIL.test(address) || address.length > 320) throw new Error('Invalid email address.');
      const [row] = await sql`insert into plainhand.accounts (user_id, email) values (${id}, ${address})
        on conflict (user_id) do update set email = excluded.email
        returning user_id, email, created_at`;
      return { userId: row.user_id, email: row.email, createdAt: row.created_at.toISOString() };
    },
    async get(userId) {
      if (!UUID.test(String(userId))) return null;
      const [row] = await sql`select user_id, email, created_at from plainhand.accounts where user_id = ${userIdOf(userId)}`;
      return row ? { userId: row.user_id, email: row.email, createdAt: row.created_at.toISOString() } : null;
    },
    // Removes the account and, through the foreign keys, every row it owns.
    async remove(userId) {
      const rows = await sql`delete from plainhand.accounts where user_id = ${userIdOf(userId)} returning user_id`;
      return rows.length > 0;
    },
    workspaceFor(userId) {
      const id = userIdOf(userId);
      return new Workspace('cloud:' + id, { storage: new PostgresStorage(sql, id, { quotaBytes }) });
    },
  };
}

// now() is injectable so tests can check expiry without waiting 30 days.
export function createSessions({ sql, now = () => new Date(), days = SESSION_DAYS }) {
  return {
    async create(userId) {
      const value = randomBytes(32).toString('base64url');
      const expires = new Date(now().getTime() + days * 24 * 60 * 60 * 1000);
      await sql`insert into plainhand.sessions (id_hash, user_id, created_at, expires_at) values (${hashToken(value)}, ${userIdOf(userId)}, ${now()}, ${expires})`;
      return value;
    },
    async resolve(cookieValue) {
      if (typeof cookieValue !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(cookieValue)) return null;
      const [row] = await sql`select user_id from plainhand.sessions where id_hash = ${hashToken(cookieValue)} and expires_at > ${now()}`;
      return row ? { userId: row.user_id } : null;
    },
    async destroy(cookieValue) {
      if (typeof cookieValue !== 'string' || !cookieValue) return;
      await sql`delete from plainhand.sessions where id_hash = ${hashToken(cookieValue)}`;
    },
    async destroyAll(userId) {
      await sql`delete from plainhand.sessions where user_id = ${userIdOf(userId)}`;
    },
    // Housekeeping for the daily cron.
    async purgeExpired() {
      const rows = await sql`delete from plainhand.sessions where expires_at <= ${now()} returning 1`;
      return rows.length;
    },
  };
}
