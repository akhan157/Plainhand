// Simulated application corpus: fictional candidates x fictional portals.
// Measures completion, interruptions, recovery and duration for the production
// browser path. It cannot measure employer acceptance or real voice.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCase, strategies } from './plainhand/benchmarks/runner.mjs';
import { cases, profiles } from './plainhand/benchmarks/cases.mjs';

const argument = name => { const index = process.argv.indexOf('--' + name); return index < 0 ? null : process.argv[index + 1]; };
const strategy = argument('strategy') || 'durable-hybrid';
if (!strategies.includes(strategy)) throw new Error(`Unknown strategy. Choose ${strategies.join(', ')}`);
const only = argument('case');
const selected = cases.filter(spec => !only || spec.id === only);
const directory = path.join('output', 'simulation-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });

const results = [];
for (const spec of selected) {
  const names = spec.supportedProfiles || Object.keys(profiles).filter(name => name !== 'rich');
  for (const name of names) {
    const profile = profiles[name];
    const report = await runCase({ strategy, spec, profile, live: false });
    const verification = (report.events || []).filter(event => event.verification);
    results.push({
      case: spec.id,
      family: spec.family,
      profile: name,
      success: report.success === true,
      ready: report.ready === true,
      stop: report.stop,
      expectedStop: spec.expectedStop || null,
      falseReady: report.falseReady === true,
      automatedSubmissions: report.automatedSubmissions,
      challenges: verification.length,
      recovered: verification.some(event => event.verification.state === 'ready'),
      durationMs: report.durationMs || 0,
      error: report.error || null,
    });
    console.log(`${spec.id.padEnd(26)} ${name.padEnd(11)} ${report.success ? 'PASS' : 'FAIL'}  stop=${report.stop || '-'}  ${(report.durationMs / 1000).toFixed(1)}s`);
  }
}

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const byFamily = {};
for (const result of results) {
  const bucket = byFamily[result.family] ||= { total: 0, passed: 0 };
  bucket.total++;
  if (result.success) bucket.passed++;
}
const challenges = results.filter(result => result.challenges > 0);
const summary = {
  generatedAt: new Date().toISOString(),
  strategy,
  live: false,
  scope: 'fictional candidates and fictional portals; not employer acceptance or real voice',
  total: results.length,
  passed: results.filter(result => result.success).length,
  failed: results.filter(result => !result.success).length,
  falseReady: results.filter(result => result.falseReady).length,
  automatedSubmissions: results.reduce((sum, result) => sum + (result.automatedSubmissions || 0), 0),
  errors: results.filter(result => result.error).length,
  challenges: { total: challenges.length, recovered: challenges.filter(result => result.recovered).length },
  stopCounts: Object.fromEntries([...new Set(results.map(result => result.stop || 'none'))].map(stop => [stop, results.filter(result => (result.stop || 'none') === stop).length])),
  durationSeconds: { p50: +(percentile(results.map(r => r.durationMs), 0.5) / 1000).toFixed(1), p95: +(percentile(results.map(r => r.durationMs), 0.95) / 1000).toFixed(1), max: +(Math.max(0, ...results.map(r => r.durationMs)) / 1000).toFixed(1) },
  byFamily,
  results,
};
await writeFile(path.join(directory, 'report.json'), JSON.stringify(summary, null, 2));
await writeFile(path.join(directory, 'SUMMARY.md'), [
  `# Simulated corpus — ${summary.generatedAt}`,
  '',
  `Strategy \`${strategy}\`, deterministic test agent, fictional candidates and portals.`,
  'This measures the pipeline, not employer acceptance or the candidate\'s real voice.',
  '',
  `- Cases: **${summary.passed}/${summary.total}** passed, ${summary.failed} failed, ${summary.falseReady} false-ready`,
  `- Automated submissions: **${summary.automatedSubmissions}**`,
  `- Interruptions: ${summary.challenges.total} cases hit a verification challenge, ${summary.challenges.recovered} recovered automatically`,
  `- Stops: ${Object.entries(summary.stopCounts).map(([stop, count]) => `${stop}=${count}`).join(', ')}`,
  `- Duration: p50 ${summary.durationSeconds.p50}s, p95 ${summary.durationSeconds.p95}s, max ${summary.durationSeconds.max}s`,
  '',
  '| Family | Passed | Total |',
  '| --- | ---: | ---: |',
  ...Object.entries(byFamily).map(([family, bucket]) => `| ${family} | ${bucket.passed} | ${bucket.total} |`),
].join('\n'));
console.log(`\n${summary.passed}/${summary.total} passed, ${summary.falseReady} false-ready, ${summary.automatedSubmissions} submissions, p95 ${summary.durationSeconds.p95}s`);
console.log(`Report: ${directory}`);
process.exitCode = summary.failed ? 1 : 0;
