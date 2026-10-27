// The job context panel: fit and evaluation, the packet document, form
// assistance and the application record. Safety rules kept exactly:
// approval UI only for a fresh packet with no open questions; Applied only
// through the explicit confirmation dialog; browser actions only after approval.
import { html, useEffect, useState, store, api, refresh, toast, token, setJobTab, closePanel, openDialog, closeDialog, runningTask, queueTask, Icon, ago, Day, safeLink, useDraft, SUBMITTED, STATUSES, ACTIVE, queues, openJob } from './core.mjs';
import { ActionButton, Button, IconButton, LinkButton, Notice, Empty, Field, Tabs, Disclosure, Pill, Score, StagePill, Dialog } from './components.mjs';
import { TaskCard } from './conversation.mjs';
import { FollowUps } from './followups.mjs';
import { RequestBox } from './profile.mjs';

const artifactHref = file => `/api/artifact?path=${encodeURIComponent(file)}&token=${encodeURIComponent(token)}`;
const artifactLabel = file => file.endsWith('.md') ? 'Answers' : file.includes('cover-letter') ? 'Cover letter PDF' : 'Resume PDF';

export function JobPanel({ job, tab, headingRef }) {
  const task = store.state.tasks.find(t => t.jobId === job.id && ACTIVE.includes(t.status));
  const submitted = SUBMITTED.includes(job.status) || !!job.submittedAt;
  const steps = [
    ['Saved', true], ['Evaluated', !!job.evaluation], ['Selected', !!job.selected],
    ['Packet', !!job.packet && !job.stale], ['Approved', !!job.approvedHash && !job.stale], ['Submitted', submitted],
  ];
  const current = submitted ? -1 : steps.findIndex(s => !s[1]);
  const tabs = [['fit', 'Fit'], ['packet', 'Packet'], ['apply', 'Apply'], ['record', 'Record']];
  return html`<div class="job-panel">
    <header class="panel-head">
      <div class="panel-head-top"><span class="eyebrow">${job.company}</span><div class="panel-head-tools"><${StagePill} job=${job} /><${IconButton} icon="close" label="Close panel" onClick=${closePanel} /></div></div>
      <h2 class="panel-title" tabindex="-1" ref=${headingRef}>${job.title}</h2>
      <div class="panel-meta">${job.location ? html`<span><${Icon} name="pin" />${job.location}</span>` : null}<a href=${safeLink(job.url)} target="_blank" rel="noreferrer">Original posting<${Icon} name="external" /></a>${job.evaluation ? html`<${Score} value=${job.evaluation.score} />` : null}</div>
      <ol class="stepper" aria-label="Application progress">${steps.map(([label, done], i) => html`<li class=${done ? 'done' : i === current ? 'current' : ''} aria-current=${i === current ? 'step' : undefined}><span class="step-dot" aria-hidden="true">${done ? html`<${Icon} name="check" />` : null}</span><span class="step-label">${label}</span></li>`)}</ol>
      <p class="stepper-caption">${submitted ? 'Submitted · confirmed by you' : `Step ${current + 1} of ${steps.length} · next: ${steps[current][0]}`}</p>
      ${task ? html`<${TaskCard} task=${task} compact onCancel=${async () => { await api('tasks/cancel', { id: task.id }); toast('Cancellation requested. Saved work is preserved.'); refresh(); }} />` : null}
      <${Tabs} label="Role sections" idPrefix="job-tab" value=${tab} onChange=${setJobTab} tabs=${tabs} />
    </header>
    <div class="panel-body" role="tabpanel" id="job-tab-panel" aria-labelledby=${'job-tab-' + tab}>
      ${tab === 'packet' ? html`<${PacketTab} job=${job} />` : tab === 'apply' ? html`<${ApplyTab} job=${job} />` : tab === 'record' ? html`<${RecordTab} job=${job} />` : html`<${FitTab} job=${job} />`}
    </div>
  </div>`;
}

function Evidence({ text, evidence = [] }) {
  return html`<div class="evidence"><p>${text}</p>${evidence.length ? html`<details><summary><${Icon} name="quote" />Supporting evidence · ${evidence.length} ${evidence.length === 1 ? 'source' : 'sources'}</summary>${evidence.map((e, i) => html`<blockquote key=${i}><cite>${e.sourceId}</cite>${e.quote}</blockquote>`)}</details>` : null}</div>`;
}

function Section({ title, children, actions, id }) {
  return html`<section class="panel-section" aria-labelledby=${id}><div class="section-head"><h3 id=${id}>${title}</h3>${actions || null}</div>${children}</section>`;
}

