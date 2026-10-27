import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildDashboardPayload, loadArtifactMap } from './dashboard-data.mjs';

const args = parseArgs(process.argv.slice(2));
const rootPath = path.resolve(args.path || process.cwd());
const outPath = path.resolve(args.out || path.join(rootPath, 'dashboard-data', 'dashboard-data.json'));
const artifactMap = await loadArtifactMap(args['artifact-map']);
const linkMode = Object.keys(artifactMap).length ? 'hybrid' : (args.mode || 'local');

const payload = await buildDashboardPayload({
  rootPath,
  linkMode,
  artifactMap,
});

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`Exported dashboard data to ${outPath}`);
console.log(`Mode: ${linkMode}`);
console.log(`Apps: ${payload.counts.all}`);
console.log(`States: ${payload.states.length}`);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

function printHelp() {
  console.log('Usage: node export-dashboard-data.mjs [--path <career-ops-dir>] [--out <json-path>] [--mode local|hybrid] [--artifact-map <json-path>]');
}
