// Browser test of the in-app assistant: working-state items 1–4 of
// docs/AGENT-BUILD-PLAN.md, driven through the real server, the real agent
// engine and a scripted fixture agent. No live model and no real employer.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createPlainhand } from './plainhand-server.mjs';
import { digest } from './plainhand/store.mjs';
import { candidate, fixtureProviders, scriptedAgent } from './plainhand/test-fixtures.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'plainhand-agent-ui-'));
const shots = process.env.PLAINHAND_AGENT_UI_OUTPUT || (process.env.PLAINHAND_UI_OUTPUT ? path.join(process.env.PLAINHAND_UI_OUTPUT, 'assistant') : await mkdtemp(path.join(tmpdir(), 'plainhand-agent-ui-evidence-')));
await mkdir(shots, { recursive: true });
console.log(`Assistant evidence: ${shots}`);

const JOB = { company: 'Acme Robotics', title: 'Graduate Engineer', url: 'https://jobs.lever.co/acme/42' };
const VERIFIED_TEXT = 'This is an engineering role designing and testing hardware. '.repeat(10);
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return iso(d); };
const friday = (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return iso(d); })();
const find = data => data.digest.jobs.find(j => j.company === JOB.company);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const STREAMED = ['This week you have ', 'one thing due: ', 'send references to Dana ', `by ${friday}.`];

const scripted = scriptedAgent([
  { match: /jobs\.lever\.co/, reply: { say: 'I can save Acme Robotics — Graduate Engineer for you.', actions: [{ name: 'jobs.add', input: { ...JOB, location: 'Boston' } }] } },
  { match: /^evaluate it/i, reply: data => ({ say: 'I can evaluate it against your evidence.', actions: [{ name: 'tasks.evaluate', input: { jobId: find(data).id } }] }) },
  { match: /why that score/i, reply: data => ({ say: '', actions: [{ name: 'jobs.get', input: { jobId: find(data).id } }] }) },
  { match: /why that score/i, reply: data => {
    const read = JSON.parse(data.results.find(r => r.name === 'jobs.get').result);
    return { say: `It scored ${read.evaluation.score}/5 because ${read.evaluation.summary.toLowerCase()} The gap: ${read.evaluation.gaps[0]}`, actions: [] };
  } },
  { match: /choose it/i, reply: data => ({ say: 'I can choose it for your applications.', actions: [{ name: 'jobs.select', input: { jobId: find(data).id, selected: true } }] }) },
  { match: /prepare it/i, reply: data => ({ say: 'I can prepare the packet.', actions: [{ name: 'tasks.prepare', input: { jobId: find(data).id } }] }) },
  { match: /approve it/i, reply: data => ({ say: 'Only you can approve it. I opened the packet so you can read it.', actions: [{ name: 'packet.approve', input: { jobId: find(data).id } }, { name: 'ui.openPanel', input: { type: 'packet', id: find(data).id } }] }) },
  { match: /screen with Dana/i, reply: data => ({ say: 'Here is what I would record from that screen.', actions: [
    { name: 'record.addInterview', input: { jobId: find(data).id, stage: 'Recruiter screen', date: day(0), status: 'completed', interviewer: 'Dana' } },
    { name: 'record.addContact', input: { jobId: find(data).id, name: 'Dana', role: 'Recruiter', type: 'recruiter' } },
    { name: 'record.setNextAction', input: { jobId: find(data).id, text: 'Send references to Dana', due: friday } },
  ] }) },
  { match: /posting say about testing/i, reply: data => ({ say: '', actions: [{ name: 'jobs.get', input: { jobId: find(data).id, include: ['description'] } }] }) },
  { match: /posting say about testing/i, reply: data => ({ say: 'The posting stresses hardware testing. I can add a reminder to prepare a testing story.', actions: [{ name: 'record.setNextAction', input: { jobId: find(data).id, text: 'Prepare a hardware testing story', due: friday } }] }) },
  { match: /due this week/i, reply: { say: STREAMED.join(''), actions: [], stream: STREAMED } },
  { match: /long cover note/i, wait: signal => new Promise((resolve, reject) => { signal?.addEventListener('abort', () => reject(new Error('Canceled.'))); }), reply: { say: 'Never sent.', actions: [] } },
  { match: /remind me to follow up/i, reply: data => ({ say: 'I can set that reminder.', actions: [{ name: 'record.setNextAction', input: { jobId: find(data).id, text: 'Follow up with Dana', due: day(7) } }] }) },
]);
// Streams the scripted `stream` pieces through onText, as Claude does, before returning the reply.
const agent = async (id, instruction, data, options = {}) => {
  const reply = await scripted(id, instruction, data, options);
  if (reply && Array.isArray(reply.stream)) {
    for (const piece of reply.stream) { options.onText?.(piece); await sleep(250); }
    return { say: reply.say, actions: reply.actions };
  }
  return reply;
};