// ---------------------------------------------------------------------------
function FitTab({ job }) {
  const evaluation = job.evaluation;
  const evaluating = runningTask('evaluate', job.id);
  const preparing = runningTask('prepare', job.id);
  const initial = { description: job.description || '', roleAnswers: job.roleAnswers || '', overrideReason: job.overrideReason || '' };
  const [draft, setDraft, clear, dirty] = useDraft('context:' + job.id, initial);
  const set = key => value => setDraft({ ...draft, [key]: value });
  const verification = job.verification;
  async function select() {
    if (evaluation?.score < 4 && !job.overrideReason && !job.selected) throw new Error('Add your reason for pursuing this role in the context form below, then select it.');
    await api('jobs/update', { id: job.id, selected: !job.selected });
    toast(job.selected ? 'Role removed from your selected applications.' : 'Role selected. You can now prepare its application.');
    refresh();
  }
  async function saveContext(event) {
    event.preventDefault();
    const changes = { id: job.id, description: draft.description, overrideReason: draft.overrideReason };
    if (draft.roleAnswers !== (job.roleAnswers || '')) changes.roleAnswers = draft.roleAnswers;
    await api('jobs/update', changes);
    clear(); toast('Context saved. Re-evaluate with the updated evidence.'); refresh();
  }
  return html`
    ${verification ? html`<${Notice} tone=${verification.state === 'active' ? 'success' : 'warn'} title=${`Posting ${verification.state} · checked ${ago(verification.checkedAt)}`}>${verification.reason}</${Notice}>`
      : html`<${Notice} tone="info">This posting has not been verified. Evaluation checks the live page on supported sites before comparing it with your profile.</${Notice}>`}
    <div class="action-row">
      <${ActionButton} class="primary" icon="spark" disabled=${!!evaluating} onClick=${() => queueTask('evaluate', job.id)}>${evaluation ? 'Evaluate again' : 'Evaluate fit'}</${ActionButton}>
      ${evaluation ? html`<${ActionButton} icon=${job.selected ? 'check' : 'plus'} aria-pressed=${job.selected ? 'true' : 'false'} onClick=${select}>${job.selected ? 'Selected for application' : 'Choose this role'}</${ActionButton}>` : null}
      ${job.selected && evaluation ? html`<${ActionButton} icon="file" disabled=${!!preparing} onClick=${() => queueTask('prepare', job.id)}>Prepare application</${ActionButton}>` : null}
      ${job.reportPath && !store.demo ? html`<${LinkButton} class="ghost" icon="download" href=${artifactHref(job.reportPath)}>Full report</${LinkButton}>` : null}
    </div>
    ${evaluation ? html`
      <section class="fit-summary" aria-labelledby="fit-title">
        <div class="fit-score"><${Score} value=${evaluation.score} size="lg" /><${Pill} tone=${evaluation.recommendation === 'Apply' ? 'success' : evaluation.recommendation === 'Skip' ? 'neutral' : 'warn'}>${evaluation.recommendation}</${Pill}></div>
        <div><h3 id="fit-title">How this role fits</h3><p>${evaluation.summary}</p></div>
      </section>
      ${evaluation.score < 4 ? html`<${Notice} tone="warn" title="Below 4/5">We recommend prioritising stronger matches. If you choose to pursue it, record your reason in the context form below.</${Notice}>` : null}
      <${Section} title="Why it fits" id="fit-evidence">${evaluation.matches.map((m, i) => html`<${Evidence} key=${i} text=${m.text} evidence=${m.evidence} />`)}</${Section}>
      <${Section} title="Gaps & uncertainties" id="fit-gaps">${evaluation.gaps.length ? html`<ul class="plain-list">${evaluation.gaps.map((g, i) => html`<li key=${i}>${g}</li>`)}</ul>` : html`<p class="muted-text">No specific gaps recorded. The score is a recommendation, not a hiring prediction.</p>`}</${Section}>
      ${evaluation.questions.length ? html`<${Section} title="Questions for you" id="fit-questions"><ul class="plain-list">${evaluation.questions.map((q, i) => html`<li key=${i}>${q}</li>`)}</ul></${Section}>` : null}
    ` : html`<${Section} title="Let’s look beyond the job title." id="fit-intro"><p class="muted-text">Your agent compares this role with your actual experience, projects and preferences. It shows supporting evidence and asks about meaningful gaps.</p></${Section}>`}
    <${Section} title="Job description & your context" id="fit-context">
      <form class="form-grid" onSubmit=${e => saveContext(e).catch(error => toast(error.message, true))}>
        <${Field} form=${'ctx-' + job.id} name="description" label="Posting text" area large full placeholder="Paste the full job description if the live page cannot be read." value=${draft.description} onInput=${set('description')} />
        <${Field} form=${'ctx-' + job.id} name="roleAnswers" label="Your answers or corrections for this role" area full placeholder="Add only facts you want your agent to use." hint="Saved answers become candidate evidence. Re-evaluate after saving." value=${draft.roleAnswers} onInput=${set('roleAnswers')} />
        ${evaluation?.score < 4 ? html`<${Field} form=${'ctx-' + job.id} name="overrideReason" label="Why pursue this role despite the fit score?" full placeholder="A specific reason for your decision" value=${draft.overrideReason} onInput=${set('overrideReason')} />` : null}
        <div class="form-footer full"><small>${dirty ? 'Unsaved changes · ' : ''}Changed facts need a fresh evaluation and packet.</small><button type="submit" class="button">Save context</button></div>
      </form>
    </${Section}>`;
}

