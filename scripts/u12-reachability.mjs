#!/usr/bin/env node
// U12 reachability: build the surface matrix for every registry action from the
// code that exposes it, and write docs/internal/lanes/u12-release/REACHABILITY.md.
//
// Surfaces, each read from the file that actually wires it:
//   Screen        plainhand/web/**        action called by name, or the client calls a
//                                         server route whose handler runs the action
//   Conversation  plainhand/agent.mjs     registry catalogue sent to the model (all tiers)
//   MCP local     plainhand-mcp.mjs       /api/mcp/actions (task tier excluded)
//   MCP hosted    plainhand/cloud/mcp.mjs task tier excluded
//   CLI           bin/plainhand.mjs, package.json scripts
//
// The registry is the runtime one the server builds (core + feature modules), so a
// new action appears here the moment it is registered.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MATRIX_PATH = 'docs/internal/lanes/u12-release/REACHABILITY.md';

// Client files that belong to a screen. Used to turn "the client calls this route"
// into "this screen shows it". A file may serve more than one screen; the map names
// the screen a reader would open.
const SCREEN_BY_FILE = {
  'app.mjs': 'shell and navigation',
  'home.mjs': 'Home',
  'jobs.mjs': 'Jobs',
  'jobpanel.mjs': 'Application panel (Fit, Packet, Apply, Record tabs)',
  'applications.mjs': 'Applications',
  'campaigns.mjs': 'Campaigns',
  'insights.mjs': 'Insights',
  'profile.mjs': 'Profile & brain',
  'activity.mjs': 'Activity and AI usage',
  'settings.mjs': 'Workspace and Connections',
  'connect-data.mjs': 'Connections',
  'onboarding.mjs': 'Get started, Help and dialogs',
  'conversation.mjs': 'conversation panel and task cards',
  'followups.mjs': 'application Record tab (follow-ups)',
  'inbox.mjs': 'Applications (emails)',
  'interview-prep.mjs': 'application Record tab (interview prep)',
  'skill-plan.mjs': 'Insights (learning plan)',
  'components.mjs': 'shared controls',
  'core.mjs': 'shared client runtime',
  'demo.mjs': 'sample workspace',
  'agent.mjs': 'conversation panel',
  'tracker-rows.mjs': 'Applications (tracker rows)',
};

// Read-only actions whose data the client renders from /api/state or another
// aggregate route instead of calling the action itself. Every entry says where.
export const UI_AGGREGATE = {
  'workspace.digest': ['Home', 'Application panel'],
  'jobs.list': ['Home', 'Jobs', 'Applications'],
  'jobs.get': ['Application panel'],
  'inbox.list': ['Applications (emails)'],
  'interviewPrep.packs': ['application Record tab (interview prep)'],
  'followups.drafts': ['application Record tab (follow-ups)'],
  'followups.list': ['Home', 'Application panel'],
  'audit.list': ['Activity'],
  'usage.summary': ['AI usage'],
  'profile.get': ['Profile & brain'],
  'profile.strength': ['Profile & brain'],
  'line.get': ['Profile & brain'],
  'answers.list': ['Workspace'],
  'context.get': ['Workspace'],
  'conflicts.list': ['Profile & brain (facts that disagree, from /api/state memory)'],
};

// A capability with no separate screen control because the screen offers a different
// door to it. Each entry is a deliberate design decision, not a missing control.
export const UI_VIA_OTHER_DOOR = {
  'profile.addStory': 'Stories are added by telling Plainhand in the conversation; Profile edits or deletes the saved text.',
  'line.addStatement': 'The line is stated in the conversation, where Plainhand can copy the candidate’s exact words; Profile removes a statement.',
  'corrections.propose': 'A correction is proposed by the agent or an external agent; Workspace approves or rejects it.',
  'profile.update': 'The Profile screen saves the same preference fields through /api/profile, including the sensitive fields this action never changes (name, email, resume, work authorization, compensation).',
  'jobs.setContext': 'The Fit tab saves description, role answers and override reason through one job form.',
  'jobs.select': 'The Fit tab’s select control also saves the updated context first.',
  'campaigns.markViewed': 'The Campaigns screen marks results seen when it opens; there is no button for it.',
  'tasks.discover': 'Discovery runs from the Jobs screen and campaign scans; a campaign run is the scheduled form.',
  'tasks.interview': 'Started from Profile (“Tell your story”) and the conversation.',
  'tasks.standard': 'Started from Profile (“Write my master resume”).',
  'tasks.revise': 'Started from the packet’s revise box or the conversation.',
  'tasks.evaluate': 'Started from a saved role or a campaign’s daily limit.',
  'tasks.prepare': 'Started from the Fit tab when a role is selected.',
  'tasks.cancel': 'Each running task card has its own Cancel control.',
  'campaigns.get': 'Agent and MCP reader. Campaigns renders campaigns.list, whose entries carry health and last runs.',
  'campaigns.results': 'Agent and MCP reader. Campaigns renders each campaign’s last runs and the Jobs inbox carries surfaced roles.',
};

