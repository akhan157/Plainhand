#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildDashboardPayload } from './dashboard-data.mjs';
import { runLifecycle } from './lifecycle-runner.mjs';
import { validateOnboarding } from './onboarding.mjs';
import { createSandboxFixture } from './sandbox-demo.mjs';

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--keep');
if (unknownArgs.length > 0) {
  console.error(`test-sandbox: unknown option ${unknownArgs[0]}`);
  process.exit(1);
}

let sandboxRoot = null;
let fixture = null;
let dashboardServer = null;
let browser = null;

function namedCheck(name, action) {
  return Promise.resolve()
    .then(action)
    .then((result) => {
      console.log(`${name}: passed`);
      return result;
    });
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: SOURCE_ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr, label }));
  });
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object', 'dashboard port: loopback address unavailable');
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function startDashboard(root, port) {
  const child = spawn(process.execPath, [
    join(SOURCE_ROOT, 'web-dashboard-server.mjs'),
    '--path', root,
    '--host', '127.0.0.1',
    '--port', String(port),
  ], {
    cwd: SOURCE_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.capturedStdout = '';
  child.capturedStderr = '';
  child.stdout.on('data', (chunk) => { child.capturedStdout += chunk; });
  child.stderr.on('data', (chunk) => { child.capturedStderr += chunk; });
  return child;
}

function waitForListening(child, root, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      error ? reject(error) : resolve();
    };
    const onData = () => {
      if (child.capturedStdout.includes('Career dashboard web listening on http://127.0.0.1:')) finish();
    };
    const onError = (error) => finish(new Error(`dashboard startup at ${root}: ${error.message}`));
    const onExit = (code, signal) => finish(new Error(
      `dashboard startup at ${root}: exited code=${code} signal=${signal}\n${child.capturedStderr}`,
    ));
    const timer = setTimeout(() => finish(new Error(
      `dashboard startup at ${root}: listening banner timed out\n${child.capturedStdout}\n${child.capturedStderr}`,
    )), timeoutMs);
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
    onData();
  });
}