// ---------------------------------------------------------------------------
// Claim calibration (plainhand/claim-calibration.mjs): each claim against its evidence.
// Informational: the candidate decides; nothing here blocks approval except what the
// factual review already blocks.
const BANDS = { balanced: ['success', 'Balanced'], undersold: ['info', 'Underselling you'], inflated: ['warn', 'Stronger than your evidence'], mixed: ['warn', 'Some undersold, some stretched'] };
function Calibration({ job }) {
  const calibration = job.calibration;
  if (!calibration?.claims?.length) return null;
  const flagged = calibration.claims.filter(c => c.rating !== 'balanced');
  const over = flagged.filter(c => (c.rating === 'stretched' || c.rating === 'unsupported') && !c.withinLine);
  const under = flagged.filter(c => c.rating === 'undersold' && !c.withinLine);
  const within = flagged.filter(c => c.withinLine);
  const generic = [...new Set([...calibration.claims.flatMap(c => c.generic || []), ...(calibration.letterGeneric || [])])];
  const decide = (c, decision) => async () => { await api('calibration/decide', { id: job.id, claimId: c.id, decision }); refresh(); };
  const choices = c => store.demo ? null : c.decision === 'use-suggestion'
    ? html`<p class="cal-choice"><${Icon} name="check" />You chose the suggested wording. It’s used when you regenerate.</p>`
    : c.rating === 'unsupported'
      ? html`<p class="cal-choice muted-text">Not in your sources, so it can’t be kept. Add evidence, or regenerate without it.</p>`
      : html`<div class="cal-actions">${c.suggestion ? html`<${ActionButton} class="small" onClick=${decide(c, 'use-suggestion')}>Use suggested wording</${ActionButton}>` : null}<${ActionButton} class="small ghost" onClick=${decide(c, 'keep-mine')}>Keep mine</${ActionButton}></div>`;
  const item = c => html`<li key=${c.id}><p class="cal-claim">“${c.text}”</p>${c.reason ? html`<p class="muted-text">${c.reason}</p>` : null}${c.suggestion ? html`<p class="cal-suggestion"><strong>Closer to your evidence:</strong> ${c.suggestion}</p>` : null}${choices(c)}</li>`;
  const [tone, label] = BANDS[calibration.band] || BANDS.balanced;
  return html`<${Section} title="How strongly this describes you" id="pk-calibration">
    ${job.humanizer ? html`<p class="from-standard"><${Icon} name="spark" />Humanizer pass: ${job.humanizer.changed} ${job.humanizer.changed === 1 ? 'part' : 'parts'} rewritten to remove AI writing patterns${job.humanizer.tellsAfter.length ? ` · ${job.humanizer.tellsAfter.length} left to check` : ' · none left'}</p>` : null}
    <div class="cal-head"><${Pill} tone=${tone}>${label}</${Pill}><span>${calibration.counts.balanced} of ${calibration.total} claims match your evidence${calibration.counts.withinLine ? ` · ${calibration.counts.withinLine} within your line` : ''}${calibration.modelRated ? '' : ' · rule checks only'}</span></div>
    ${over.length ? html`<h4>Stronger than your evidence</h4><ul class="plain-list cal-list">${over.map(item)}</ul>` : null}
    ${under.length ? html`<h4>You can say more</h4><ul class="plain-list cal-list">${under.map(item)}</ul>` : null}
    ${generic.length ? html`<h4>Sounds generic</h4><p class="muted-text">Stock phrases hiring managers read as AI-written: ${generic.join(', ')}. Your own specifics land better.</p>` : null}
    ${within.length ? html`<details class="cal-within"><summary>${within.length} within your line</summary><ul class="plain-list cal-list">${within.map(c => html`<li key=${c.id}><p class="cal-claim">“${c.text}”</p><p class="muted-text">${c.decision === 'keep-mine' ? 'You kept this wording.' : 'Matches how you’ve chosen to word this before.'}</p></li>`)}</ul></details>` : null}
    ${over.length || under.length ? html`<p class="muted-text">Your call. Each choice teaches Plainhand where you draw the line, and the next draft follows it. Nothing without evidence is ever kept.</p>` : null}
  </${Section}>`;
}

// "2 of 5 to review · Next": shown while working through a queue.
function QueueNav({ job, kind }) {
  const list = queues(store.state)[kind];
  const at = list.indexOf(job.id);
  const next = list.find(id => id !== job.id);
  if (list.length < 2 && at >= 0 || !list.length) return null;
  const tab = kind === 'review' ? 'packet' : 'apply';
  return html`<div class="queue-nav"><span>${at >= 0 ? `${at + 1} of ${list.length} ${kind === 'review' ? 'to review' : 'to apply'}` : `${list.length} more ${kind === 'review' ? 'to review' : 'to apply'}`}</span>${next ? html`<${Button} class="small" iconEnd="arrow" onClick=${() => openJob(next, tab)}>Next</${Button}>` : null}</div>`;
}