// No surface outside the conversation. Empty today; the test keeps it honest.
export const INTERNAL = {};

const escapeCell = value => String(value ?? '—').replace(/\|/g, '\\|');
const uniq = values => [...new Set(values)];

async function clientFiles(root) {
  const files = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(mjs|js|html)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(path.join(root, 'plainhand/web'));
  return files;
}

// Server route blocks: the line with `url.pathname` opens a block; literal
// `ui('action'` calls inside it belong to that route. Dynamic handlers that pick an
// action from a table are found by the same scan because the table entries are literal.
export function serverRoutes(source) {
  const routes = new Map();
  let current = [];
  for (const line of source.split('\n')) {
    const hits = [...line.matchAll(/url\.pathname\s*(?:===|\.startsWith\()\s*'([^']+)'/g)].map(match => match[1]);
    if (hits.length) current = hits.map(route => route.replace(/^\/api\//, ''));
    if (!current.length) continue;
    // A literal action name in the same call as `ui(`, including a ternary such as
    // `ui(input.status === 'Applied' ? 'jobs.confirmSubmitted' : 'jobs.setStatus')`.
    if (!line.includes('ui(')) continue;
    const actions = [...line.matchAll(/'([a-zA-Z][\w]*\.[\w]+)'/g)].map(match => match[1]);
    // A route that builds the action from its input: ui('tasks.' + input.kind).
    const prefixes = [...line.matchAll(/ui\(\s*'([a-zA-Z][\w]*)\.'\s*\+/g)].map(match => match[1]);
    for (const prefix of prefixes) actions.push(`${prefix}.*`);
    for (const action of actions) for (const route of current) {
      if (!routes.has(action)) routes.set(action, new Set());
      routes.get(action).add(route);
    }
  }
  return routes;
}

export function clientCalls(source) {
  const calls = new Set();
  for (const match of source.matchAll(/\b(?:api|downloadFile)\(\s*'([^']+)'/g)) calls.add(match[1].split('?')[0]);
  return calls;
}

async function registryActions(root) {
  const { createPlainhand } = await import(path.join(root, 'plainhand-server.mjs'));
  const temp = await mkdtemp(path.join(tmpdir(), 'u12-reachability-'));
  const app = await createPlainhand({ root: temp, startFeatures: false, providers: [] });
  try {
    return app.registry.list().map(({ name, tier, title, description }) => ({ name, tier, title, description }));
  } finally {
    await app.close?.();
    await rm(temp, { recursive: true, force: true });
  }
}

const AREA_LABEL = {
  workspace: 'Workspace overview', jobs: 'Jobs and applications', followups: 'Follow-ups', audit: 'Activity log',
  usage: 'AI usage', profile: 'Profile and story', standard: 'Master resume', format: 'Resume format',
  settings: 'Settings', calibration: 'Claim calibration', line: 'Wording line', context: 'What the agent sees',
  answers: 'Reusable answers', record: 'Application record', sources: 'Job sources', corrections: 'Corrections',
  tasks: 'Tasks', understanding: 'Profile understanding', packet: 'Application packet', campaigns: 'Campaigns',
  insights: 'Outcome insights', interviewPrep: 'Interview prep', inbox: 'Emails and proposals', skillPlan: 'Learning plan',
};
const areaOf = name => name.split('.')[0];

// CLI reach: the one-command launcher starts the server, which serves the screen and
// the HTTP API; plainhand-mcp.mjs is the same registry over stdio MCP.
export const CLI_SCRIPTS = {
  'lib/doctor.mjs': 'npm run doctor',
  'lib/verify-pipeline.mjs': 'npm run verify',
  'lib/verify-artifact-contract.mjs': 'npm run verify:artifacts',
  'lib/build-resume.mjs': 'npm run resume:build',
  'lib/verify-resume.mjs': 'npm run resume:verify',
  'lib/scan.mjs': 'npm run scan',
  'lib/check-liveness.mjs': 'npm run liveness',
  'lib/analyze-patterns.mjs': 'npm run patterns',
  'lib/score-calibration.mjs': 'npm run calibrate',
  'lib/update-system.mjs': 'npm run update:check',
  'demo/run-sample.mjs': 'npm run demo:sample',
};

export async function buildMatrix({ root = REPO } = {}) {
  const actions = await registryActions(root);
  const server = await readFile(path.join(root, 'plainhand-server.mjs'), 'utf8');
  const routes = serverRoutes(server);
  const webFiles = await clientFiles(root);
  const client = new Map();
  for (const file of webFiles) client.set(path.basename(file), await readFile(file, 'utf8'));
  const clientText = [...client.values()].join('\n');
  const calls = clientCalls(clientText);

  const rows = actions.map(action => {
    const screens = [];
    let screenReach = 'none';
    for (const [file, text] of client) {
      // A call by name: name: 'x.y', action('x.y'), act('x.y'), run('x.y'), including a
      // ternary that picks the name. A field-label map that lists the action for editable
      // inputs is not a control, so the name must sit on a line that makes the call.
      const call = new RegExp(`\\b(?:name:|action\\(|act\\(|run\\()`);
      if (!text.split('\n').some(line => line.includes(`'${action.name}'`) && call.test(line))) continue;
      screenReach = 'direct';
      screens.push(SCREEN_BY_FILE[file] || file);
    }
    const actionRoutes = uniq([...(routes.get(action.name) || []), ...(routes.get(`${areaOf(action.name)}.*`) || [])]);
    const called = actionRoutes.filter(route => calls.has(route) || (route.endsWith('/') && [...calls].some(call => call.startsWith(route))));
    if (called.length) {
      screenReach = screenReach === 'direct' ? 'direct' : 'route';
      for (const route of called) for (const [file, text] of client) if (text.includes(`'${route}'`)) screens.push(SCREEN_BY_FILE[file] || file);
    }
    // Feature pages build an action name from a verb: act(`insights.${verb}`).
    if (screenReach === 'none') {
      const template = `${areaOf(action.name)}.\${`;
      for (const [file, text] of client) if (text.includes(template)) { screenReach = 'direct'; screens.push(SCREEN_BY_FILE[file] || file); }
    }
    if (screenReach === 'none' && UI_AGGREGATE[action.name]?.length) {
      screenReach = 'aggregate';
      screens.push(...UI_AGGREGATE[action.name]);
    }
    if (screenReach === 'none' && UI_VIA_OTHER_DOOR[action.name]) { screenReach = 'note'; screens.push('other door'); }
    return {
      ...action, area: areaOf(action.name), areaLabel: AREA_LABEL[areaOf(action.name)] || areaOf(action.name),
      screen: { reach: screenReach, screens: uniq(screens), routes: actionRoutes, called },
      conversation: action.tier === 'candidate' ? 'candidate link' : action.tier === 'task' ? 'task, needs confirmation' : action.tier === 'write' ? 'write, needs confirmation' : 'read',
      mcp: action.tier === 'task' ? 'not a tool (runs in Plainhand)' : 'tool',
      note: UI_VIA_OTHER_DOOR[action.name] || null,
      internal: INTERNAL[action.name] || null,
    };
  });
  return { actions: rows, cliScripts: CLI_SCRIPTS, routes };
}

// Problems the test turns into failures. Everything here is a claim the matrix makes
// about reachability that the code does not back.
export function problems(matrix) {
  const found = [];
  const names = new Set(matrix.actions.map(action => action.name));
  for (const action of matrix.actions) {
    const reachable = action.screen.reach !== 'none' || action.conversation || action.mcp !== 'not a tool';
    if (!reachable && !action.internal) found.push(`${action.name}: no surface and no internal reason`);
    if (action.screen.reach === 'none' && !action.internal) found.push(`${action.name}: no screen control and no documented reason`);
    if (action.screen.reach === 'note' && !action.note) found.push(`${action.name}: marked as reached another way with no explanation`);
  }
  for (const name of Object.keys(UI_AGGREGATE)) if (!names.has(name)) found.push(`UI_AGGREGATE names ${name}, which the registry does not define`);
  for (const name of Object.keys(UI_VIA_OTHER_DOOR)) if (!names.has(name)) found.push(`UI_VIA_OTHER_DOOR names ${name}, which the registry does not define`);
  for (const name of Object.keys(INTERNAL)) if (!names.has(name)) found.push(`INTERNAL names ${name}, which the registry does not define`);
  return found;
}

function markdown(matrix) {
  const { actions } = matrix;
  const tiers = actions.reduce((counts, action) => ({ ...counts, [action.tier]: (counts[action.tier] || 0) + 1 }), {});
  const reach = actions.reduce((counts, action) => ({ ...counts, [action.screen.reach]: (counts[action.screen.reach] || 0) + 1 }), {});
  const lines = [];
  lines.push('# Reachability matrix (U12)');
  lines.push('');
  lines.push('Generated by `node scripts/u12-reachability.mjs --write` from the running registry and the files that expose it. `tests/test-u12-reachability.mjs` fails when an action gains no surface, loses its screen without a documented reason, or when this file names an action the registry no longer defines.');
  lines.push('');
  lines.push(`Registry actions: **${actions.length}** (${['read', 'write', 'task', 'candidate'].map(tier => `${tier} ${tiers[tier] || 0}`).join(' · ')}). Screen reach: ${['direct', 'route', 'aggregate', 'none'].map(kind => `${kind} ${reach[kind] || 0}`).join(' · ')}.`);
  lines.push('');
  lines.push('## Surfaces');
  lines.push('');
  lines.push('| Surface | Where | What reaches it |');
  lines.push('| --- | --- | --- |');
  lines.push('| Screen | `plainhand/web/**` | The action is called by name, or the client calls an `/api` route whose handler runs it. Read-only actions the screens render from `/api/state` are listed as `aggregate`. |');
  lines.push('| Conversation | `plainhand/agent.mjs` | Every action is in the model’s catalogue. Read and write run as tools; writes need the candidate’s confirmation; tasks need confirmation and run in Plainhand; candidate-tier actions return a panel link and change nothing. |');
  lines.push('| MCP local | `plainhand-mcp.mjs` → `/api/mcp/actions` | Read, write and candidate actions. Task-tier actions are not tools: the agent is told to run them in Plainhand. Candidate actions return a link and steps. |');
  lines.push('| MCP hosted | `plainhand/cloud/mcp.mjs` | Same set as the local bridge, over the hosted connector. |');
  lines.push('| CLI | `bin/plainhand.mjs`, `package.json` | The launcher starts the app (screen and HTTP API); `plainhand-mcp.mjs` is the stdio MCP server. Scripted career-ops commands exist for some areas (`npm run doctor`, `verify`, `resume:*`, `scan`, `liveness`, `patterns`, `calibrate`, `update:check`, `demo:sample`). |');
  lines.push('');
  lines.push('Tier rules are enforced once, in `registry.run`: candidate actions only from the screen; agent writes and tasks need explicit confirmation; MCP cannot run tasks. No surface can widen them.');
  lines.push('');
  const byArea = new Map();
  for (const action of actions) {
    const key = action.area;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(action);
  }
  for (const [area, list] of byArea) {
    lines.push(`## ${list[0].areaLabel}`);
    lines.push('');
    lines.push('| Action | Tier | Screen | Conversation | MCP |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const action of list) {
      const screen = action.screen.reach === 'none' || action.screen.reach === 'note'
        ? (action.note ? 'none: ' + action.note : 'none')
        : `${action.screen.reach}: ${action.screen.screens.join(', ') || '—'}`;
      lines.push(`| \`${action.name}\` | ${action.tier} | ${escapeCell(screen)} | ${escapeCell(action.conversation)} | ${escapeCell(action.mcp)} |`);
    }
    lines.push('');
    for (const action of list.filter(item => item.note)) lines.push(`- \`${action.name}\`: ${action.note}`);
    lines.push('');
  }
  lines.push('## Documented unsupported interfaces');
  lines.push('');
  lines.push('- Hosted: no application browser, no local files, and no CLI; task-tier actions run only in Plainhand.');
  lines.push('- MCP: no task execution, no packet or understanding approval, no submission confirmation, no widening of shared context.');
  lines.push('- CLI: no per-action command; the launcher serves the same API the screen uses.');
  lines.push('');
  return lines.join('\n');
}

export async function writeMatrix({ root = REPO } = {}) {
  const matrix = await buildMatrix({ root });
  const file = path.join(root, MATRIX_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, markdown(matrix));
  return { matrix, file: MATRIX_PATH };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  const result = write ? await writeMatrix() : await buildMatrix();
  if (write) console.log(`Wrote ${result.file}`);
  else {
    console.log(`${result.actions.length} actions`);
    for (const action of result.actions) console.log(`${action.tier.padEnd(9)} ${action.name.padEnd(28)} screen=${action.screen.reach} mcp=${action.mcp}`);
    const found = problems(result);
    for (const problem of found) console.error(`PROBLEM ${problem}`);
    if (found.length) process.exitCode = 1;
  }
}