async function stopDashboard(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = once(child, 'exit').then(() => true);
  const stopped = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function fetchChecked(url, expectedType) {
  const response = await fetch(url, { redirect: 'error' });
  assert.equal(response.status, 200, `endpoint ${url}: expected 200, received ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  assert.match(contentType, expectedType, `endpoint ${url}: unexpected content-type ${contentType}`);
  return response;
}

async function main() {
  const port = await reserveLoopbackPort();
  sandboxRoot = mkdtempSync(join(tmpdir(), 'career-ops-sandbox-test-'));
  fixture = createSandboxFixture(sandboxRoot, { port });

  await namedCheck('fixture creation', () => {
    assert.equal(fixture.root, sandboxRoot, 'fixture root: builder returned a different path');
    assert.ok(fixture.files.includes('data/applications.md'), 'fixture files: applications tracker missing');
    assert.ok(fixture.files.includes('node_modules'), 'fixture files: dependency symlink missing');
  });

  await namedCheck('non-destructive output guard', () => {
    const trackerPath = join(sandboxRoot, 'data', 'applications.md');
    const trackerBefore = readFileSync(trackerPath, 'utf8');
    assert.throws(() => createSandboxFixture('relative-sandbox'), /must be absolute/, 'fixture guard: relative path accepted');
    assert.throws(() => createSandboxFixture('/'), /filesystem root/, 'fixture guard: filesystem root accepted');
    assert.throws(() => createSandboxFixture(homedir()), /user home directory/, 'fixture guard: home directory accepted');
    assert.throws(() => createSandboxFixture(SOURCE_ROOT), /repository root/, 'fixture guard: source repository accepted');
    assert.throws(() => createSandboxFixture(join(SOURCE_ROOT, 'sandbox-output')), /repository root/, 'fixture guard: repository descendant accepted');
    assert.throws(() => createSandboxFixture(sandboxRoot, { port: 0 }), /port must be an integer/, 'fixture guard: invalid port accepted');
    assert.throws(() => createSandboxFixture(sandboxRoot), /non-empty/, 'fixture guard: existing fixture accepted');
    assert.equal(readFileSync(trackerPath, 'utf8'), trackerBefore, 'fixture guard: existing tracker was mutated');
  });

  await namedCheck('doctor readiness', async () => {
    const result = await runCommand(process.execPath, [join(SOURCE_ROOT, 'doctor.mjs'), '--target', sandboxRoot], 'doctor');
    assert.equal(result.code, 0, `doctor stage: exit ${result.code}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Result: All checks passed\./, `doctor stage: all-checks result missing\n${result.stdout}`);
  });

  await namedCheck('onboarding readiness', () => {
    const onboarding = validateOnboarding(sandboxRoot);
    assert.equal(onboarding.valid, true, `onboarding stage: ${JSON.stringify(onboarding.blockers)}`);
  });

  await namedCheck('lifecycle stop-before-submit', () => {
    const input = {
      root: sandboxRoot,
      job: {
        url: 'https://jobs.example.invalid/demo-role',
        company: 'Demo Company',
        role: 'Demo Engineer',
      },
      mode: 'demo',
    };
    const before = structuredClone(input);
    const lifecycle = runLifecycle(input);
    assert.deepEqual(input, before, 'lifecycle stage: input object was mutated');
    for (const stage of ['discover', 'verify', 'evaluate', 'decide', 'tailor', 'review', 'track']) {
      assert.equal(
        lifecycle.stages.find((entry) => entry.stage === stage)?.state,
        'simulated',
        `lifecycle stage ${stage}: expected simulated`,
      );
    }
    assert.equal(lifecycle.stages.find((entry) => entry.stage === 'apply')?.state, 'blocked', 'lifecycle stage apply: expected blocked');
    assert.ok(lifecycle.blockerCodes.includes('submission_forbidden'), 'lifecycle stage apply: submission_forbidden missing');
    assert.equal(lifecycle.submissionAllowed, false, 'lifecycle stage apply: submission must remain forbidden');
  });

  const payload = await namedCheck('dashboard projection', async () => {
    const options = { rootPath: sandboxRoot, asOf: '2026-08-12', linkMode: 'local' };
    const before = structuredClone(options);
    const result = await buildDashboardPayload(options);
    assert.deepEqual(options, before, 'dashboard projection: options object was mutated');
    assert.equal(result.apps.length, 2, 'dashboard projection: expected two synthetic applications');
    assert.equal(result.pending.count, 1, 'dashboard projection: expected one pending pipeline item');
    assert.deepEqual(new Set(result.apps.map((app) => app.company)), new Set(['Example Robotics', 'Fictional Transit Labs']), 'dashboard projection: synthetic companies missing');
    assert.deepEqual(new Set(result.apps.map((app) => app.role)), new Set(['Demo Platform Engineer', 'Demo Systems Engineer']), 'dashboard projection: synthetic roles missing');
    assert.ok(result.apps.every((app) => app.reportUrl?.startsWith('/file/reports/')), 'dashboard projection: local report URLs were not resolved');
    return result;
  });

  dashboardServer = startDashboard(sandboxRoot, port);
  await waitForListening(dashboardServer, sandboxRoot);

  await namedCheck('dashboard API route', async () => {
    const url = `http://127.0.0.1:${port}/api/apps`;
    const response = await fetchChecked(url, /application\/json/i);
    const apiPayload = await response.json();
    assert.equal(apiPayload.apps.length, 2, `endpoint ${url}: expected two applications`);
    assert.deepEqual(apiPayload.apps.map((app) => app.company), payload.apps.map((app) => app.company), `endpoint ${url}: tracker rows differ from direct projection`);
  });

  await namedCheck('dashboard HTML route', async () => {
    const url = `http://127.0.0.1:${port}/terminal`;
    const response = await fetchChecked(url, /text\/html/i);
    const html = await response.text();
    assert.match(html, /<title>Plainhand Dashboard<\/title>/, `endpoint ${url}: dashboard title missing`);
  });

  await namedCheck('dashboard report route', async () => {
    const url = `http://127.0.0.1:${port}/file/reports/001-example-robotics.md`;
    const response = await fetchChecked(url, /text\/markdown/i);
    const markdown = await response.text();
    assert.equal(markdown, readFileSync(join(sandboxRoot, 'reports', '001-example-robotics.md'), 'utf8'), `endpoint ${url}: report content differs`);
  });

  await namedCheck('browser rendering', async () => {
    const url = `http://127.0.0.1:${port}/terminal`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#appRows tr', { timeout: 10_000 });
    assert.equal(await page.title(), 'Plainhand Dashboard', `browser endpoint ${url}: page title mismatch`);
    assert.equal((await page.locator('h1').textContent())?.trim(), 'Plainhand Dashboard', `browser endpoint ${url}: heading mismatch`);
    const bodyText = await page.locator('body').innerText();
    assert.match(bodyText, /Example Robotics/, `browser endpoint ${url}: synthetic company missing`);
    assert.ok(await page.locator('#appRows tr').count() >= 1, `browser endpoint ${url}: tracker rows missing`);
    await page.close();
    await browser.close();
    browser = null;
  });

  console.log('sandbox integration: passed');
}

try {
  await main();
} catch (error) {
  console.error('sandbox integration: failed');
  console.error(`sandbox root: ${sandboxRoot ?? '(not created)'}`);
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopDashboard(dashboardServer).catch((error) => {
    console.error(`dashboard shutdown at ${sandboxRoot}: ${error.message}`);
    process.exitCode = 1;
  });
  if (sandboxRoot && keep) {
    console.log(`retained sandbox root: ${sandboxRoot}`);
    console.log(`dashboard command: ${fixture?.viewCommands.dashboardServer ?? '(unavailable)'}`);
  } else if (sandboxRoot) {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}