function PacketTab({ job }) {
  const packet = job.packet;
  const preparing = runningTask('prepare', job.id);
  const identity = `${job.id}|${job.pdfHash || ''}|${job.stale}|${job.approvedHash || ''}`;
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => setReviewed(false), [identity]);
  if (!packet) return html`
    ${job.review && (!job.review.passed || job.review.issues.length) ? html`<${Notice} tone="danger" title="The factual reviewer found issues">Add source evidence or corrections, then prepare again.<ul class="plain-list">${job.review.issues.map((i, k) => html`<li key=${k}>${i}</li>`)}</ul></${Notice}>` : null}
    <${Empty} icon="file" title="An application grounded in your story.">Evaluate this role and choose it. Your agent then writes a tailored resume, cover letter and answers, each traced to your evidence.</${Empty}>
    <div class="center-row"><${ActionButton} class="primary" icon="file" disabled=${!job.selected || !job.evaluation || !!preparing} onClick=${() => queueTask('prepare', job.id)}>Prepare application</${ActionButton}></div>`;
  const fresh = !job.stale && !packet.questions.length;
  return html`
    <${QueueNav} job=${job} kind="review" />
    ${job.stale ? html`<${Notice} tone="danger" title="This packet is out of date">Your profile or the job context changed. Re-evaluate and prepare again before using it.</${Notice}>`
      : html`<${Notice} tone="success">Source references and a separate factual review passed. Read the actual wording and documents before approving.</${Notice}>`}
    ${packet.questions.length ? html`<${Notice} tone="warn" title="Your agent needs a few answers before approval"><ul class="plain-list">${packet.questions.map((q, i) => html`<li key=${i}>${q}</li>`)}</ul><${Button} class="small" iconEnd="arrow" onClick=${() => setJobTab('fit')}>Add answers in role context</${Button}></${Notice}>` : null}
    ${packet.suggestions?.length ? html`<${Section} title="Optional ways to strengthen this application" id="pk-suggest"><ul class="plain-list">${packet.suggestions.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul></${Section}>` : null}
    ${job.fromStandard ? html`<p class="from-standard"><${Icon} name="layers" />From your standard: ${[[job.fromStandard.kept, 'kept'], [job.fromStandard.changed, 'reworded'], [job.fromStandard.added, 'added'], [job.fromStandard.removed, 'left out']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(' · ') || 'unchanged'}</p>` : null}
    ${job.autoSelectedAt ? html`<${Notice} tone="info" title="Prepared on its own">Plainhand prepared this strong match from your standard. Nothing has been sent; review it like any other.</${Notice}>` : null}
    <${Calibration} job=${job} />
    ${store.demo || job.submittedAt ? null : html`<${RequestBox} id=${'revise-' + job.id} label="Ask for a change" placeholder="Make it shorter; lead with the pump project" disabled=${!!preparing || !!runningTask('revise', job.id)} onSubmit=${text => queueTask('revise', job.id, { request: text })} />`}
    <div class="download-row">${store.demo ? html`<${Pill} tone="warn">Sample documents · demo only</${Pill}>` : (job.artifacts || []).map(file => html`<a key=${file} class="button small" href=${artifactHref(file)} download><${Icon} name="download" />${artifactLabel(file)}</a>`)}</div>
    <${Section} title="Resume preview" id="pk-resume">
      <article class="document" aria-label="Resume">
        <h4 class="doc-name">${store.state.profile.name}</h4><p class="doc-contact">${[store.state.profile.email, store.state.profile.location].filter(Boolean).join(' · ')}</p>
        ${packet.resume.map((entry, i) => { const prev = packet.resume[i - 1], h = entry.heading, newHeading = h && (!prev || JSON.stringify(prev.heading || null) !== JSON.stringify(h) || prev.section !== entry.section);
          return html`${i === 0 || prev.section !== entry.section ? html`<h5>${entry.section}</h5>` : null}${newHeading ? html`<p class="doc-heading"><strong>${h.org || h.title}</strong>${h.org && h.title ? html`, <em>${h.title}</em>` : null}${h.dates ? html`<span>${h.dates}</span>` : null}</p>` : null}<p key=${i} class=${h ? 'doc-bullet' : ''}>${entry.text}</p>`; })}
      </article>
      <details class="trace"><summary><${Icon} name="quote" />Trace resume entries to your evidence</summary>${packet.resume.map((e, i) => html`<${Evidence} key=${i} text=${e.text} evidence=${e.evidence} />`)}</details>
    </${Section}>
    <${Section} title="Cover letter" id="pk-letter"><article class="document letter" aria-label="Cover letter"><p>${packet.coverLetter}</p></article></${Section}>
    <${Section} title="Application answers" id="pk-answers">${packet.answers.length ? packet.answers.map((a, i) => html`<div class="qa" key=${i}><h4>${a.question}</h4><${Evidence} text=${a.answer} evidence=${a.evidence} /></div>`) : html`<p class="muted-text">No additional answers generated. Portal-specific questions may still need your input.</p>`}</${Section}>
    ${fresh ? html`<section class="approval" aria-labelledby="approval-title">${job.approvedHash ? html`
        <${Notice} tone="success" title="Approved"><p>You approved this exact packet.</p></${Notice}>
        <${Button} class="primary wide" iconEnd="arrow" onClick=${() => setJobTab('apply')}>Continue to the application form</${Button}>` : html`
        <h3 id="approval-title">Approve this packet</h3>
        <p class="muted-text">Approval binds to this exact resume, cover letter and answer set. Any later change to your profile, the role or the packet clears it.</p>
        <label class="checkbox"><input type="checkbox" id="review-confirm" checked=${reviewed} onChange=${e => setReviewed(e.currentTarget.checked)} /><span>I have reviewed the resume, cover letter and answers. They accurately represent me for this role.</span></label>
        <${ActionButton} class="primary wide" icon="check" disabled=${!reviewed} onClick=${async () => { await api('packet/approve', { id: job.id }); toast('This exact packet is approved.'); setReviewed(false); refresh(); }}>Approve this packet</${ActionButton}>`}
      </section>` : null}
    <div class="action-row end"><${ActionButton} class="ghost small" icon="refresh" disabled=${!!preparing} onClick=${() => queueTask('prepare', job.id)}>Regenerate packet</${ActionButton}></div>`;
}

// ---------------------------------------------------------------------------
const SHORT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'search'];
const UPLOAD_STATES = { selected: 'file selected; verify attachment in the browser', 'server-accepted': 'attachment transfer accepted by server', failed: 'attachment transfer failed or was blocked', pending: 'attachment transfer still pending', unconfirmed: 'attachment transfer could not be confirmed' };
// Job boards Plainhand never opens itself (mirrors isBoardUrl in plainhand/jobs.mjs).
const BOARD_HOST = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|monster\.com|simplyhired\.com|joinhandshake\.com|wellfound\.com)$/i;
const isBoard = url => { try { return BOARD_HOST.test(new URL(url).hostname); } catch { return false; } };
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function ApplyLink({ job }) {
  const [draft, setDraft, clear] = useDraft('apply-link:' + job.id, '');
  async function save(event) {
    event.preventDefault();
    try { const r = await api('jobs/apply-link', { id: job.id, applyUrl: (draft || '').trim() }); clear(); toast(r.verification === 'active' ? 'Saved. The employer’s page is live.' : 'Saved.'); refresh(); }
    catch (error) { toast(error.message, true); }
  }
  return html`<${Notice} tone="info" title=${job.applyUrl ? `Applying on ${hostOf(job.applyUrl)}` : `Apply on the employer’s site`}>
    ${job.applyUrl ? html`<p>Saved from ${hostOf(job.url)}; Plainhand fills the employer’s own form.</p>` : html`<p>Plainhand doesn’t open ${hostOf(job.url)} pages for you. Most postings link to the employer’s own application; paste that link here.</p>`}
    <form class="request-box" onSubmit=${save}><${Field} form=${'apply-' + job.id} name="applyUrl" label="Employer’s application link" value=${draft || ''} onInput=${setDraft} placeholder="https://careers.example.com/jobs/123/apply" /><${Button} type="submit" icon="check" disabled=${!(draft || '').trim()}>${job.applyUrl ? 'Change link' : 'Save link'}</${Button}></form>
  </${Notice}>`;
}

