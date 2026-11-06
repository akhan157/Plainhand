// Vercel entry for hosted Plainhand. The only place that reads process.env; every module
// below takes its settings as arguments (docs/HOSTED-CONNECTOR-PLAN.md, Module contracts).
// The connector, extension and step modules are optional until they are built.
import { connect } from '../plainhand/cloud/postgres-storage.mjs';
import { createAccounts, createSessions } from '../plainhand/cloud/accounts.mjs';
import { createSupabaseAuth } from '../plainhand/cloud/supabase-auth.mjs';
import { createCloudApp, sessionUserReader } from '../plainhand/cloud/app.mjs';

async function optional(specifier) {
  try { return await import(specifier); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes(specifier.replace(/^\.\.\//, ''))) return {}; throw error; }
}

export async function buildHandler(env = process.env) {
  const site = String(env.SITE_URL || '').replace(/\/+$/, '');
  const now = () => new Date();
  const sql = connect(env.DATABASE_URL);
  const accounts = createAccounts({ sql });
  const sessions = createSessions({ sql, now });
  const auth = createSupabaseAuth({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, secretKey: env.SUPABASE_SECRET_KEY });
  const [oauthModule, mcpModule, extensionModule, stepsModule] = await Promise.all([
    optional('../plainhand/cloud/oauth.mjs'), optional('../plainhand/cloud/mcp.mjs'),
    optional('../plainhand/cloud/extension-api.mjs'), optional('../plainhand/cloud/steps.mjs'),
  ]);
  const oauth = oauthModule.createOAuthServer?.({ sql, issuer: site, resource: site + '/mcp', sessionUser: sessionUserReader(sessions), now });
  return createCloudApp({
    sql, env: { ...env, SITE_URL: site }, auth, accounts, sessions, now, oauth,
    handleMcp: mcpModule.handleMcp, handleExtensionApi: extensionModule.handleExtensionApi, stepRunner: stepsModule.createStepRunner,
  });
}

let handler = null;
export default async function plainhand(req, res) {
  handler ??= buildHandler().catch(error => { handler = null; throw error; });
  let app;
  try { app = await handler; }
  catch (error) {
    console.error('plainhand-cloud start failed', error?.name); // never the message: it may name a secret
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Plainhand is starting up. Try again in a minute.' }));
  }
  return app(req, res);
}
