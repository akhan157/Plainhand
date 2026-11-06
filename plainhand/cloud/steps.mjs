// Model steps for the hosted connector (docs/HOSTED-CONNECTOR-PLAN.md §4).
//
// The chat app (ChatGPT, Claude) does the model work. A task runs through the normal
// Workflow with a deferred agent: each model call the workflow makes becomes a step
// keyed by (taskId, call index) with digest = sha256(instruction + JSON(data)).
//
// Stateless replay: start/submit/current re-run the task from the beginning with a fresh
// Workflow. Recorded results answer their calls (only when the digest matches); the first
// unrecorded call becomes the pending step and the run stops there (TaskPaused), so
// nothing is committed until every step is answered. Posting verification and job-board
// results are cached in the step file, so a replay never fetches them again; PDFs are
// rendered and results committed only by the pass that finishes the task.
//
// Step records live at data/plainhand/steps/<taskId>.json in the candidate's workspace.
import { createHash } from 'node:crypto';
import { TaskPaused } from '../workflow.mjs';
import { AGENT_PREAMBLE, INTERVIEW_INSTRUCTION, EVALUATE_INSTRUCTION, PACKET_INSTRUCTION, REVIEW_INSTRUCTION, STANDARD_INSTRUCTION, FORM_INSTRUCTION } from '../agents.mjs';
import { HUMANIZE_INSTRUCTION } from '../humanize.mjs';

export const STEP_TTL_MS = 2 * 60 * 60 * 1000;
// How many times the chat may resubmit a rejected result for one step before the task fails.
export const MAX_STEP_ATTEMPTS = 3;
// A submit that is still being checked holds the step this long against a duplicate submit.
const CLAIM_MS = 60 * 1000;
export const TASK_KINDS = ['interview', 'evaluate', 'prepare', 'standard', 'revise', 'discover'];
export const CONNECTOR_PROVIDER = 'connector';
const stepFile = taskId => `data/plainhand/steps/${taskId}.json`;
const validTaskId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

export const stepDigest = (instruction, data) => createHash('sha256').update(instruction + JSON.stringify(data)).digest('hex');

// ── Result schemas: the documented output shape of each instruction, as JSON Schema ──
const str = { type: 'string' };
const strs = { type: 'array', items: str };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const evidence = { type: 'array', minItems: 1, description: 'At least one exact quote (8+ characters, copied character for character) from INPUT.context.sources, with that source\'s id.', items: obj({ sourceId: str, quote: { type: 'string', minLength: 8 } }) };
const resumeEntry = obj({
  section: str,
  heading: { anyOf: [obj({ org: str, title: str, location: str, dates: str }), { type: 'null' }], description: 'The job, project or school this line belongs to, copied exactly from the sources ("" where they are silent); null for skills or summary lines.' },
  text: str, evidence,
});
export const RESULT_SCHEMAS = new Map([
  [INTERVIEW_INSTRUCTION, obj({ summary: str, strengths: strs, voice: str, questions: { ...strs, maxItems: 3 }, sampleAnswer: str, gaps: strs })],
  [EVALUATE_INSTRUCTION, obj({ score: { type: 'number', minimum: 0, maximum: 5 }, recommendation: { type: 'string', enum: ['Apply', 'Investigate', 'Skip'] }, summary: str, matches: { type: 'array', items: obj({ text: str, evidence }) }, gaps: strs, questions: strs, legitimacyNotes: strs })],
  [PACKET_INSTRUCTION, obj({ headline: str, resume: { type: 'array', minItems: 1, items: resumeEntry }, coverLetter: str, answers: { type: 'array', items: obj({ question: str, answer: str, evidence }) }, questions: strs, suggestions: strs })],
  [STANDARD_INSTRUCTION, obj({ headline: str, resume: { type: 'array', minItems: 1, items: resumeEntry }, coverLetter: str, suggestions: strs })],
  [REVIEW_INSTRUCTION, obj({ passed: { type: 'boolean' }, issues: strs, calibration: { type: 'array', items: obj({ id: str, claim: str, rating: { type: 'string', enum: ['undersold', 'balanced', 'stretched', 'unsupported'] }, kind: { type: 'string', enum: ['ownership', 'level', 'numbers', 'rounding', 'scope', 'motivation', 'results', 'verifiable', 'other'] }, reason: str, suggestion: str }) } }, ['passed', 'issues'])],
  [HUMANIZE_INSTRUCTION, obj({ items: { type: 'array', items: obj({ id: str, text: str }) }, remaining: strs })],
  [FORM_INSTRUCTION, obj({ suggestions: { type: 'array', items: obj({ key: str, answer: str, evidence }) }, questions: { type: 'array', items: obj({ key: str, question: str }) } })],
]);
const PURPOSES = new Map([[INTERVIEW_INSTRUCTION, 'interview'], [EVALUATE_INSTRUCTION, 'evaluate'], [PACKET_INSTRUCTION, 'packet'], [STANDARD_INSTRUCTION, 'standard'], [REVIEW_INSTRUCTION, 'review'], [HUMANIZE_INSTRUCTION, 'humanize'], [FORM_INSTRUCTION, 'form']]);
const LEADS = {
  interview: 'Read the candidate\'s profile and interview so far, then write their profile summary and the follow-up questions.',
  evaluate: 'Judge how well this job fits the candidate, using only their evidence.',
  packet: 'Write the candidate\'s resume, cover letter and answers for this job.',
  standard: 'Write the candidate\'s standard resume and cover letter.',
  humanize: 'Rewrite the wording of each item so it reads like the candidate wrote it.',
  review: 'Fact-check this application as an independent reviewer. Judge only INPUT.packet against the quoted sources in INPUT.context.sources and the job in INPUT.job, independently of any earlier drafting: if you or this chat wrote the draft earlier, ignore that work and anything you remember about it, and check each claim afresh against the sources. Plainhand also checks every quote itself; it cannot be argued past.',
  form: 'Draft answers for these application form fields.',
  model: 'Do the task below.',
};
export const purposeOf = instruction => PURPOSES.get(instruction) || 'model';
export const resultSchemaFor = instruction => RESULT_SCHEMAS.get(instruction) || { type: 'object' };