const CHECK_REASONS = { sensitive: 'Personal or legal', 'no-information': 'Not in your profile', document: 'Document', choice: 'Your choice' };
function PresubmitCheck({ check, preview }) {
  if (!check?.items?.length) return null;
  const need = check.items.filter(i => i.status === 'flagged').sort((a, b) => Number(b.required) - Number(a.required));
  const mismatch = check.items.filter(i => i.status === 'mismatch');
  const filled = check.items.filter(i => i.status === 'filled');
  const s = check.summary;
  return html`<${Section} title=${preview ? 'What Plainhand will fill' : 'Before you submit'} id="ap-check">
    <div class="cal-head"><${Pill} tone=${check.ready ? 'success' : 'warn'}>${check.ready ? (preview ? 'Required fields covered' : 'Ready for your final review') : s.mismatched ? `${s.mismatched} to check` : `${s.requiredFlagged} required need you`}</${Pill}><span>${s.filled} filled · ${s.flagged} for you${s.mismatched ? ` · ${s.mismatched} to check` : ''}</span></div>
    ${mismatch.length ? html`<h4>Check these on the page</h4><ul class="plain-list check-list-items">${mismatch.map(i => html`<li key=${i.key}><strong>${i.label}</strong><span class="muted-text">${i.text}</span></li>`)}</ul>` : null}
    ${need.length ? html`<h4>For you to answer</h4><ul class="plain-list check-list-items">${need.map(i => html`<li key=${i.key}><strong>${i.label.slice(0, 160)}</strong>${i.required ? html` <small class="req-tag">Required</small>` : null}<span class="muted-text">${CHECK_REASONS[i.reason] || ''}${i.text ? ` · ${i.text}` : ''}</span></li>`)}</ul>` : null}
    ${filled.length ? html`<details class="cal-within"><summary>${filled.length} filled by Plainhand</summary><ul class="plain-list check-list-items">${filled.map(i => html`<li key=${i.key}><strong>${i.label.slice(0, 160)}</strong><span class="muted-text">from ${i.source}</span></li>`)}</ul></details>` : null}
    <p class="muted-text">${preview ? 'Nothing is entered until you fill the form. ' : ''}Answers you type here can be saved for next time; you approve them in Workspace first.</p>
  </${Section}>`;
}

