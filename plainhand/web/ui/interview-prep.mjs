// Interview prep in the job panel's Record tab, below the interview rounds: build a
// stage-specific pack for a round (what they read, likely questions with answers from
// your own stories and their quotes, honest bridges for gaps, questions to ask, things
// to look up), then practice one answer and see which claims your evidence does not
// support. Nothing is sent anywhere; everything shown is checked against your sources.
import { html, useState, store, api, refresh, toast, Icon, ago, Day, useDraft, ACTIVE, TASK_TITLES } from './core.mjs';
import { ActionButton, Notice, Field, Pill, Spinner } from './components.mjs';

TASK_TITLES['interview-prep'] = 'Prepare for an interview';
TASK_TITLES['interview-practice'] = 'Check a practice answer';

const action = (name, input) => api('action', { name, input });
const VERDICTS = { strong: ['success', 'Strong'], okay: ['accent', 'Okay'], 'needs-work': ['danger', 'Needs work'] };

export function InterviewPrep({ job }) {
  const rounds = (job.record?.interviews || []).filter(r => r.status !== 'canceled');
  const ready = !!job.packet && !!job.evaluation;
  return html`<section class="panel-section ip-section" aria-labelledby="rec-prep">
    <div class="section-head"><h3 id="rec-prep">Interview prep</h3></div>
    ${!rounds.length ? html`<p class="muted-text">Add an interview round above to build a prep pack for it.</p>`
    : !ready ? html`<p class="muted-text">Prepare the application first. Interview prep starts from your evaluation and the packet the interviewer will have read.</p>`
    : html`<p class="muted-text">Built from the posting, the packet you submitted and your own stories. Every sample answer cites your sources. Plainhand cannot browse, so it tells you what to look up rather than guessing.</p>
      <ul class="ip-list">${rounds.map(round => html`<li key=${round.id}><${RoundPrep} job=${job} round=${round} /></li>`)}</ul>`}
  </section>`;
}

function RoundPrep({ job, round }) {
  const pack = (job.interviewPrep || {})[round.id] || null;
  const tasks = (store.state.tasks || []).filter(t => t.kind === 'interview-prep' && t.jobId === job.id && t.input?.interviewId === round.id);
  const running = tasks.find(t => ACTIVE.includes(t.status));
  const failed = tasks[0] && ['failed', 'interrupted'].includes(tasks[0].status) && pack?.taskId !== tasks[0].id ? tasks[0] : null;
  async function build() {
    try { await action('interviewPrep.start', { jobId: job.id, interviewId: round.id }); } catch (error) { toast(error.message, true); return; }
    toast('Building your prep pack. Nothing is sent.');
    refresh();
  }
  const headingId = 'ip-title-' + round.id;
  return html`<article class=${'ip-card' + (pack?.stale ? ' stale' : '')} aria-labelledby=${headingId}>
    <header class="ip-head"><div><h4 id=${headingId}>${round.stage} · <${Day} iso=${round.date} weekday=${false} /></h4>${pack ? html`<small>Built ${ago(pack.createdAt)}</small>` : null}</div>
      <div class="ip-pills">${pack ? (pack.stale ? html`<${Pill} tone="warn" icon="alert">Out of date</${Pill}>` : html`<${Pill} tone="success" icon="checkCircle">Ready</${Pill}>`) : html`<${Pill} tone="neutral">No pack yet</${Pill}>`}</div></header>
    ${pack?.stale ? html`<${Notice} tone="warn">Your packet or the posting changed after this pack was built. Refresh it so the questions match what the interviewer now reads.</${Notice}>` : null}
    ${failed ? html`<${Notice} tone="danger" title="The last attempt did not finish">${failed.message}</${Notice}>` : null}
    ${running ? html`<div class="fu-running" role="status"><${Spinner} /><div><strong>Preparing</strong><p>${running.message || 'Waiting for the agent'}</p></div></div>`
      : html`<div class="action-row"><${ActionButton} class=${pack ? 'small' : 'primary small'} icon="spark" onClick=${build}>${pack ? 'Rebuild the pack' : 'Build the prep pack'}</${ActionButton}></div>`}
    ${pack ? html`<${Pack} job=${job} round=${round} pack=${pack} />` : null}
  </article>`;
}

const Quotes = ({ evidence }) => html`<ul class="fu-evidence">${evidence.map((e, i) => html`<li key=${i}><blockquote><cite>${e.label}</cite>${e.quote}</blockquote></li>`)}</ul>`;

