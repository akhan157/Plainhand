// Campaign scan against the configured company boards. Read-only: it reports
// candidates and never writes jobs, so a scheduled run cannot surprise you.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Workspace } from './plainhand/store.mjs';
import { runScan, mergeScanHistory } from './plainhand/scan-runner.mjs';
import { deliverNotifications } from './notification-delivery.mjs';
import { createDesktopAdapter, createStdoutAdapter, notificationPayload } from './plainhand/notification-channels.mjs';

const argument = name => { const index = process.argv.indexOf('--' + name); return index < 0 ? null : process.argv[index + 1]; };
const root = argument('data-root') || process.cwd();
const workspace = new Workspace(root);
const state = await workspace.load();

// Roles surfaced by earlier scans stay remembered even before they are saved,
// so a repeated scan cannot re-report the same posting.
const historyFile = path.join(root, 'data/plainhand/scan-history.json');
let history = [];
try { history = JSON.parse(await readFile(historyFile, 'utf8')); } catch {}

let campaign = {};
try { campaign = JSON.parse(await readFile(path.join(root, 'config', 'campaign.json'), 'utf8')); } catch {}
if (argument('terms')) campaign.terms = argument('terms').split(',').map(term => term.trim()).filter(Boolean);
if (argument('locations')) campaign.locations = argument('locations').split(',').map(term => term.trim()).filter(Boolean);
if (argument('name')) campaign.name = argument('name');

if (!state.sources?.length) {
  console.log('No sources configured. Add a company board first.');
  process.exitCode = 1;
} else {
  const report = await runScan({
    sources: state.sources,
    jobs: [...(state.jobs || []), ...(Array.isArray(history) ? history : [])],
    campaign,
    checkLiveness: process.argv.includes('--liveness'),
  });
  const directory = path.join('output', 'scan-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.added.length} new, ${report.duplicates.length} duplicates, ${report.ineligible.length} filtered, ${report.expired.length} closed, ${report.errors.length} source errors`);
  for (const job of report.added.slice(0, 20)) console.log(`  + ${job.company} — ${job.title} (${job.location || 'unknown'})`);
  for (const error of report.errors) console.log(`  ! ${error.source}: ${error.error}`);
  if (report.added.length) {
    const merged = mergeScanHistory(history, report.added, report.checkedAt);
    await mkdir(path.dirname(historyFile), { recursive: true });
    await writeFile(historyFile, JSON.stringify(merged, null, 2));
  }
  console.log(`Report: ${directory}`);
  if (process.argv.includes('--notify') && report.added.length) {
    const channels = [createDesktopAdapter(), createStdoutAdapter({ write: () => {} })];
    const notifications = report.added.slice(0, 10).map(job => notificationPayload({ job, source: job.source || campaign.name || 'campaign scan', campaign: campaign.name, reason: 'matched the campaign criteria and is not already tracked' }));
    const absolute = path.resolve(root);
    const delivery = await deliverNotifications({
      notifications, channels, rootPath: absolute,
      statePath: path.join(absolute, 'data/plainhand/notification-state.json'),
      journalPath: path.join(absolute, 'data/plainhand/notification-journal.jsonl'),
      outboxPath: path.join(absolute, 'data/plainhand/notification-outbox.jsonl'),
    });
    console.log(`Notifications: ${delivery.results.filter(result => result.status === 'delivered').length} delivered, ${delivery.results.filter(result => result.status === 'failed').length} failed`);
  }
  if (report.errors.length) process.exitCode = 1;
}
