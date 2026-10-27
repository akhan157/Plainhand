// Opt-in single provider request, no candidate context or employer interaction.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from './plainhand/store.mjs';
import { UsageLedger } from './plainhand/usage.mjs';
import { executeAgent } from './plainhand/agents.mjs';
const index = process.argv.indexOf('--provider');
if (index < 0) { console.log('Opt-in: node test-plainhand-usage-live.mjs --provider claude'); process.exit(0); }
const provider = process.argv[index + 1];
const root = await mkdtemp(path.join(tmpdir(), 'plainhand-usage-live-'));
const directory = path.join('output', 'usage-live-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
try {
  const ledger = new UsageLedger(new Workspace(root));
  const result = await ledger.track(executeAgent, provider, 'Return {"ok":true}. Minimal usage instrumentation check; no candidate context.', {}, { usageContext: { purpose: 'usage-verification' } });
  assert.equal(result.ok, true);
  const [record] = await ledger.records();
  assert.equal(record.status, 'succeeded');
  if (provider !== 'antigravity') { assert.equal(typeof record.inputTokens, 'number'); assert.equal(typeof record.outputTokens, 'number'); }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), provider, passed: true, record, note: 'CLI-reported USD is not a subscription charge or quota percentage. One minimal request; no candidate or employer data.' }, null, 2));
  console.log(JSON.stringify({ provider, passed: true, record, evidence: directory }, null, 2));
} catch (error) { console.log(JSON.stringify({ provider, passed: false, error: error.message })); process.exitCode = 1; }
finally { await rm(root, { recursive: true, force: true }); }