function ApplyTab({ job }) {
  const [plan, setPlan, clearPlan] = useDraft('plan:' + job.id, null);
  // One browser action at a time: the others wait until it finishes.
  const [running, setRunning] = useState(null);
  if (!job.approvedHash || job.stale) return html`<${Empty} icon="lock" title="A quick review before the next step.">Review and approve the exact application packet before opening form assistance.</${Empty}><div class="center-row"><${Button} class="primary" iconEnd="arrow" onClick=${() => setJobTab('packet')}>Review application packet</${Button}></div>`;
  const checkpoint = job.browserCheckpoint;
  const observation = plan?.observation;
  const submitted = job.status === 'Applied' || !!job.submittedAt;
  const setAnswer = (key, value) => setPlan({ ...plan, answers: { ...plan.answers, [key]: value } });
  const n = plan?.steps?.length || 0;
  const act = (name, fn) => async () => { setRunning(name); try { await fn(); } finally { setRunning(null); } };
  const blocked = name => !!running && running !== name;
  return html`
    <${QueueNav} job=${job} kind="apply" />
    ${isBoard(job.url) ? html`<${ApplyLink} job=${job} />` : null}
    <${Notice} tone="info">Plainhand fills standard fields and uploads your exact approved resume and cover letter, continuing through supported form steps. Unresolved questions and the final submit click always come back to you.</${Notice}>
    <div class="action-row">
      <${ActionButton} class="primary" icon="external" disabled=${blocked('open')} onClick=${act('open', async () => { toast('Opening a separate application browser on this computer…'); setPlan(await api('browser/open', { id: job.id })); refresh(); })}>${plan ? 'Inspect form again' : 'Open & inspect application'}</${ActionButton}>
      <${ActionButton} class="primary" disabled=${blocked('autofill')} onClick=${act('autofill', async () => { toast('Filling supported form steps from your approved packet…'); setPlan(await api('browser/autofill', { id: job.id })); refresh(); })}>Autofill to final review</${ActionButton}>
      <${ActionButton} disabled=${blocked('resume')} onClick=${act('resume', async () => { setPlan(await api('browser/resume', { id: job.id })); refresh(); })}>Resume inspection</${ActionButton}>
      <${LinkButton} class="ghost" href=${safeLink(job.applyUrl || job.url)} external>Apply manually</${LinkButton}>
    </div>
    ${observation ? html`<div class="observation">
      <${Notice} tone=${['challenge', 'login', 'paused', 'needs-answers'].includes(observation.state) ? 'warn' : 'neutral'}>${observation.message || 'Application inspected.'}</${Notice}>
      ${observation.solver ? html`<${Notice}>${observation.solver.message}</${Notice}>` : null}
      <div class="action-row">${observation.liveUrl ? html`<${LinkButton} href=${safeLink(observation.liveUrl)} external>View application browser</${LinkButton}>` : null}
      ${['challenge', 'login', 'paused'].includes(observation.state) ? html`<${ActionButton} onClick=${async () => { const r = await api('browser/attention', { id: job.id }); toast(r.message); }}>Handle sign-in or verification</${ActionButton}>` : null}</div>
    </div>` : null}
    ${plan?.navigation?.length ? html`<p class="muted-text">Your agent took ${plan.navigation.length} navigation ${plan.navigation.length === 1 ? 'step' : 'steps'}.</p>` : null}
    ${n ? html`<p class="progress-note"><${Icon} name="check" /><span>${n} form ${n === 1 ? 'step' : 'steps'} processed in this run.</span></p>` : null}
    ${plan?.fields?.length ? html`<form class="answers-form" onSubmit=${async e => { e.preventDefault(); try { const r = await api('browser/fill', { id: job.id, answers: plan.answers }); toast(`${r.filled.length} fields filled.${r.offered ? ` ${r.offered} of your answers can be saved for next time; approve them in Workspace.` : ''} Review the rest in the application browser.`); refresh(); } catch (error) { toast(error.message, true); } }}>
      <h3>Review the form answers</h3>
      <p class="muted-text">Only the fields below are filled. Leave anything you’re unsure about blank. Checkboxes, demographic choices and legal attestations stay with you in the application browser.</p>
      ${plan.warning ? html`<${Notice} tone="warn">${plan.warning}</${Notice}>` : null}
      ${plan.questions?.length ? html`<${Notice} tone="warn" title="Your agent needs your input">${plan.questions.map(q => q.question).join(' ')}</${Notice}>` : null}
      <div class="form-grid">${plan.fields.map(f => {
        const id = 'answer-' + f.key.replace(/[^\w-]/g, '_');
        const text = f.sectionContext ? `${f.sectionContext.label} ${f.sectionContext.index + 1}/${f.sectionContext.count} — ${f.label}` : f.label;
        const value = plan.answers[f.key] || '';
        return html`<div class="field full" key=${f.key}><label for=${id}>${text}${f.required ? html`<small class="req-tag">Required by portal</small>` : null}</label>${f.type === 'file'
          ? html`<select id=${id} value=${value} onChange=${e => setAnswer(f.key, e.currentTarget.value)}><option value="">Do not upload</option><option value="__resume__">Upload this role’s approved resume PDF</option>${(job.artifacts || []).some(a => /cover-letter.*\.pdf$/.test(a)) ? html`<option value="__cover_letter__">Upload this role’s approved cover letter PDF</option>` : null}</select>`
          : f.type === 'select-one' ? html`<select id=${id} value=${value} onChange=${e => setAnswer(f.key, e.currentTarget.value)}><option value="">Leave for me to answer</option>${f.options.filter(o => o.value).map(o => html`<option value=${o.value}>${o.label}</option>`)}</select>`
          : SHORT_TYPES.includes(f.type) && value.length < 120 ? html`<input id=${id} type=${f.type === 'email' ? 'email' : 'text'} value=${value} placeholder="Leave blank to answer in the browser" onInput=${e => setAnswer(f.key, e.currentTarget.value)} />`
          : html`<textarea id=${id} value=${value} placeholder="Leave blank to answer in the browser" onInput=${e => setAnswer(f.key, e.currentTarget.value)}></textarea>`}</div>`;
      })}</div>
      <button type="submit" class="button primary wide"><${Icon} name="check" />Fill these reviewed answers</button>
    </form>` : null}
    ${checkpoint?.check ? html`<${PresubmitCheck} check=${checkpoint.check} />` : plan?.check ? html`<${PresubmitCheck} check=${plan.check} preview=${true} />` : null}
    ${checkpoint ? html`<${Section} title="Last browser checkpoint" id="ap-checkpoint">
      <p class="muted-text">${checkpoint.result.filled.length} fields filled · ${checkpoint.result.skipped.length} left for you${checkpoint.navigation?.length ? ` · ${checkpoint.navigation.length} navigation steps` : ''} · ${ago(checkpoint.at)}</p>
      ${checkpoint.result.note ? html`<${Notice}>${checkpoint.result.note}</${Notice}>` : null}
      ${checkpoint.result.uploads?.length ? html`<ul class="plain-list uploads">${checkpoint.result.uploads.map((u, i) => html`<li key=${i}>${u.label}: ${UPLOAD_STATES[u.state] || 'check attachment in browser'}</li>`)}</ul>` : null}
      ${checkpoint.result.failed?.length ? html`<${Notice} tone="danger">Could not verify: ${checkpoint.result.failed.join(', ')}</${Notice}>` : null}
      ${checkpoint.result.validation?.length ? html`<${Notice} tone="danger">${checkpoint.result.validation.join(' ')}</${Notice}>` : null}
      <${ActionButton} class="primary" icon="external" onClick=${async () => { const r = await api('browser/handoff', { id: job.id }); clearPlan(); toast(r.message); refresh(); }}>Take over the browser</${ActionButton}>
    </${Section}>` : null}
    <section class="finish" aria-labelledby="finish-title">
      <h3 id="finish-title">Finished submitting?</h3>
      <p class="muted-text">After you review and submit on the employer’s site, confirm it here. Filling a form or saving a draft does not count as an application.</p>
      <${Button} icon="checkCircle" disabled=${submitted} onClick=${() => openDialog({ type: 'confirm-submit', id: job.id })}>${submitted ? 'Submission confirmed' : 'I submitted this application'}</${Button}>
    </section>`;
}

// ---------------------------------------------------------------------------
export function StatusSelect({ job, id }) {
  const selectId = id || 'status-' + job.id;
  async function change(event) {
    const value = event.currentTarget.value;
    if (value === 'Applied') { event.currentTarget.value = job.status; openDialog({ type: 'confirm-submit', id: job.id }); return; }
    try { await api('jobs/update', { id: job.id, status: value }); toast('Tracker updated.'); refresh(); }
    catch (error) { event.currentTarget.value = job.status; toast(error.message, true); }
  }
  return html`<label class="visually-hidden" for=${selectId}>Status for ${job.company} ${job.title}</label><select class="compact-select" id=${selectId} value=${job.status} onChange=${change}>${STATUSES.map(s => html`<option value=${s}>${s}</option>`)}</select>`;
}