function Pack({ job, round, pack }) {
  return html`<div class="ip-pack">
    <details class="trace fu-trace" open><summary><${Icon} name="quote" />What they read · ${pack.recap.length}</summary>
      <p class="muted-text">Be ready to back each of these up with a specific example.</p>
      <ul class="ip-recap">${pack.recap.map((r, i) => html`<li key=${i}><strong>${r.claim}</strong><blockquote><cite>${r.label}</cite>${r.quote}</blockquote></li>`)}</ul></details>
    <details class="trace fu-trace" open><summary><${Icon} name="brain" />Likely questions · ${pack.questions.length}</summary>
      <ol class="ip-questions">${pack.questions.map((q, i) => html`<li key=${i}><strong>${q.question}</strong><small>${q.why} Story: ${q.story}</small>
        <p class="ip-answer">${q.answer}</p>
        <details class="trace"><summary>Source quotes</summary><${Quotes} evidence=${q.evidence} /></details></li>`)}</ol></details>
    ${pack.bridges.length ? html`<details class="trace fu-trace" open><summary><${Icon} name="flag" />Honest answers for your gaps · ${pack.bridges.length}</summary>
      <ul class="ip-questions">${pack.bridges.map((b, i) => html`<li key=${i}><strong>${b.gap}</strong><p class="ip-answer">${b.answer}</p>
        <details class="trace"><summary>Source quotes</summary><${Quotes} evidence=${b.evidence} /></details></li>`)}</ul></details>` : null}
    <details class="trace fu-trace"><summary><${Icon} name="inbox" />Questions to ask them · ${pack.askThem.length}</summary><ul class="plain-list">${pack.askThem.map((q, i) => html`<li key=${i}>${q}</li>`)}</ul></details>
    <details class="trace fu-trace"><summary><${Icon} name="search" />Look these up yourself · ${pack.lookUp.length}</summary>
      <p class="muted-text">Plainhand does not browse, so it does not state facts about the company. Check these before the round.</p>
      <ul class="plain-list">${pack.lookUp.map((q, i) => html`<li key=${i}>${q}</li>`)}</ul></details>
    <${Practice} job=${job} round=${round} pack=${pack} />
  </div>`;
}

function Practice({ job, round, pack }) {
  const initial = { pick: '0', question: '', answer: '' };
  const [form, setForm, clear] = useDraft('ip-practice:' + job.id + ':' + round.id, initial);
  const [open, setOpen] = useState(false);
  const tasks = (store.state.tasks || []).filter(t => t.kind === 'interview-practice' && t.jobId === job.id && t.input?.interviewId === round.id);
  const running = tasks.find(t => ACTIVE.includes(t.status));
  const failed = tasks[0] && ['failed', 'interrupted'].includes(tasks[0].status) && !(pack.practice || []).some(p => p.taskId === tasks[0].id) ? tasks[0] : null;
  const custom = form.pick === 'custom';
  const question = custom ? form.question : pack.questions[Number(form.pick)]?.question || '';
  const id = 'ip-' + round.id;
  async function submit(event) {
    event.preventDefault();
    try { await action('interviewPrep.practice', { jobId: job.id, interviewId: round.id, question, answer: form.answer }); } catch (error) { toast(error.message, true); return; }
    clear(); toast('Checking your answer against your evidence.'); refresh();
  }
  return html`<div class="ip-practice">
    <h5>Practice an answer</h5>
    ${running ? html`<div class="fu-running" role="status"><${Spinner} /><div><strong>Checking your answer</strong><p>${running.message || 'Waiting for the agent'}</p></div></div>`
    : !open ? html`<div class="action-row"><button type="button" class="button small" onClick=${() => setOpen(true)}><${Icon} name="edit" />Type an answer to check</button></div>`
    : html`<form class="form-grid fu-form" onSubmit=${submit} aria-label="Practice an answer">
      <${Field} form=${id} name="pick" label="Question" full value=${form.pick} options=${[...pack.questions.map((q, i) => [String(i), q.question]), ['custom', 'Another question (type it)']]} onInput=${v => setForm({ ...form, pick: v })} />
      ${custom ? html`<${Field} form=${id} name="question" label="Their question" full required value=${form.question} onInput=${v => setForm({ ...form, question: v })} />` : null}
      <${Field} form=${id} name="answer" label="Your answer" area large full required value=${form.answer} onInput=${v => setForm({ ...form, answer: v })} hint="In your own words. Plainhand marks any claim your sources do not support." />
      <div class="form-footer full"><button type="button" class="button ghost small" onClick=${() => setOpen(false)}>Cancel</button><button type="submit" class="button primary small"><${Icon} name="spark" />Check it</button></div>
    </form>`}
    ${failed ? html`<${Notice} tone="danger" title="The last check did not finish">${failed.message}</${Notice}>` : null}
    ${(pack.practice || []).length ? html`<ul class="ip-feedback">${pack.practice.map(p => html`<li key=${p.id}><${Feedback} item=${p} /></li>`)}</ul>` : null}
  </div>`;
}

function Feedback({ item }) {
  const [tone, text] = VERDICTS[item.verdict] || VERDICTS.okay;
  return html`<article class="ip-fb"><header><strong>${item.question}</strong><${Pill} tone=${tone}>${text}</${Pill}></header>
    <blockquote class="fu-quote">${item.answer}</blockquote>
    ${item.unsupported.length ? html`<${Notice} tone="warn" title="Your evidence does not support these">
      <ul class="plain-list">${item.unsupported.map((u, i) => html`<li key=${i}><strong>${u.claim}</strong>: ${u.why}</li>`)}</ul></${Notice}>` : null}
    ${item.supported.length ? html`<details class="trace fu-trace"><summary><${Icon} name="checkCircle" />Backed by your sources · ${item.supported.length}</summary>
      <ul class="fu-evidence">${item.supported.map((s, i) => html`<li key=${i}><p>${s.claim}</p><${Quotes} evidence=${s.evidence} /></li>`)}</ul></details>` : null}
    ${item.strengths.length ? html`<div><strong>What works</strong><ul class="plain-list">${item.strengths.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul></div>` : null}
    ${item.suggestions.length ? html`<div><strong>To improve it</strong><ul class="plain-list">${item.suggestions.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul></div>` : null}
    <small>${ago(item.createdAt)}</small></article>`;
}
