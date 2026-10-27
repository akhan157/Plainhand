/** Profile-building benchmark: how well the assistant builds a candidate profile by
 * conversation. A simulated candidate (fictional, deterministic) answers the
 * assistant; every proposal is accepted as a cooperative candidate would.
 *
 *   node benchmark-profile.mjs                      scripted fixture: checks the harness, not quality
 *   node benchmark-profile.mjs --provider claude    real CLI on your account (about 3 × 8 turns)
 *   options: --personas mech-grad,quiet-junior  --turns 6
 *
 * Measures: facts captured in the candidate's own words, verbatim fidelity,
 * unsupported profile updates, questions per turn, model calls, tokens, time, and
 * profile strength before and after. It cannot judge how well the profile reads.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { emptyProfile } from './plainhand/store.mjs';
import { profileStrength } from './plainhand/profile-strength.mjs';
import { fixtureProviders, fixtureAgent } from './plainhand/test-fixtures.mjs';
import { personas, simulatedCandidate, scoreRun } from './plainhand/benchmarks/profile-bench.mjs';

const option = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const provider = option('provider', null);
const maxTurns = Number(option('turns', 8));
const chosen = option('personas', null)?.split(',') || personas.map(p => p.id);
const FIXTURE_QUESTIONS = ['What project are you proudest of, and what did you do on it?', 'What did you do in your last job or internship?', 'Which tools or skills do you use most?', 'What kind of role are you looking for next?', 'How would you like your writing to sound?', 'Have you led or coordinated other people?', 'What was the hardest problem you solved?'];

// Scripted stand-in for a provider: asks fixed questions and saves each answer verbatim.
function fixtureAssistant() {
  let asked = 0;
  return async (id, instruction, data) => {
    if (!instruction.startsWith('Act as the conversational assistant')) return fixtureAgent(id, instruction, data);
    const say = FIXTURE_QUESTIONS[asked++ % FIXTURE_QUESTIONS.length];
    const save = data.message.length > 40 && !/everything I can think of/.test(data.message);
    return { say, actions: save ? [{ name: 'profile.addStory', input: { text: data.message } }] : [] };
  };
}

async function runPersona(persona) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-profile-bench-'));
  const app = await createPlainhand(provider ? { root } : { root, providers: fixtureProviders, workflowOptions: { agent: fixtureAssistant() } });
  const started = Date.now();
  try {
    const state = await app.workspace.load();
    await app.workspace.saveProfile({ ...emptyProfile(), ...persona.profile }, state.revision);
    await app.workspace.mutate(s => { s.provider = provider || 'codex'; });
    const before = profileStrength(await app.workspace.load());
    const candidate = simulatedCandidate(persona);
    const candidateMessages = [], turns = [], updates = [], actionsRun = [];
    let message = 'Help me build my profile.';
    for (let i = 0; i < maxTurns; i++) {
      candidateMessages.push(message);
      const turnStarted = Date.now();
      const { turnId } = await app.agent.message(message);
      await app.agent.running;
      const history = await app.agent.history({ limit: 200 });
      const reply = history.messages.filter(m => m.turnId === turnId && m.role === 'assistant').at(-1);
      const turn = { say: reply?.text || '', status: reply?.status || 'missing', actions: [], ms: Date.now() - turnStarted };
      const proposal = reply?.proposalId && history.proposals.find(p => p.id === reply.proposalId);
      if (proposal?.status === 'pending') {
        turn.actions = proposal.actions.map(a => a.name); actionsRun.push(...turn.actions);
        for (const a of proposal.actions) if (a.name === 'profile.update') for (const [field, value] of Object.entries(a.input || {})) updates.push({ field, value: String(value) });
        await app.agent.confirm({ proposalId: proposal.id, accept: true });
        await app.workflow.queue;
      }
      const answer = candidate.reply(turn.say);
      turn.onTopic = answer.onTopic;
      turns.push(turn);
      if (answer.done) break;
      message = answer.text;
    }
    const after = await app.workspace.load();
    const saved = after.conversation.filter(m => m.role === 'user' && m.via === 'assistant').map(m => m.text);
    const usage = await app.workflow.usage.summary(after);
    const strength = profileStrength(after);
    return { ...scoreRun({ persona, candidateMessages, saved, updates, turns, revealed: candidate.said, detailsRevealed: candidate.detailed }),
      actions: actionsRun, calls: usage.totals.calls, inputTokens: usage.totals.inputTokens.value, outputTokens: usage.totals.outputTokens.value,
      seconds: Math.round((Date.now() - started) / 100) / 10, understandingBuilt: Boolean(after.understanding),
      depthBefore: before.depth, depthAfter: strength.depth, saved, updates, next: strength.next.map(n => n.text), transcript: turns.map((t, i) => ({ assistant: t.say, status: t.status, actions: t.actions, candidate: candidateMessages[i + 1] || null })) };
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}

const results = [];
for (const persona of personas.filter(p => chosen.includes(p.id))) {
  const result = await runPersona(persona);
  results.push(result);
  console.log(`${result.persona}: captured ${result.captured}/${result.revealed} revealed facts (${result.facts} total) · follow-ups ${result.followUps}, details saved ${result.detailsCaptured} · not verbatim ${result.notVerbatim} · unsupported updates ${result.unsupportedUpdates.length} · ${result.turns} turns, ${result.oneQuestionTurns} with one question · ${result.calls ?? '?'} calls · ${result.seconds}s`);
}
const sum = key => results.reduce((n, r) => n + (r[key] || 0), 0);
const aggregate = { personas: results.length, captureRate: sum('revealed') ? Math.round(sum('captured') / sum('revealed') * 100) / 100 : null, notVerbatim: sum('notVerbatim'),
  unsupportedUpdates: results.reduce((n, r) => n + r.unsupportedUpdates.length, 0), absentClaimsSaved: results.reduce((n, r) => n + r.absentClaimsSaved.length, 0),
  oneQuestionShare: sum('turns') ? Math.round(sum('oneQuestionTurns') / sum('turns') * 100) / 100 : null, calls: sum('calls'), seconds: Math.round(sum('seconds')) };
const directory = path.join('output', `profile-benchmark-${provider || 'fixture'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'results.json'), JSON.stringify({ date: new Date().toISOString(), provider: provider || 'fixture', maxTurns,
  evidenceTier: provider ? 'real CLI assistant, simulated deterministic candidate, fictional personas' : 'scripted fixture: verifies the harness and scoring only', aggregate, results }, null, 2));
console.log(`\nCapture ${aggregate.captureRate} · not verbatim ${aggregate.notVerbatim} · unsupported updates ${aggregate.unsupportedUpdates} · absent claims saved ${aggregate.absentClaimsSaved} · one-question turns ${aggregate.oneQuestionShare}`);
console.log('Evidence: ' + directory);
