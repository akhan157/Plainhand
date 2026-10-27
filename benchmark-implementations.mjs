import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cases, profiles } from './plainhand/benchmarks/cases.mjs';
import { runCase, strategies } from './plainhand/benchmarks/runner.mjs';
const option = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const live = process.argv.includes('--live');
const selectedCases = option('cases', live ? 'achievement,records' : cases.filter(c => !c.holdout).map(c => c.id).join(',')).split(',');
const selectedProfiles = option('profiles', live ? 'engineering,operations' : Object.keys(profiles).join(',')).split(',');
const selectedStrategies = option('strategies', strategies.join(',')).split(',');
const provider = option('provider', 'claude');
const directory = path.join('output', 'architecture-' + (live ? 'live-' : 'controlled-') + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
const results = [], rounds = Number(option('rounds', '1'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw Error('Use 1–3 rounds.');
for (let round = 0; round < rounds; round++) for (const profileName of selectedProfiles) for (const caseId of selectedCases) {
  const profile = profiles[profileName], spec = cases.find(c => c.id === caseId);
  if (!profile || !spec) throw Error('Unknown profile or case.');
  if (spec.supportedProfiles && !spec.supportedProfiles.includes(profileName)) throw Error('This holdout requires its registered source-rich profile.');
  // Rotate candidate order by case/profile/round to avoid always warming one last.
  const offset = (selectedCases.indexOf(caseId) + selectedProfiles.indexOf(profileName) + round) % selectedStrategies.length;
  const order = [...selectedStrategies.slice(offset), ...selectedStrategies.slice(0, offset)];
  for (const strategy of order) {
    if (!strategies.includes(strategy)) throw Error('Unknown strategy.');
    console.log(`RUN ${live ? provider : 'controlled'} ${strategy} ${profileName}/${caseId} round ${round + 1}`);
    const result = await runCase({ strategy, spec, profile, provider, live });
    result.round = round + 1; result.profileId = profileName;
    const file = `${results.length + 1}-${strategy}-${profileName}-${caseId}.json`;
    await writeFile(path.join(directory, file), JSON.stringify(result, null, 2));
    result.file = file; results.push(result);
    await writeFile(path.join(directory, 'results.json'), JSON.stringify({ live, provider, results }, null, 2));
    console.log(`${result.success ? 'PASS' : 'FAIL'} ready=${result.ready} stop=${result.stop} calls=${result.calls.length} ${result.error || ''}`);
  }
}
const summaries = selectedStrategies.map(strategy => {
  const rows = results.filter(r => r.strategy === strategy), eligible = rows.filter(r => !cases.find(c => c.id === r.case).expectedStop);
  return { strategy, runs: rows.length, correctOutcomes: rows.filter(r => r.success).length, eligibleRuns: eligible.length, correctReady: eligible.filter(r => r.success && r.ready).length, falseReady: rows.filter(r => r.falseReady).length, submissions: rows.reduce((n, r) => n + r.automatedSubmissions, 0), modelCalls: rows.reduce((n, r) => n + r.calls.length, 0), inputTokensReported: rows.reduce((n, r) => n + (r.usage?.totals.inputTokens.value || 0), 0), tokenReportedCalls: rows.reduce((n, r) => n + (r.usage?.totals.inputTokens.reportedCalls || 0), 0), wallMs: rows.reduce((n, r) => n + r.durationMs, 0) };
});
await writeFile(path.join(directory, 'summary.json'), JSON.stringify({ live, provider, summaries }, null, 2));
await writeFile(path.join(directory, 'README.md'), `# Implementation comparison\n\n${live ? 'Real CLI reasoning on fictional employer pages.' : 'Deterministic-agent browser/policy tests; no LLM intelligence or token performance measured.'}\n\n| Candidate | Correct outcomes | Correct ready / eligible | False ready | Calls | Time |\n| --- | --- | --- | --- | --- | --- |\n${summaries.map(s => `| ${s.strategy} | ${s.correctOutcomes}/${s.runs} | ${s.correctReady}/${s.eligibleRuns} | ${s.falseReady} | ${s.modelCalls} | ${(s.wallMs/1000).toFixed(1)}s |`).join('\n')}\n\nFull outputs and failures are retained in results.json and per-run files. These prototypes do not establish real employer completion rates.\n`);
console.log('Evidence: ' + directory);