function timeline(job) {
  const entries = [];
  const add = (at, text, icon = 'check', day = false) => { if (at) entries.push({ at, text, icon, day }); };
  add(job.createdAt, 'Role saved', 'inbox');
  if (job.evaluation) add(job.evaluation.at || job.createdAt, `Evaluated ${job.evaluation.score}/5${job.evaluation.recommendation ? ' — ' + job.evaluation.recommendation : ''}`, 'spark');
  if (job.selected) add(job.selectedAt || job.createdAt, 'Chosen for application', 'flag');
  if (job.packet) add(job.packetAt || job.updatedAt || job.createdAt, 'Application packet prepared', 'file');
  if (job.review?.passed) add(job.reviewedAt || job.updatedAt || job.createdAt, 'Factual review passed', 'shield');
  if (job.approvedHash) add(job.approvedAt || job.updatedAt || job.createdAt, 'Packet approved for browser assistance', 'checkCircle');
  if (job.browserCheckpoint) add(job.browserCheckpoint.at || job.updatedAt || job.createdAt, 'Form progress saved', 'layers');
  for (const contact of job.record?.contacts || []) add(contact.addedAt, `Contact added: ${contact.name}${contact.role ? ', ' + contact.role : ''}`, 'user');
  for (const round of job.record?.interviews || []) add(round.date + 'T12:00:00.000Z', `${round.stage} interview (${round.status})`, 'calendar', true);
  for (const change of job.statusHistory || []) add(change.at, `${change.from || 'New'} → ${change.to}`, 'arrow');
  const KINDS = { 'thank-you': 'Thank-you note', 'check-in': 'Check-in', reply: 'Reply' };
  for (const note of job.followups || []) if (note.status === 'sent') add(note.sentAt, `${KINDS[note.kind] || 'Follow-up'} sent${note.channel ? ' by ' + note.channel : ''}`, 'send');
  return entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function RecordTab({ job }) {
  const record = job.record || {};
  const next = record.nextAction;
  const contacts = record.contacts || [], rounds = record.interviews || [];
  const [nextDraft, setNext, clearNext] = useDraft('next:' + job.id, { text: next?.text || '', due: next?.due || '' });
  const emptyRound = { stage: '', date: '', interviewer: '', status: 'scheduled', preparation: '', notes: '' };
  const [round, setRound, clearRound] = useDraft('round:' + job.id, emptyRound);
  const emptyContact = { name: '', role: '', type: 'recruiter', email: '', phone: '', linkedin: '', notes: '' };
  const [contact, setContact, clearContact] = useDraft('contact:' + job.id, emptyContact);
  const [roundOpen, setRoundOpen] = useDraft('round-open:' + job.id, false);
  const [contactOpen, setContactOpen] = useDraft('contact-open:' + job.id, false);
  const remove = (kind, entry, label) => html`<${IconButton} icon="trash" label=${'Remove ' + label} onClick=${async () => { try { await api('jobs/record/remove-' + kind, { id: job.id, entryId: entry.id }); toast(kind === 'contact' ? 'Contact removed.' : 'Interview round removed.'); refresh(); } catch (e) { toast(e.message, true); } }} />`;
  const fail = error => toast(error.message, true);
  const entries = timeline(job);
  return html`
    <p class="lead-text">What happened with this application, and what comes next. Recording an interview never changes the application status; set the status yourself.</p>
    ${job.evaluation ? html`<div class="status-row"><span>Tracker status</span><${StatusSelect} job=${job} id=${'record-status-' + job.id} /></div>` : null}
    <${Section} title="Next action" id="rec-next">
      ${next ? html`<div class="next-action"><${Icon} name="flag" /><div><strong>${next.text}</strong>${next.due ? html`<small>Due <${Day} iso=${next.due} /></small>` : html`<small>No due date</small>`}</div></div>` : html`<p class="muted-text">No next action recorded.</p>`}
      <form class="form-grid" onSubmit=${async e => { e.preventDefault(); try { await api('jobs/record/next-action', { id: job.id, text: nextDraft.text, due: nextDraft.due }); clearNext(); toast(nextDraft.text.trim() ? 'Next action saved.' : 'Next action cleared.'); refresh(); } catch (error) { fail(error); } }}>
        <${Field} form=${'next-' + job.id} name="nextText" label="What happens next?" placeholder="Send a thank-you note to the recruiter" value=${nextDraft.text} onInput=${v => setNext({ ...nextDraft, text: v })} />
        <${Field} form=${'next-' + job.id} name="nextDue" label="Due date" type="date" value=${nextDraft.due} onInput=${v => setNext({ ...nextDraft, due: v })} />
        <div class="form-footer full"><small>Shown in Follow-ups and the tracker notes. Save it empty to clear.</small><button type="submit" class="button small">Save next action</button></div>
      </form>
    </${Section}>
    <${FollowUps} job=${job} />
    <${Section} title="Interviews" id="rec-rounds">
      ${rounds.length ? html`<ul class="record-list">${rounds.map(r => html`<li key=${r.id}><span class=${'record-icon' + (r.status === 'completed' ? ' done' : '')}><${Icon} name=${r.status === 'completed' ? 'checkCircle' : 'calendar'} /></span>
        <div class="record-main"><strong>${r.stage} · <${Day} iso=${r.date} weekday=${false} /></strong><p>${[r.interviewer && 'With ' + r.interviewer, r.preparation && 'Prep: ' + r.preparation, r.notes].filter(Boolean).join(' · ') || 'No notes yet.'}</p></div>
        <div class="record-tools"><label class="visually-hidden" for=${'round-' + r.id}>Status for ${r.stage} interview</label>
        <select class="compact-select" id=${'round-' + r.id} value=${r.status} onChange=${async e => { const el = e.currentTarget; try { await api('jobs/record/interview-status', { id: job.id, entryId: r.id, status: el.value }); toast('Interview round updated.'); refresh(); } catch (error) { el.value = r.status; fail(error); } }}>${['scheduled', 'completed', 'canceled'].map(v => html`<option value=${v}>${v[0].toUpperCase() + v.slice(1)}</option>`)}</select>
        ${remove('interview', r, r.stage + ' interview')}</div></li>`)}</ul>` : html`<p class="muted-text">No interview rounds recorded.</p>`}
      <${Disclosure} label="Add interview round" id=${'round-form-' + job.id} open=${roundOpen} onToggle=${() => setRoundOpen(!roundOpen)}>
        <form class="form-grid" onSubmit=${async e => { e.preventDefault(); try { await api('jobs/record/interview', { id: job.id, interview: { stage: round.stage, date: round.date, status: round.status, interviewer: round.interviewer, preparation: round.preparation, notes: round.notes } }); clearRound(); setRoundOpen(false); toast('Interview round added.'); refresh(); } catch (error) { fail(error); } }}>
          <${Field} form=${'round-' + job.id} name="stage" label="Stage" placeholder="Recruiter screen, technical, onsite…" required value=${round.stage} onInput=${v => setRound({ ...round, stage: v })} />
          <${Field} form=${'round-' + job.id} name="date" label="Date" type="date" required value=${round.date} onInput=${v => setRound({ ...round, date: v })} />
          <${Field} form=${'round-' + job.id} name="interviewer" label="Interviewer" placeholder="Optional" value=${round.interviewer} onInput=${v => setRound({ ...round, interviewer: v })} />
          <${Field} form=${'round-' + job.id} name="roundStatus" label="Status" value=${round.status} options=${[['scheduled', 'Scheduled'], ['completed', 'Completed'], ['canceled', 'Canceled']]} onInput=${v => setRound({ ...round, status: v })} />
          <${Field} form=${'round-' + job.id} name="preparation" label="Preparation" full placeholder="Topics, stories to use, or a prep link" value=${round.preparation} onInput=${v => setRound({ ...round, preparation: v })} />
          <${Field} form=${'round-' + job.id} name="roundNotes" label="Notes" area full placeholder="What was discussed, what to follow up on" value=${round.notes} onInput=${v => setRound({ ...round, notes: v })} />
          <div class="form-footer full"><small>Recording a round does not change the application status.</small><button type="submit" class="button primary small">Save interview round</button></div>
        </form>
      </${Disclosure}>
    </${Section}>
    <${Section} title="Contacts" id="rec-contacts">
      ${contacts.length ? html`<ul class="record-list">${contacts.map(c => html`<li key=${c.id}><span class="record-icon"><${Icon} name="user" /></span>
        <div class="record-main"><strong>${c.name}${c.role ? ' · ' + c.role : ''}</strong><p>${c.type}${c.email ? html` · <a href=${'mailto:' + c.email}>${c.email}</a>` : null}${c.phone ? ' · ' + c.phone : ''}${c.linkedin ? html` · <a href=${safeLink(c.linkedin)} target="_blank" rel="noreferrer">Profile</a>` : null}${c.notes ? ' · ' + c.notes : ''}</p></div>
        ${remove('contact', c, c.name)}</li>`)}</ul>` : html`<p class="muted-text">No contacts recorded.</p>`}
      <${Disclosure} label="Add contact" id=${'contact-form-' + job.id} open=${contactOpen} onToggle=${() => setContactOpen(!contactOpen)}>
        <form class="form-grid" onSubmit=${async e => { e.preventDefault(); try { await api('jobs/record/contact', { id: job.id, contact }); clearContact(); setContactOpen(false); toast('Contact added.'); refresh(); } catch (error) { fail(error); } }}>
          <${Field} form=${'contact-' + job.id} name="contactName" label="Name" placeholder="Who you spoke with" required value=${contact.name} onInput=${v => setContact({ ...contact, name: v })} />
          <${Field} form=${'contact-' + job.id} name="contactRole" label="Their role" placeholder="Technical recruiter" value=${contact.role} onInput=${v => setContact({ ...contact, role: v })} />
          <${Field} form=${'contact-' + job.id} name="contactType" label="Relationship" value=${contact.type} options=${['recruiter', 'hiring manager', 'interviewer', 'referral', 'other'].map(v => [v, v[0].toUpperCase() + v.slice(1)])} onInput=${v => setContact({ ...contact, type: v })} />
          <${Field} form=${'contact-' + job.id} name="contactEmail" label="Email" type="email" placeholder="Optional" value=${contact.email} onInput=${v => setContact({ ...contact, email: v })} />
          <${Field} form=${'contact-' + job.id} name="contactPhone" label="Phone" placeholder="Optional" value=${contact.phone} onInput=${v => setContact({ ...contact, phone: v })} />
          <${Field} form=${'contact-' + job.id} name="contactLinkedin" label="Profile link" type="url" placeholder="https://…" value=${contact.linkedin} onInput=${v => setContact({ ...contact, linkedin: v })} />
          <${Field} form=${'contact-' + job.id} name="contactNotes" label="Notes" full placeholder="How you met, what they said" value=${contact.notes} onInput=${v => setContact({ ...contact, notes: v })} />
          <div class="form-footer full"><small>Contacts stay in this workspace and are never sent to your AI provider.</small><button type="submit" class="button primary small">Save contact</button></div>
        </form>
      </${Disclosure}>
    </${Section}>
    <${Section} title="Timeline" id="rec-timeline">
      ${entries.length ? html`<ol class="timeline">${entries.map((e, i) => html`<li key=${i}><span class="tl-dot"><${Icon} name=${e.icon} /></span><div><p>${e.text}</p><small>${e.day ? html`<${Day} iso=${e.at.slice(0, 10)} />` : ago(e.at)}</small></div></li>`)}</ol>` : html`<p class="muted-text">No activity recorded yet.</p>`}
    </${Section}>`;
}

// ---------------------------------------------------------------------------
export function ConfirmSubmissionDialog({ id }) {
  const job = store.state.jobs.find(j => j.id === id);
  if (!job) return null;
  return html`<${Dialog} title="Confirm your submission" size="sm" onClose=${closeDialog}>
    <p>Did you personally submit your application for <strong>${job.title}</strong> at <strong>${job.company}</strong> and see confirmation on the employer’s site?</p>
    <${Notice} tone="info">This only updates your tracker. Plainhand does not submit anything from this button.</${Notice}>
    <div class="dialog-actions"><${Button} class="ghost" data-autofocus onClick=${closeDialog}>Not yet</${Button}><${ActionButton} class="primary" icon="check" onClick=${async () => { await api('jobs/update', { id: job.id, status: 'Applied', confirmSubmitted: true }); closeDialog(); toast('Application recorded. Good luck with the next step.'); refresh(); }}>Yes, I submitted it</${ActionButton}></div>
  </${Dialog}>`;
}
