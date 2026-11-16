import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { PANEL_VIEWS, FALLBACK_PANELS, toolName, TIER_TEXT, panelPath } from '../plainhand/mcp-tools.mjs';
import { buildMatrix, problems, UI_AGGREGATE, UI_VIA_OTHER_DOOR, INTERNAL, CLI_SCRIPTS } from '../scripts/u12-reachability.mjs';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function app() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-reach-'));
  const plainhand = await createPlainhand({ root, startFeatures: false, providers: [] });
  await new Promise(resolve => plainhand.server.listen(0, '127.0.0.1', resolve));
  return { plainhand, root, base: `http://127.0.0.1:${plainhand.server.address().port}`, close: async () => { await plainhand.close(); await rm(root, { recursive: true, force: true }); } };
}

test('every registry action is reachable on a documented surface', async () => {
  const matrix = await buildMatrix({ root: repo });
  assert.ok(matrix.actions.length >= 80, `the registry should list the full set, got ${matrix.actions.length}`);
  assert.deepEqual(problems(matrix), []);
  for (const action of matrix.actions) {
    assert.ok(['read', 'write', 'task', 'candidate'].includes(action.tier), `${action.name}: ${action.tier}`);
    assert.ok(['direct', 'route', 'aggregate', 'note'].includes(action.screen.reach), `${action.name}: ${action.screen.reach}`);
    assert.equal(action.mcp, action.tier === 'task' ? 'not a tool (runs in Plainhand)' : 'tool', action.name);
    if (action.screen.reach === 'note') assert.ok(action.note?.length > 20, `${action.name}: explain the other door`);
  }
});

