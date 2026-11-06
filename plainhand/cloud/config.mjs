export function validateCloudEnv(env) {
  let url;
  try { url = new URL(env.SITE_URL); } catch { throw new Error('SITE_URL must be a canonical HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || env.SITE_URL !== url.origin) throw new Error('SITE_URL must be a canonical HTTPS origin without a trailing slash.');
  for (const name of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SESSION_SECRET', 'CRON_SECRET']) {
    if (!env[name]) throw new Error(`${name} is required.`);
  }
  if (env.SESSION_SECRET.length < 32 || env.CRON_SECRET.length < 32) throw new Error('SESSION_SECRET and CRON_SECRET must each have at least 32 characters.');
  const ids = (env.PLAINHAND_EXTENSION_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.some(id => !/^[a-z0-9-]{1,100}$/.test(id))) throw new Error('PLAINHAND_EXTENSION_IDS contains an invalid ID.');
  if (env.SUPPORT_URL) { const support = new URL(env.SUPPORT_URL); if (support.protocol !== 'https:' || support.username || support.password) throw new Error('SUPPORT_URL must use HTTPS without credentials.'); }
  return { site: url.origin, extensionEnabled: ids.length > 0 };
}