const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
  agent,
  verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: VERIFIED_TEXT, checkedAt: new Date().toISOString(), reason: 'Fixture browser verification.' }),
  renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
} });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
{
  const state = await app.workspace.load();
  await app.workspace.saveProfile(candidate, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
}
const loadJob = async () => (await app.workspace.load()).jobs.find(j => j.company === JOB.company);

let browser;
const errors = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'light' });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && !/400 \(Bad Request\)/.test(message.text())) errors.push(message.text()); });
  // Full-page captures use a viewport as tall as the page, so sticky parts (header, composer) sit where they belong.
  const shot = async name => {
    const size = page.viewportSize();
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: size.width, height: Math.min(height, 12000) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(shots, name) });
    await page.setViewportSize(size);
  };
  const thread = page.locator('section.assistant');
  const log = thread.getByRole('log', { name: 'Conversation with Plainhand' });
  const composer = page.getByRole('textbox', { name: 'Message Plainhand' });
  const lastProposal = () => thread.locator('section.proposal').last();
  const idle = () => thread.getByRole('button', { name: 'Send', exact: true }).waitFor();
  // Replies are matched only among messages that appeared after the last mark.
  let seen = [];
  const mark = async () => { seen = await log.locator('.entry').evaluateAll(nodes => nodes.map(n => n.dataset.id)); };
  async function say(text) {
    await mark();
    await composer.fill(text);
    await composer.press('Enter');
    await log.getByText(text, { exact: true }).waitFor();
  }
  const reply = text => page.waitForFunction(([text, seen]) => [...document.querySelectorAll('section.assistant .entry.from-assistant')].some(n => !seen.includes(n.dataset.id) && n.textContent.includes(text)), [text, seen], { timeout: 15000 });
  const decide = async button => { await mark(); await button.click(); };

  // (1) A fresh workspace with a connected account opens on the briefing and the assistant.
  await page.goto(base);
  await page.getByRole('heading', { name: 'Today’s briefing' }).waitFor();
  await composer.waitFor();
  assert.ok(await thread.locator('.suggestion').count() >= 2, 'Suggested prompts are offered.');
  const suggestion = thread.locator('.suggestion').first();
  const suggested = await suggestion.innerText();
  await suggestion.click();
  assert.equal(await composer.inputValue(), suggested, 'A suggestion fills the composer.');
  assert.equal(await log.locator('.message').count(), 0, 'A suggestion never sends by itself.');
  await composer.fill('');
  await shot('01-home-assistant-empty.png');

  // (2) By conversation: save, evaluate, discuss, choose, prepare; the candidate approves and confirms.
  await say(`Can you save this one? ${JOB.url}`);
  await reply('I can save Acme Robotics');
  const save = lastProposal();
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('proposal')), true, 'Focus moves to a new proposal.');
  await save.getByText('Save a job').waitFor();
  assert.equal(await loadJob(), undefined, 'Nothing is saved before the candidate confirms.');
  await decide(save.getByRole('button', { name: 'Save: Save a job' }));
  await save.getByText('Confirmed by you.').waitFor();
  await reply('Saved that change.');
  assert.ok(await loadJob(), 'The job is saved after confirmation.');
  await idle();

  await say('evaluate it please');
  await reply('I can evaluate it');
  await decide(lastProposal().getByRole('button', { name: 'Start: Evaluate a role' }));
  await thread.locator('.task-card.tone-success').first().waitFor({ timeout: 20000 });
  assert.equal((await loadJob()).evaluation.score, 4.4);
  await idle();

  await say('why that score?');
  await reply('It scored 4.4/5');
  assert.equal(await thread.locator('section.proposal').count(), 2, 'Answering a question proposes nothing.');

  await say('ok, choose it');
  await reply('I can choose it');
  await decide(lastProposal().getByRole('button', { name: 'Save: Choose or unchoose a role' }));
  await reply('Saved that change.');
  assert.equal((await loadJob()).selected, true);
  await idle();

  await say('now prepare it');
  await reply('I can prepare the packet');
  await decide(lastProposal().getByRole('button', { name: 'Start: Prepare the application' }));
  await thread.locator('.task-card.tone-success').nth(1).waitFor({ timeout: 20000 });
  assert.ok((await loadJob()).packet, 'The packet is prepared.');
  await idle();
  await shot('02-conversation-light.png');

  await say('approve it for me');
  await reply('Only you can approve it');
  const panel = page.locator('aside.context');
  await panel.getByRole('heading', { name: 'Resume preview', exact: true }).waitFor();
  assert.equal(await panel.getByRole('tab', { name: 'Packet', exact: true }).getAttribute('aria-selected'), 'true', 'agent.panel opens the packet.');
  assert.equal((await loadJob()).approvedHash ?? null, null, 'The agent cannot approve a packet.');
  await panel.locator('#review-confirm').check();
  await panel.getByRole('button', { name: 'Approve this packet' }).click();
  await panel.getByText('You approved this exact packet.').waitFor();
  await panel.getByRole('button', { name: 'Continue to the application form' }).click();
  await panel.getByRole('button', { name: 'I submitted this application' }).click();
  await page.getByRole('button', { name: 'Yes, I submitted it' }).click();
  await page.getByRole('status').filter({ hasText: 'Application recorded.' }).waitFor();
  assert.equal((await loadJob()).status, 'Applied', 'Applied comes only from the candidate’s confirmation.');
  await panel.getByRole('button', { name: 'Close panel' }).click();

  // (3) One sentence becomes one grouped proposal; edit, save all, check the record, undo.
  await say('Had the screen with Dana today, she wants references Friday');
  await reply('Here is what I would record');
  const dana = lastProposal();
  assert.equal(await dana.locator('.proposal-actions > li').count(), 3, 'One card with three changes.');
  await dana.getByRole('button', { name: 'Edit: 3 changes' }).click();
  const nextText = dana.getByRole('textbox', { name: 'What happens next?' });
  await nextText.fill('Send two references to Dana');
  await nextText.press('Escape');
  assert.equal(await dana.getByRole('textbox', { name: 'What happens next?' }).count(), 0, 'Escape cancels editing.');
  await dana.getByRole('button', { name: 'Edit: 3 changes' }).click();
  await dana.getByRole('textbox', { name: 'What happens next?' }).fill('Send two references to Dana');
  await shot('03-proposal-editing.png');
  await decide(dana.getByRole('button', { name: 'Save all 3 changes' }));
  await dana.getByText('Saved with your edits.').waitFor();
  await reply('Saved all 3 changes.');
  let job = await loadJob();
  assert.equal(job.record.nextAction.text, 'Send two references to Dana', 'Edit changes the saved value.');
  assert.equal(job.record.nextAction.due, friday);
  assert.equal(job.record.contacts.length, 1);
  assert.equal(job.record.interviews.length, 1);
  assert.equal(job.status, 'Applied', 'Recording an interview never changes the status.');
  await page.getByRole('button', { name: 'Graduate Engineer', exact: true }).first().click();
  await panel.getByRole('tab', { name: 'Record', exact: true }).click();
  await panel.getByText('Send two references to Dana', { exact: true }).waitFor();
  await panel.getByText('Dana · Recruiter', { exact: true }).waitFor();
  await panel.locator('.record-list strong', { hasText: 'Recruiter screen' }).waitFor();
  await shot('04-record-after-save.png');
  await decide(dana.getByRole('button', { name: 'Undo: 3 changes' }));
  await page.getByRole('status').filter({ hasText: 'Undone.' }).waitFor();
  await panel.getByText('No contacts recorded.').waitFor();
  job = await loadJob();
  assert.equal(job.record.contacts.length, 0, 'Undo removes the contact.');
  assert.equal(job.record.interviews.length, 0, 'Undo removes the interview round.');
  assert.ok(!job.record.nextAction, 'Undo removes the next action.');
  await panel.getByRole('button', { name: 'Close panel' }).click();
  await reply('Undone.');

  // A proposal built after reading the posting carries the taint notice.
  await say('What does the posting say about testing?');
  await reply('The posting stresses hardware testing');
  await lastProposal().getByText('Includes text from:', { exact: false }).waitFor();
  assert.match(await lastProposal().locator('.proposal-taint').innerText(), /Acme Robotics/);
  await lastProposal().getByRole('button', { name: 'Decline: Set next action' }).click();
  await lastProposal().getByText('Nothing was changed.').waitFor();
  assert.ok(!(await loadJob()).record.nextAction, 'Declining saves nothing.');
  await idle();

  // (4) "What's due this week?" streams its answer and proposes nothing.
  // First set the reminder it talks about, through the record panel.
  await app.registry.run('record.setNextAction', { jobId: (await loadJob()).id, text: 'Send references to Dana', due: friday });
  const proposalsBefore = await thread.locator('section.proposal').count();
  await say('What’s due this week?');
  await log.locator('.message.streaming').filter({ hasText: 'This week you have' }).waitFor({ timeout: 5000 });
  const partial = await log.locator('.message.streaming .message-text').innerText();
  assert.ok(partial.length < STREAMED.join('').length, 'Text arrives in pieces before the final message.');
  assert.equal(await log.locator('.message.streaming .message-text').getAttribute('aria-hidden'), 'true', 'Streaming text is not re-announced per token.');
  await reply(STREAMED.join(''));
  await log.locator('.message.streaming').waitFor({ state: 'detached' });
  assert.equal(await thread.locator('section.proposal').count(), proposalsBefore, 'The answer proposes nothing.');
  await idle();

  // Stop cancels a reply in progress.
  await say('Write me a long cover note');
  await decide(thread.getByRole('button', { name: 'Stop' }));
  await reply('Stopped. Nothing was changed.');
  await idle();

  // Reload keeps the history, and a pending card still works.
  await say('remind me to follow up next week');
  await reply('I can set that reminder');
  await page.reload();
  await composer.waitFor();
  await log.getByText('Had the screen with Dana today, she wants references Friday', { exact: true }).waitFor();
  const pending = thread.locator('section.proposal.status-pending');
  assert.equal(await pending.count(), 1, 'Only the undecided proposal is still actionable after reload.');
  assert.ok(await thread.locator('section.proposal.status-accepted').count() >= 3, 'Decided proposals render as resolved.');
  await decide(pending.getByRole('button', { name: 'Save: Set next action' }));
  await reply('Saved that change.');
  assert.equal((await loadJob()).record.nextAction.text, 'Follow up with Dana');
  await idle();
  await shot('05-conversation-full-light.png');

  // Dark theme and mobile.
  await page.evaluate(() => window.plainhandTheme.set('dark'));
  await shot('06-conversation-dark.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await composer.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The thread fits a phone screen.');
  await page.screenshot({ path: path.join(shots, '07-mobile-thread-dark.png') });
  await page.evaluate(() => window.plainhandTheme.set('light'));
  await page.screenshot({ path: path.join(shots, '08-mobile-thread-light.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Clearing the conversation asks first, then empties the thread.
  await page.goto(base + '#workspace');
  await page.getByRole('button', { name: 'Clear conversation' }).click();
  await page.getByRole('dialog', { name: 'Clear the conversation?' }).getByRole('button', { name: 'Clear conversation' }).click();
  await page.getByRole('status').filter({ hasText: 'Conversation cleared.' }).waitFor();
  await page.goto(base + '#home');
  await composer.waitFor();
  assert.equal(await log.locator('.message').count(), 0, 'The cleared thread is empty.');
  assert.equal((await app.agent.history()).messages.length, 0);

  // Without a connected account the composer is not offered.
  await app.workspace.mutate(s => { s.provider = null; });
  await page.reload();
  await page.getByRole('button', { name: 'Connect an account' }).waitFor();
  assert.equal(await composer.count(), 0, 'No composer without a connected account.');

  assert.deepEqual(errors, [], 'No browser or CSP errors');
  assert.equal(scripted.remaining(), 0, 'Every scripted reply was used.');
  await writeFile(path.join(shots, 'assistant-proof.json'), JSON.stringify({ checkedAt: new Date().toISOString(), items: ['fresh workspace opens on briefing and assistant', 'conversation: save, evaluate, explain, choose, prepare; candidate approves in the panel and confirms Applied', 'one sentence → one grouped proposal → edit → save all → record → undo', 'streamed answer with no proposal'], also: ['taint notice', 'decline', 'stop', 'reload keeps history and pending card', 'clear conversation', 'no composer without provider', 'light, dark, mobile'], model: 'scripted fixture agent', browserErrors: errors }, null, 2));
  console.log('Plainhand assistant browser test passed: briefing and thread, conversational workflow with candidate-only approval and confirmation, grouped proposal with edit and undo, streaming, taint, stop, reload and clear.');
} catch (error) {
  const failed = browser?.contexts()[0]?.pages()[0];
  if (failed) { await failed.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(path.join(shots, 'failure.txt'), await failed.locator('body').innerText().catch(() => 'Page unavailable')); }
  throw error;
} finally { await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
