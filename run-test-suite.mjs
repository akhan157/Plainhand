#!/usr/bin/env node
// Live inference is opt-in because it uses account quota.
import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const proofRoot = path.join(root, 'output', `verification-${stamp}`);
await mkdir(proofRoot, { recursive: true });
const results = [];
const jobs = [
  ['Persistent sessions and multistep application browser', process.execPath, ['--test', 'test-plainhand-usage.mjs', 'test-plainhand-browser-runtime.mjs', 'test-plainhand-browser-transfers.mjs', 'test-plainhand-browser-schema.mjs', 'test-plainhand-browser-backends.mjs', 'test-plainhand-local-solver.mjs', 'test-plainhand-browser-driver.mjs'], root],
  ['Repository checks and Go build', process.execPath, ['test-all.mjs'], root],
  ['Greenhouse and Lever browser adapters', process.execPath, ['test-greenhouse-lever-adapters.mjs'], root],
  ['Workday and Ashby browser adapters', process.execPath, ['test-workday-ashby-adapters.mjs'], root],
  ['Browser workflow and light/dark/system themes', process.execPath, ['test-plainhand-ui.mjs'], root],
  ['Assistant conversation in the browser', process.execPath, ['test-plainhand-agent-ui.mjs'], root],
  ['Candidate brain controls in the browser', process.execPath, ['test-plainhand-brain-ui.mjs'], root],
  ['Follow-ups in the Record tab', process.execPath, ['test-feature-followups-ui.mjs'], root],
  ['Outcome insights page in the browser', process.execPath, ['test-feature-insights-ui.mjs'], root],
  ['Discovery campaigns in the browser', process.execPath, ['test-feature-campaigns-ui.mjs'], root],
  ['Go package tests', 'go', ['test', './...'], path.join(root, 'dashboard')],
  ['Dependency audit', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--audit-level=high'], root],
];
const liveIndex = process.argv.indexOf('--live');
if (liveIndex >= 0) jobs.push(['Live model workflow (fictional candidate/employer)', process.execPath, ['test-plainhand-live.mjs', '--provider', process.argv[liveIndex + 1]], root]);
for (const directory of ['plainhand', 'plainhand/web']) {
  for (const file of await readdir(path.join(root, directory))) if (/\.(mjs|js)$/.test(file)) jobs.unshift([`Syntax ${directory}/${file}`, process.execPath, ['--check', `${directory}/${file}`], root]);
}
for (const [index, [name, command, args, cwd]] of jobs.entries()) {
  console.log(`Checking: ${name}`);
  const started = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn(command, args, { cwd, shell: false, env: { ...process.env, PLAINHAND_UI_OUTPUT: path.join(proofRoot, 'browser') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '', settled = false;
    const finish = extra => { if (settled) return; settled = true; clearTimeout(timeout); resolve({ name, command: [command, ...args].join(' '), seconds: Math.round((Date.now() - started) / 1000), log, ...extra }); };
    const timeout = setTimeout(() => { child.kill('SIGTERM'); finish({ passed: false, error: 'Check exceeded its ten-minute limit.' }); }, 600000);
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('error', error => finish({ passed: false, error: error.message }));
    child.on('close', code => finish({ passed: code === 0, exitCode: code }));
  });
  const logFile = `check-${String(index + 1).padStart(2, '0')}.log`;
  await writeFile(path.join(proofRoot, logFile), result.log);
  delete result.log;
  result.logFile = logFile;
  results.push(result);
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name} (${result.seconds}s)`);
}
const report = { checkedAt: new Date().toISOString(), passed: results.every(r => r.passed), liveInferenceIncluded: liveIndex >= 0, results };
await writeFile(path.join(proofRoot, 'results.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(proofRoot, 'README.md'), `# Plainhand verification\n\nChecked: ${report.checkedAt}\n\n${report.passed ? 'All checks passed.' : 'Some checks failed; inspect the linked logs.'}\n\n| Check | Result | Time | Log |\n| --- | --- | --- | --- |\n${results.map(r => `| ${r.name} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.seconds}s | [log](${r.logFile}) |`).join('\n')}\n\nThe browser workflow uses a fictional candidate and local employer fixture, real Chromium PDFs and uploads, and explicit synthetic model responses. No real application is submitted. Live inference is ${liveIndex >= 0 ? 'included; inspect its log for the provider and synthetic test boundaries' : 'separately opt-in with --live <provider>'}. Browser screenshots and the workflow checklist are in browser/.\n`);
console.log(`\n${report.passed ? 'Full suite passed.' : 'Full suite failed.'} Evidence: ${proofRoot}`);
process.exitCode = report.passed ? 0 : 1;
