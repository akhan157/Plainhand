// Read credentials from the environment; never log request headers or candidate text.
import assert from 'node:assert/strict';
const site=process.env.SITE_URL;
assert.ok(site?.startsWith('https://'),'Set SITE_URL to the canonical test origin.');
for(const route of ['/privacy','/terms','/support','/signin']) {
 const response=await fetch(site+route,{redirect:'manual'});assert.equal(response.status,200,route);
 assert.equal(response.headers.get('x-frame-options'),'DENY');
}
const server=await (await fetch(site+'/.well-known/oauth-authorization-server')).json();
assert.ok(server.code_challenge_methods_supported.includes('S256'));
assert.equal(server.issuer,site);
const metadata=await (await fetch(site+'/.well-known/oauth-protected-resource')).json();assert.equal(metadata.resource,site+'/mcp');
const challenge=await fetch(site+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
assert.equal(challenge.status,401);assert.ok(challenge.headers.get('www-authenticate')?.includes('/.well-known/oauth-protected-resource'));
assert.equal((await fetch(site+'/api/state')).status,401);
assert.equal((await fetch(site+'/api/cron/daily')).status,401);
console.log('PASS: public pages, metadata, MCP challenge and signed-out protection.');
if(process.argv.includes('--authenticated-pdf')) {
 const cookie=process.env.PLAINHAND_SMOKE_COOKIE, token=process.env.PLAINHAND_SMOKE_CSRF, artifact=process.env.PLAINHAND_SMOKE_PDF_PATH;
 assert.ok(cookie && token && artifact?.startsWith('output/') && artifact.endsWith('.pdf'),'Set smoke session cookie, page CSRF token and an existing rendered PDF path.');
 assert.equal((await fetch(site+'/api/state',{headers:{cookie}})).status,403);
 const response=await fetch(site+'/api/artifact?'+new URLSearchParams({path:artifact}),{headers:{cookie,'x-plainhand-token':token}});
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);
 console.log(JSON.stringify({authenticatedPdf:'PASS',bytes:bytes.length}));
}
