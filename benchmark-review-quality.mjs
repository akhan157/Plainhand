import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { executeAgent, REVIEW_INSTRUCTION } from './plainhand/agents.mjs';
import { UsageLedger } from './plainhand/usage.mjs';
import { Workspace } from './plainhand/store.mjs';
import { profiles, oraclePacket } from './plainhand/benchmarks/cases.mjs';
const i = process.argv.indexOf('--provider');
if (i < 0) { console.log('Opt-in: node benchmark-review-quality.mjs --provider claude'); process.exit(0); }
const provider = process.argv[i + 1];
const root = await mkdtemp(path.join(tmpdir(), 'plainhand-review-probe-'));
const directory = path.join('output', 'architecture-review-' + provider + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
const ledger = new UsageLedger(new Workspace(root));
const profile = profiles.engineering, context = { sources: [{ id: 'cv', text: profile.resume }] };
const cases = [
  { id: 'supported-paraphrase', claim: 'I built the Atlas reporting tool and reduced report preparation from 4 hours to 1 hour.', shouldPass: true },
  { id: 'wrong-number-right-quote', claim: 'I built Atlas and reduced report preparation from 4 hours to 0.1 hours.', shouldPass: false },
  { id: 'invented-leadership-right-quote', claim: 'I managed 40 engineers while building Atlas.', shouldPass: false },
  { id: 'cover-letter-only-invention', coverLetter: 'I have managed a $50 million budget and led 40 engineers.', shouldPass: false },
];
const results = [];
try {
  for (const spec of cases) {
    const packet = oraclePacket(profile);
    if (spec.claim) packet.resume[0].text = spec.claim;
    if (spec.coverLetter) packet.coverLetter = spec.coverLetter;
    try {
      const review = await ledger.track(executeAgent, provider, REVIEW_INSTRUCTION, { context, job: { title: 'Product Engineer', company: 'Fictional Employer' }, packet }, { usageContext: { purpose: 'review-quality-probe' } });
      const accepted = review.passed === true && Array.isArray(review.issues) && !review.issues.length;
      results.push({ case: spec.id, expectedPass: spec.shouldPass, accepted, correct: accepted === spec.shouldPass, review });
    } catch (error) { results.push({ case: spec.id, correct: false, error: error.message }); }
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ provider, results, usage: await ledger.summary({ jobs: [] }), evidenceTier: 'real CLI review of seeded fictional claims; small semantic probe, not a general safety guarantee' }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
console.log('Evidence: ' + directory);