// The text the chat model works from: the same safety preamble as a local provider call.
export function stepInstruction(instruction) {
  const purpose = purposeOf(instruction);
  return `${AGENT_PREAMBLE}\n\nIn this chat, "respond" means: pass that single JSON object as \`result\` to submit_step. Apart from that one call, the rules above apply to this step: do not browse, read files or call other tools for it, and use only the INPUT DATA of this step.\n\n${LEADS[purpose]}\n\nTASK:\n${instruction}`;
}

const website = { job: id => `/?job=${encodeURIComponent(id)}#applications`, packet: id => `/?job=${encodeURIComponent(id)}&tab=packet#applications`, profile: () => '/#profile', jobs: () => '/#jobs' };

export function createStepRunner({ workspace, makeWorkflow, now = () => Date.now() } = {}) {
  if (!workspace || typeof makeWorkflow !== 'function') throw new Error('createStepRunner needs a workspace and makeWorkflow.');
  const clock = () => Number(now());
  const iso = () => new Date(clock()).toISOString();

  async function loadRecord(taskId) {
    if (!validTaskId(taskId)) return null;
    const raw = await workspace.read(stepFile(taskId));
    return raw ? JSON.parse(raw) : null;
  }
  const saveRecord = record => workspace.write(stepFile(record.taskId), JSON.stringify({ ...record, updatedAt: iso() }));

  // One replay of the task. `create` enqueues it first (start); otherwise the existing task re-runs.
  async function pass(record, create = null) {
    const calls = { index: 0, last: null, paused: null, events: [] };
    let progressDepth = 0;
    const workflow = makeWorkflow(async () => { throw new Error('Deferred agent not installed.'); });
    workflow.defaultProvider = CONNECTOR_PROVIDER;
    // Autonomy (preparing strong matches on its own) needs a provider; through the connector
    // the chat starts prepare itself.
    workflow.autoPrepare = async () => {};
    // The deferred agent. Bypasses the usage ledger: a replayed answer is not a provider call.
    workflow.agent = async (provider, instruction, data) => {
      const index = calls.index++, digest = stepDigest(instruction, data);
      calls.events = [];
      const saved = record.steps[index];
      if (saved && saved.digest === digest) { calls.last = { index, instruction, data, digest }; return structuredClone(saved.result); }
      // A recorded result whose input changed (profile edited, posting changed) is never reused.
      if (saved) record.steps.length = index;
      calls.paused = { index, instruction, data, digest };
      throw new TaskPaused('Waiting for the chat to answer a step.');
    };
    // Non-model side effects happen once per task.
    const verifier = workflow.verifier, scanner = workflow.scanner;
    workflow.verifier = async job => {
      record.cache.verifier ||= {};
      if (!Object.hasOwn(record.cache.verifier, job.id)) record.cache.verifier[job.id] = await verifier(job);
      return structuredClone(record.cache.verifier[job.id]);
    };
    workflow.scanner = async (source, filter, location) => {
      record.cache.scanner ||= {};
      const key = JSON.stringify([source.id || source.url || source.name, filter, location]);
      if (!Object.hasOwn(record.cache.scanner, key)) record.cache.scanner[key] = await scanner(source, filter, location);
      return structuredClone(record.cache.scanner[key]);
    };
    // Which saves happened after the last model call: a failure that follows a save (or happens
    // inside one) is about the workspace, not about the chat's last result.
    const progress = workflow.progress.bind(workflow);
    workflow.progress = async (...args) => { progressDepth++; try { return await progress(...args); } finally { progressDepth--; } };
    const base = workflow.workspace;
    workflow.workspace = new Proxy(base, { get(target, key) {
      if (key === 'mutate') return fn => {
        const event = { progress: progressDepth > 0, threw: false };
        calls.events.push(event);
        return target.mutate(async state => { try { return await fn(state); } catch (error) { event.threw = true; throw error; } });
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });

    if (create) {
      const id = await workflow.enqueue(create.kind, create.jobId, create.input);
      await workflow.queue;
      record.taskId = id;
    } else await workflow.run(record.taskId);
    const state = await base.load();
    const task = state.tasks.find(t => t.id === record.taskId);
    // The workflow's own failure save is the last one; any earlier non-progress save counts.
    const saves = calls.events.slice(0, task?.status === 'failed' ? -1 : undefined).filter(e => !e.progress);
    return { calls, state, task, savedSinceCall: saves.length > 0 };
  }

  const stepOf = (record, call) => ({ stepId: `s${call.index}-${call.digest.slice(0, 12)}`, purpose: purposeOf(call.instruction), instruction: stepInstruction(call.instruction), data: call.data, resultSchema: resultSchemaFor(call.instruction) });

  async function setTask(taskId, status, message) {
    await workspace.mutate(state => {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task || task.status === 'canceled') return;
      Object.assign(task, { status, message }, status === 'running' ? { finishedAt: undefined } : { finishedAt: iso() });
    });
  }

  function doneOutcome(record, state) {
    const job = record.jobId ? state.jobs.find(j => j.id === record.jobId) : null;
    const name = job ? `${job.title} at ${job.company}` : 'this role';
    if (record.kind === 'evaluate' && job?.evaluation) return { summary: `${name}: fit ${job.evaluation.score}/5, recommendation ${job.evaluation.recommendation}. The full evaluation is saved in Plainhand.`, link: website.job(job.id) };
    if ((record.kind === 'prepare' || record.kind === 'revise') && job) {
      const open = job.packet?.questions?.length || 0;
      return { summary: open ? `Your application for ${name} is drafted, but it needs ${open === 1 ? 'one answer' : `${open} answers`} from you first. Nothing has been sent.` : `Your application for ${name} is ready to review. Nothing has been sent: read it and approve it on the website.`, link: website.packet(job.id) };
    }
    if (record.kind === 'interview') return { summary: 'Your profile summary and follow-up questions are ready. Read them and approve the summary on your profile page.', link: website.profile() };
    if (record.kind === 'standard') return { summary: 'Your standard resume and cover letter are ready to review. Approve them on your profile page before they are used.', link: website.profile() };
    if (record.kind === 'discover') return { summary: `${state.events.find(e => /^Discovery added/.test(e.text))?.text?.replace(/ No applications were started\.$/, '') || 'Your job sources were checked.'} Nothing was applied to.`, link: website.jobs() };
    return { summary: 'The task finished.', link: '/' };
  }

  const finish = async (record, status, outcome) => { record.status = status; record.pending = null; record.claim = null; record.outcome = outcome; await saveRecord(record); return outcome; };
  const failed = (taskId, error) => ({ status: 'failed', taskId: taskId || null, error });

  // Turns a finished replay into an Outcome and saves the step record.
  async function settle(record, result, submittedIndex = null) {
    const { calls, state, task } = result;
    record.claim = null;
    if (calls.paused) {
      const step = stepOf(record, calls.paused);
      const same = record.pending?.stepId === step.stepId;
      record.pending = { index: calls.paused.index, stepId: step.stepId, digest: calls.paused.digest, purpose: step.purpose, createdAt: same ? record.pending.createdAt : iso(), attempts: same ? record.pending.attempts : 0, lastError: same ? record.pending.lastError : null };
      await saveRecord(record);
      await setTask(record.taskId, 'running', `Waiting for your chat: ${LEADS[step.purpose].split('.')[0].toLowerCase()}.`);
      return { status: 'step', taskId: record.taskId, step };
    }
    if (!task) return finish(record, 'failed', failed(record.taskId, 'This task no longer exists.'));
    if (task.status === 'complete') return finish(record, 'done', { status: 'done', taskId: record.taskId, ...doneOutcome(record, state) });
    if (task.status === 'canceled') return finish(record, 'failed', failed(record.taskId, 'This task was canceled. Saved work is kept.'));
    const message = task.message || 'The task failed.';
    // The workflow rejected the result the chat just sent (schema, exact quotes, evidence):
    // the same step comes back with what to fix, within the attempt limit.
    const rejected = submittedIndex !== null && calls.last?.index === submittedIndex && !result.savedSinceCall;
    if (rejected) {
      record.steps.length = submittedIndex;
      const attempts = (record.pending?.attempts || 0) + 1;
      if (attempts >= MAX_STEP_ATTEMPTS) return finish(record, 'failed', failed(record.taskId, `Plainhand could not accept this step after ${attempts} tries: ${message} Nothing was saved from it; start the task again when ready.`));
      const step = stepOf(record, calls.last);
      record.pending = { ...record.pending, attempts, lastError: message };
      await saveRecord(record);
      await setTask(record.taskId, 'running', 'Waiting for your chat to fix a step.');
      return { status: 'step', taskId: record.taskId, step, error: `Plainhand could not accept that result: ${message} Fix exactly this and call submit_step again with the same stepId (${MAX_STEP_ATTEMPTS - attempts} ${MAX_STEP_ATTEMPTS - attempts === 1 ? 'try' : 'tries'} left).` };
    }
    return finish(record, 'failed', failed(record.taskId, message));
  }

  async function expired(record) {
    if (!record.pending || clock() - Date.parse(record.pending.createdAt) <= STEP_TTL_MS) return null;
    const error = 'This task waited more than 2 hours for your chat, so it stopped. Start it again to continue from saved work.';
    await setTask(record.taskId, 'interrupted', error);
    return finish(record, 'interrupted', { status: 'interrupted', taskId: record.taskId, error });
  }
  const settled = record => record.outcome && ['done', 'failed', 'interrupted'].includes(record.status) ? record.outcome : null;

  async function current(taskId) {
    const record = await loadRecord(taskId);
    if (!record) return failed(validTaskId(taskId) ? taskId : null, 'No Plainhand task with that id was started from this chat.');
    const done = settled(record) || await expired(record);
    if (done) return done;
    return (await stopped(record)) || settle(record, await pass(record));
  }
  // A task that was canceled, removed or ended outside the step loop is never replayed.
  async function stopped(record) {
    const task = (await workspace.load()).tasks.find(t => t.id === record.taskId);
    if (!task) return finish(record, 'failed', failed(record.taskId, 'This task no longer exists.'));
    if (task.status === 'canceled') return finish(record, 'failed', failed(record.taskId, 'This task was canceled. Saved work is kept.'));
    if (!['queued', 'running'].includes(task.status)) return finish(record, task.status === 'interrupted' ? 'interrupted' : 'failed', failed(record.taskId, task.message || 'This task has stopped. Start it again to continue from saved work.'));
    return null;
  }

  async function start(kind, input = {}) {
    if (!TASK_KINDS.includes(kind)) return failed(null, `Unknown task. Use one of: ${TASK_KINDS.join(', ')}.`);
    const request = typeof input.request === 'string' ? input.request.trim().slice(0, 2000) : '';
    // A revision without a role revises the standard application, as in the app.
    const actual = kind === 'revise' && !input.jobId ? 'standard' : kind;
    const jobId = ['evaluate', 'prepare', 'revise'].includes(actual) ? (typeof input.jobId === 'string' ? input.jobId : null) : null;
    if (['evaluate', 'prepare', 'revise'].includes(actual) && !jobId) return failed(null, 'Say which role: pass its jobId (find it with the jobs list).');
    if (kind === 'revise' && !request) return failed(null, 'Say what to change, in the candidate\'s own words, as request.');
    const retryOf = typeof input.retryOf === 'string' ? input.retryOf : null;
    // The same task already waiting on this chat: continue it instead of starting a second one.
    const state = await workspace.load();
    const open = state.tasks.find(t => ['queued', 'running'].includes(t.status) && t.kind === actual && (t.jobId || null) === jobId);
    if (open && !retryOf) {
      const record = await loadRecord(open.id);
      if (record && !settled(record)) {
        const outcome = await current(open.id);
        if (outcome.status === 'step') return outcome;
      }
    }
    const previous = retryOf ? await loadRecord(retryOf) : null;
    const record = { version: 1, taskId: null, kind: actual, jobId, createdAt: iso(), status: 'running', steps: previous ? previous.steps.map(s => ({ ...s })) : [], pending: null, claim: null, cache: previous?.cache ? structuredClone(previous.cache) : {}, outcome: null };
    let result;
    try { result = await pass(record, { kind: actual, jobId, input: { ...(request ? { request } : {}), ...(actual === 'discover' ? { filter: String(input.filter || '').slice(0, 500), location: String(input.location || '').slice(0, 300) } : {}), ...(retryOf ? { retryOf } : {}) } }); }
    catch (error) { return failed(record.taskId, error.message); }
    return settle(record, result);
  }

  async function submit(taskId, stepId, result) {
    let record = await loadRecord(taskId);
    if (!record) return failed(validTaskId(taskId) ? taskId : null, 'No Plainhand task with that id was started from this chat.');
    const done = settled(record) || await expired(record);
    if (done) return done;
    if (typeof result === 'string') { try { result = JSON.parse(result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { /* reported below */ } }
    const notObject = !result || typeof result !== 'object' || Array.isArray(result);
    // Claim the step while holding the workspace lock, so two submits never both commit.
    let claimError = null;
    await workspace.mutate(async () => {
      record = await loadRecord(taskId);
      if (settled(record)) return;
      if (!record.pending || record.pending.stepId !== stepId) { claimError = `Plainhand is waiting for step ${record.pending?.stepId || '(none)'}, not ${stepId}. Use the step below.`; return; }
      if (notObject) { claimError = 'result must be one JSON object matching resultSchema.'; return; }
      if (record.claim && clock() - Date.parse(record.claim.at) < CLAIM_MS) { claimError = 'Plainhand is already checking this step. Call task_status in a moment.'; return; }
      record.claim = { stepId, at: iso() };
      await saveRecord(record);
    });
    if (settled(record)) return record.outcome;
    const stop = !claimError && await stopped(record);
    if (stop) return stop;
    if (claimError) {
      const outcome = await current(taskId);
      return outcome.status === 'step' ? { ...outcome, error: claimError } : outcome;
    }
    const index = record.pending.index;
    record.steps.length = index;
    record.steps[index] = { stepId, digest: record.pending.digest, purpose: record.pending.purpose, result, acceptedAt: iso() };
    let replay;
    try { replay = await pass(record); }
    catch (error) { record.claim = null; record.steps.length = index; await saveRecord(record); return failed(taskId, error.message); }
    return settle(record, replay, index);
  }

  return { start, submit, current };
}
