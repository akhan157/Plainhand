-- Hosted Plainhand schema (docs/internal/HOSTED-CONNECTOR-PLAN.md).
-- Lives in its own schema, which Supabase's REST API does not expose; only the
-- Plainhand server (direct Postgres connection) reads or writes it. Row level security
-- is enabled with no policies as a second barrier against any API role.
-- Idempotent: safe to apply again.

create schema if not exists plainhand;

-- One row per candidate. user_id is the Supabase Auth user id.
create table if not exists plainhand.accounts (
  user_id uuid primary key,
  email text not null,
  created_at timestamptz not null default now()
);

-- The candidate's workspace: the same relative paths the local app keeps in a folder.
create table if not exists plainhand.workspace_files (
  user_id uuid not null references plainhand.accounts (user_id) on delete cascade,
  path text not null check (char_length(path) between 1 and 512),
  content bytea not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- Website sign-in sessions. Only a hash of the cookie value is stored.
create table if not exists plainhand.sessions (
  id_hash text primary key,
  user_id uuid not null references plainhand.accounts (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on plainhand.sessions (user_id);

-- OAuth 2.1 for the ChatGPT / Claude connector and the browser extension.
-- Clients register themselves (RFC 7591), so a client row is not tied to a user.
create table if not exists plainhand.oauth_clients (
  client_id text primary key,
  client_secret_hash text,
  client_name text,
  redirect_uris text[] not null,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);

-- A connected app: one candidate's approval of one client. Revoking it ends every token.
create table if not exists plainhand.oauth_grants (
  id uuid primary key,
  user_id uuid not null references plainhand.accounts (user_id) on delete cascade,
  client_id text not null references plainhand.oauth_clients (client_id) on delete cascade,
  scope text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists oauth_grants_user_idx on plainhand.oauth_grants (user_id);

create table if not exists plainhand.oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references plainhand.oauth_grants (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists plainhand.oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references plainhand.oauth_grants (id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  resource text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oauth_tokens_grant_idx on plainhand.oauth_tokens (grant_id);

-- Rate limit counters: one row per key per fixed window. Keys are hashed (no raw IPs or emails).
create table if not exists plainhand.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Added for plainhand/cloud/oauth.mjs.
-- Registration rate limit: a hash of the registering IP, never the IP itself.
alter table plainhand.oauth_clients add column if not exists registered_ip_hash text;
create index if not exists oauth_clients_created_idx on plainhand.oauth_clients (created_at);
-- One grant per (candidate, client); re-authorizing reuses it.
create unique index if not exists oauth_grants_user_client_idx on plainhand.oauth_grants (user_id, client_id);
-- A rotated refresh token is kept (marked used) until it expires so reuse can be detected.
alter table plainhand.oauth_tokens add column if not exists used_at timestamptz;

alter table plainhand.accounts enable row level security;
alter table plainhand.workspace_files enable row level security;
alter table plainhand.sessions enable row level security;
alter table plainhand.oauth_clients enable row level security;
alter table plainhand.oauth_grants enable row level security;
alter table plainhand.oauth_codes enable row level security;
alter table plainhand.oauth_tokens enable row level security;
alter table plainhand.rate_limits enable row level security;
revoke all on schema plainhand from public;