test('the screen column names screens the app actually has', async () => {
  const core = await readFile(path.join(repo, 'plainhand/web/ui/core.mjs'), 'utf8');
  const block = core.match(/export const VIEWS = \{([\s\S]*?)\};/);
  assert.ok(block, 'VIEWS is defined in core.mjs');
  const views = new Set([...block[1].matchAll(/([\w-]+):\s*'/g)].map(match => match[1]));
  const aliases = new Set([...core.match(/const ALIASES = \{([^}]*)\}/)[1].matchAll(/([\w-]+):/g)].map(match => match[1]));
  assert.ok(views.has('applications') && views.has('workspace'), [...views].join(','));
  // A panel view is a screen key or one of the client's documented aliases (#settings → workspace).
  for (const view of Object.values(PANEL_VIEWS)) assert.ok(views.has(view) || aliases.has(view), `panel view ${view} is a real screen or alias`);
  for (const action of Object.keys(UI_AGGREGATE)) assert.ok(UI_AGGREGATE[action].length, `${action} says where it is shown`);
});

test('candidate actions land on a panel whose screen exists, and the MCP text says so', async () => {
  const matrix = await buildMatrix({ root: repo });
  const h = await app();
  try {
    const candidates = matrix.actions.filter(action => action.tier === 'candidate');
    assert.ok(candidates.length >= 20, `candidate actions: ${candidates.length}`);
    const core = await readFile(path.join(repo, 'plainhand/web/ui/core.mjs'), 'utf8');
    const views = new Set([...core.match(/export const VIEWS = \{([\s\S]*?)\};/)[1].matchAll(/([\w-]+):\s*'/g)].map(match => match[1]));
    const aliases = new Set([...core.match(/const ALIASES = \{([^}]*)\}/)[1].matchAll(/([\w-]+):/g)].map(match => match[1]));
    for (const action of candidates) {
      // A candidate action must open a real screen: either its own panel or the MCP fallback.
      const panel = h.plainhand.registry.panelFor(action.name, { jobId: 'job-1', id: 'id-1' }) || FALLBACK_PANELS[action.name]?.({ jobId: 'job-1', id: 'id-1' });
      assert.ok(panel?.type, `${action.name}: no panel to send the candidate to`);
      const href = panelPath(panel);
      const view = href.split('#')[1];
      assert.ok(view && (views.has(view) || aliases.has(view)), `${action.name}: ${href} does not land on a screen`);
      if (['job', 'packet', 'record', 'form'].includes(panel.type) && panel.id) assert.match(href, /\?job=job-1/, `${action.name}: ${href} should open the role`);
      if (panel.type === 'form') assert.match(href, /tab=apply/, `${action.name}: a form panel opens the Apply tab`);
    }
    assert.match(TIER_TEXT.candidate, /Only you can do this/);
  } finally { await h.close(); }
});

test('MCP serves every non-task action as a tool the server lists, and no task', async () => {
  const h = await app();
  try {
    let descriptor = null;
    for (let i = 0; i < 100 && !descriptor; i++) {
      try { descriptor = JSON.parse(await readFile(path.join(h.root, 'data/plainhand/local-api.json'), 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    assert.ok(descriptor?.mcpToken, 'the server announces its MCP token to the local MCP server');
    const response = await fetch(`${h.base}/api/mcp/actions`, { headers: { 'X-Plainhand-MCP-Token': descriptor.mcpToken } });
    assert.equal(response.status, 200);
    const { actions } = await response.json();
    const expected = h.plainhand.registry.list().filter(action => action.tier !== 'task').map(action => action.name).sort();
    assert.deepEqual(actions.map(action => action.name).sort(), expected, 'the MCP list is every read, write and candidate action');
    assert.ok(actions.every(action => action.tier !== 'task'), 'tasks are not MCP tools');
    const tools = actions.map(action => toolName(action.name));
    assert.equal(new Set(tools).size, tools.length, 'tool names do not collide');
    for (const tool of tools) assert.match(tool, /^[A-Za-z0-9_-]+$/, tool);
    // The hosted connector filters the same set, plus its own exclusions.
    const hosted = await readFile(path.join(repo, 'plainhand/cloud/mcp.mjs'), 'utf8');
    assert.match(hosted, /tiers: \['read', 'write', 'candidate'\]/);
    assert.match(hosted, /!a\.name\.startsWith\('tasks\.'\)/);
  } finally { await h.close(); }
});

test('the CLI and scripts the matrix names exist and start a real command', async () => {
  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
  const scripts = { ...pkg.scripts };
  for (const [file, command] of Object.entries(CLI_SCRIPTS)) {
    const name = command.replace(/^npm run /, '');
    assert.ok(scripts[name], `${command} is missing from package.json`);
    assert.match(scripts[name], new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${command} should run ${file}`);
  }
  // The one-command launcher reaches the same registry through the app it starts.
  const bin = await readFile(path.join(repo, 'bin/plainhand.mjs'), 'utf8');
  assert.match(bin, /plainhand-server\.mjs/);
  assert.ok(scripts.mcp, 'npm run mcp is the stdio MCP surface');
  const mcp = await readFile(path.join(repo, 'plainhand-mcp.mjs'), 'utf8');
  assert.match(mcp, /api\/mcp|call\('actions'\)/);
  assert.deepEqual(Object.keys(INTERNAL), [], 'no capability is internal-only today');
});

test('the matrix documents the gaps it classifies instead of hiding them', async () => {
  const matrix = await buildMatrix({ root: repo });
  const notes = matrix.actions.filter(action => action.note);
  assert.ok(notes.length >= 3, 'actions reached another way keep their explanation');
  for (const action of notes) assert.ok(UI_VIA_OTHER_DOOR[action.name], action.name);
  for (const [name, where] of Object.entries(UI_AGGREGATE)) assert.ok(matrix.actions.some(action => action.name === name && action.tier === 'read'), `${name} is a read action`);
  const markdown = await readFile(path.join(repo, 'docs/internal/lanes/u12-release/REACHABILITY.md'), 'utf8');
  assert.match(markdown, /^# Reachability matrix \(U12\)/);
  assert.ok(markdown.includes('Documented unsupported interfaces'), 'the unsupported interfaces are written down');
});
