// Profile & brain: the foundation form, resume import, the profile interview
// conversation and the reviewed understanding.
import { html, useState, store, api, refresh, toast, navigate, queueTask, runningTask, Icon, useDraft } from './core.mjs';
import { ActionButton, Button, Card, PageHeading, Field, Notice, Pill, Meter } from './components.mjs';
import { MessageList, Composer } from './conversation.mjs';
import { agentAvailable, agentClient } from './agent.mjs';

export function brainChecks(state) {
  return [
    [!!state.profile.resume, 'Experience & education'],
    [!!state.profile.story, 'Projects & your story'],
    [!!state.profile.voice, 'Your writing voice'],
    [!!state.understanding?.approved, 'Understanding reviewed'],
  ];
}

const FIELDS = [
  ['name', 'Full name', 'How you introduce yourself', { required: true, autocomplete: 'name' }],
  ['email', 'Email', 'you@example.com', { type: 'email', autocomplete: 'email' }],
  ['phone', 'Phone', '+1 …', { autocomplete: 'tel' }],
  ['location', 'Location', 'City, country · remote preferences', { required: true }],
  ['roles', 'Roles you’re looking for', 'Mechanical engineer, manufacturing engineer…', { required: true, full: true }],
  ['graduation', 'Education & graduation', 'B.S. Mechanical Engineering · May 2027', {}],
  ['timezone', 'Time zone', 'America/New_York', {}],
  ['compensation', 'Compensation preferences', 'Range, currency, or still exploring', {}],
  ['eligibility', 'Work authorization', 'Your exact status, if you want to share it', {}],
  ['links', 'Portfolio & professional links', 'LinkedIn, GitHub, portfolio…', { full: true }],
];
const STORY = [
  ['story', 'The story your resume doesn’t tell', 'Projects you cared about, team contributions, obstacles, work outside school…', 'Real examples help your agent find the right story for each application.'],
  ['voice', 'How you sound', 'Paste a short piece of your writing. Add preferences such as direct, warm, concise…', 'Your agent matches this voice in cover letters and answers.'],
  ['constraints', 'What matters to you', 'Industries, locations, deal-breakers, things to avoid…', ''],
];

function readFile(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
}

function Foundation() {
  const state = store.state;
  const [draft, setDraft, clear, dirty] = useDraft('profile', null);
  const values = draft?.values || state.profile;
  const set = key => value => setDraft({ revision: draft?.revision ?? state.revision, values: { ...values, [key]: value } });
  async function save(event) {
    event.preventDefault();
    try {
      await api('profile', { profile: values, revision: draft?.revision ?? state.revision });
      clear(); toast('Profile saved. Your agent has a stronger foundation.'); refresh();
    } catch (error) {
      if (/workspace changed/i.test(error.message)) { await refresh(); setDraft({ revision: store.state.revision, values }); }
      toast(error.message, true);
    }
  }
  async function importResume(event) {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file under 5 MB.');
      const content = await readFile(file);
      toast('Reading your resume…');
      const result = await api('resume/import', { name: file.name, content });
      setDraft({ revision: draft?.revision ?? store.state.revision, values: { ...values, resume: result.text } });
      toast('Resume imported. Check the text, then save your profile.');
    } catch (error) { toast(error.message, true); }
  }
  return html`<${Card} title="Your foundation" icon="file" id="foundation-title" subtitle="A starting point. Your agent asks about the rest." actions=${state.profile.resume ? html`<${Pill} tone="success" icon="lock">Saved on this computer</${Pill}>` : null}>
    <form id="profile-form" class="form-grid" onSubmit=${save}>
      ${FIELDS.map(([name, label, placeholder, opts]) => html`<${Field} key=${name} form="profile" name=${name} label=${label} placeholder=${placeholder} value=${values[name] || ''} onInput=${set(name)} ...${opts} />`)}
      <div class="field full">
        <label for="profile-resume">Your resume</label>
        <label class="upload-box" for="resume-file"><${Icon} name="upload" /><span>Import a PDF, Markdown or text file</span><small>up to 5 MB</small></label>
        <input type="file" class="visually-hidden" id="resume-file" accept=".pdf,.md,.txt" onChange=${importResume} />
        <textarea id="profile-resume" name="resume" class="large" required placeholder="Or paste your resume here. Keep real dates, project details and achievements." value=${values.resume || ''} onInput=${e => set('resume')(e.currentTarget.value)} aria-describedby="profile-resume-hint"></textarea>
        <small id="profile-resume-hint">PDF import needs Poppler. Imported text appears here for your review before saving.</small>
      </div>
      ${STORY.map(([name, label, placeholder, hint]) => html`<${Field} key=${name} form="profile" name=${name} label=${label} placeholder=${placeholder} hint=${hint} area full value=${values[name] || ''} onInput=${set(name)} />`)}
      <div class="form-footer full"><small>${dirty ? html`<strong>Unsaved changes</strong> · ` : 'Saved locally when you choose Save · '}You control the facts.</small><button type="submit" class="button primary"><${Icon} name="check" />Save my profile</button></div>
    </form>
  </${Card}>`;
}

function Interview() {
  const state = store.state;
  const interviewing = runningTask('interview');
  const blocked = !state.provider || !state.profile.resume;
  const first = state.profile.name?.split(' ')[0] || 'You';
  const opening = { id: 'opening', role: 'assistant', text: 'What’s a project or experience you’re proud of, and what did you personally contribute? I’ll use your resume as a starting point, then we’ll build a fuller picture together.' };
  return html`<${Card} title="Let’s connect the dots." icon="brain" id="interview-title" subtitle="A conversation, not another questionnaire. Only what you write becomes evidence." class="interview">
    ${!state.provider ? html`<${Notice} tone="info">First connect your AI account, then Plainhand can talk with you here. <a href="#connections">Connect it</a></${Notice}>`
      : !state.profile.resume ? html`<${Notice} tone="info">First save your basics and resume in step 1; Plainhand uses them to ask better questions.</${Notice}>`
      : html`<${MessageList} label="Profile interview" messages=${state.conversation.length ? state.conversation.slice(-12) : [opening]} streaming=${interviewing ? ' ' : ''} authorFor=${m => m.role === 'user' ? first : 'Plainhand'} />`}
    <${Composer} draftKey="interview" label="Your message" placeholder="Tell me a little about it…" disabled=${blocked} busy=${!!interviewing}
      hint="Shared with your selected agent · Enter to send"
      onSend=${async text => { await api('conversation', { text }); toast('Your agent is connecting the dots…'); refresh(); }} />
  </${Card}>`;
}

function Understanding() {
  const state = store.state;
  const u = state.understanding;
  const interviewing = runningTask('interview');
  const blocked = !state.provider || !state.profile.resume;
  return html`<${Card} title="How your agent sees you" icon="spark" id="understanding-title" subtitle="You review this before it becomes trusted guidance." actions=${u?.approved ? html`<${Pill} tone="success" icon="check">Reviewed</${Pill}>` : u ? html`<${Pill} tone="warn">Awaiting your review</${Pill}>` : null}>
    ${u ? html`<div class="understanding">
        <p class="understanding-summary">${u.result.summary}</p>
        <h4>Strengths</h4><ul class="plain-list">${u.result.strengths.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul>
        <h4>Your voice</h4><p>${u.result.voice}</p>
        <h4>A sample answer</h4><blockquote class="sample">${u.result.sampleAnswer}</blockquote>
        ${u.result.gaps.length ? html`<h4>Still to learn</h4><ul class="plain-list">${u.result.gaps.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul>` : null}
      </div>
      ${!u.approved ? html`<${ActionButton} class="primary wide" icon="check" onClick=${async () => { await api('understanding/approve', {}); toast('Understanding reviewed. Your original evidence remains the source of truth.'); refresh(); }}>This reflects me</${ActionButton}>` : null}`
      : html`<p class="muted-text">After a conversation, an understanding of your background and voice appears here.</p>`}
    <${ActionButton} class="ghost wide" icon="refresh" disabled=${blocked || !!interviewing} onClick=${() => queueTask('interview')}>Build understanding</${ActionButton}>
  </${Card}>`;
}

// Profile strength (plainhand/profile-strength.mjs, computed by the server): what Plainhand
// counted for each dimension and the weakest spots, never a single grade.
const LEVEL = { strong: ['success', 'Strong'], good: ['info', 'Good'], thin: ['warn', 'Thin'], 'not-enough-data': ['neutral', 'Not enough data'] };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = value => value === null || value === undefined ? '—' : Math.round(value * 100) + '%';
export function strengthRows(s) {
  return [
    ['Foundation', s.foundation.level, `${s.foundation.present} of ${s.foundation.total} essentials${s.foundation.missing.length ? ` · missing ${s.foundation.missing.join(', ')}` : ''}`],
    ['Story depth', s.depth.level, `${s.depth.statements === 1 ? '1 story' : s.depth.statements + ' stories'} in your words · ${plural(s.depth.words, 'word')} · ${s.depth.withNumbers} with numbers`],
    ['Role coverage', s.coverage.level, s.coverage.evaluated < s.coverage.minimum
      ? `${s.coverage.evaluated} of ${s.coverage.minimum} evaluated roles needed`
      : `${pct(s.coverage.average)} of requirements backed by evidence across ${plural(s.coverage.evaluated, 'role')} · ${pct(s.coverage.storyEvidenceShare)} of evidence from your stories`],
    ['Your review', s.review.level, s.review.built
      ? `${s.review.approved} of ${s.review.built} ${s.review.built === 1 ? 'summary' : 'summaries'} approved${s.review.openQuestions !== null ? ` · ${plural(s.review.openQuestions, 'open question')}${s.review.openQuestionsBefore !== null ? ` (was ${s.review.openQuestionsBefore})` : ''}` : ''}`
      : 'No understanding built yet'],
  ];
}
function Strength() {
  const s = store.state.profileStrength;
  if (!s) return null;
  return html`<${Card} title="Profile strength" icon="layers" id="strength-title" subtitle="How well your agent knows you, counted from what you’ve shared. Not a grade.">
    <ul class="strength-rows">${strengthRows(s).map(([name, level, detail]) => html`<li key=${name}><div><strong>${name}</strong><span>${detail}</span></div><${Pill} tone=${LEVEL[level][0]}>${LEVEL[level][1]}</${Pill}></li>`)}</ul>
    ${s.next.length ? html`<h4>What would help most</h4><ol class="plain-list strength-next">${s.next.map((n, i) => html`<li key=${i}>${n.text}</li>`)}</ol>
      ${agentAvailable() ? html`<${ActionButton} class="ghost wide" icon="spark" onClick=${async () => { navigate('home'); await agentClient.send('Help me strengthen my profile'); }}>Work on this with your agent</${ActionButton}>` : null}`
      : html`<p class="muted-text">Nothing stands out. Keep adding stories as you have new experiences.</p>`}
  </${Card}>`;
}

// The standard application (plainhand/standard.mjs): approved once, the base of every application.
function RequestBox({ id, label, placeholder, onSubmit, disabled }) {
  const [draft, setDraft, clear] = useDraft(id, '');
  async function submit(event) { event.preventDefault(); const text = (draft || '').trim(); if (!text) return; await onSubmit(text); clear(); }
  return html`<form class="request-box" onSubmit=${submit}><${Field} form=${id} name="request" label=${label} value=${draft || ''} onInput=${setDraft} placeholder=${placeholder} disabled=${disabled} /><${Button} type="submit" icon="edit" disabled=${disabled || !(draft || '').trim()}>Ask for this change</${Button}></form>`;
}
const STANDARD_PILL = { approved: ['success', 'Your standard'], draft: ['warn', 'Awaiting your review'], stale: ['danger', 'Out of date'] };
function Standard() {
  const state = store.state;
  const s = state.standard, status = state.standardStatus || 'none';
  const writing = runningTask('standard'), blocked = !state.provider || !state.profile.resume || !!writing;
  const pill = STANDARD_PILL[status];
  return html`<${Card} title="Your standard application" icon="file" id="standard-title" subtitle="One resume and cover letter you approve once. Every application starts from it and changes only what the role calls for." actions=${pill ? html`<${Pill} tone=${pill[0]}>${pill[1]}</${Pill}>` : null}>
    ${!s ? html`<p class="muted-text">After your profile has a few stories, write your standard. You review it like any application; nothing is used until you approve it.</p>
        <${ActionButton} class="primary wide" icon="file" disabled=${blocked} onClick=${() => queueTask('standard')}>Write my standard application</${ActionButton}>` : html`
      ${status === 'stale' ? html`<${Notice} tone="danger" title="Your profile changed">Rewrite your standard so it reflects what you've added.</${Notice}>` : null}
      <article class="document" aria-label="Standard resume"><h4 class="doc-name">${s.draft.headline}</h4>
        ${s.draft.resume.map((entry, i) => html`${i === 0 || s.draft.resume[i - 1].section !== entry.section ? html`<h5>${entry.section}</h5>` : null}<p key=${i}>${entry.text}</p>`)}</article>
      <details class="trace"><summary><${Icon} name="file" />Standard cover letter</summary><article class="document letter" aria-label="Standard cover letter"><p>${s.draft.coverLetter}</p></article></details>
      ${s.calibration ? html`<p class="muted-text">${s.calibration.counts.balanced} of ${s.calibration.total} claims match your evidence${s.calibration.counts.stretched + s.calibration.counts.unsupported ? ` · ${s.calibration.counts.stretched + s.calibration.counts.unsupported} stronger than it` : ''}${s.calibration.counts.undersold ? ` · ${s.calibration.counts.undersold} undersold` : ''}.</p>` : null}
      ${status === 'draft' && !store.demo ? html`<${ActionButton} class="primary wide" icon="check" onClick=${async () => { await api('standard/approve', {}); toast('This is now your standard. New applications start from it.'); refresh(); }}>Use this as my standard</${ActionButton}>` : null}
      ${store.demo ? null : html`<${RequestBox} id="standard-request" label="Change your standard" placeholder="Lead with the chassis project; keep the letter under 200 words" disabled=${blocked} onSubmit=${text => queueTask('standard', null, { request: text })} />
        <${ActionButton} class="ghost wide" icon="refresh" disabled=${blocked} onClick=${() => queueTask('standard')}>Rewrite from scratch</${ActionButton}>`}`}
  </${Card}>`;
}
export { RequestBox };

// The candidate's resume format (plainhand/resume-format.mjs): read from their own PDF,
// adjusted here, and used for every resume and cover letter.
const FORMAT_DEFAULT = { page: 'letter', margins: { top: 0.6, right: 0.7, bottom: 0.6, left: 0.7 }, font: { family: 'sans', name: 'Arial', size: 10.5, lineHeight: 1.3 }, name: { size: 22, align: 'left' }, contact: { separator: ' · ', align: 'left' }, headings: { case: 'upper', size: 11, rule: true }, sections: [], entry: { datesRight: true, titleItalic: true }, bullet: '•' };
function Format() {
  const saved = store.state.resumeFormat;
  const [draft, setDraft, clear] = useDraft('resume-format', null);
  const [preview, setPreview] = useState(null);
  const f = draft || saved || FORMAT_DEFAULT;
  const set = (path, value) => { const next = structuredClone(f); let o = next; const keys = path.split('.'); for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = value; setDraft({ ...next, source: next.source === 'derived' ? 'edited' : next.source || 'edited' }); };
  const show = async format => { try { setPreview((await api('format/preview', { format })).image); } catch (error) { toast(error.message, true); } };
  async function upload(event) {
    const file = event.currentTarget.files[0]; event.currentTarget.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a PDF under 5 MB.');
      const content = await readFile(file);
      const { format } = await api('format/derive', { content });
      setDraft(format); toast('Read your format. Check it below, then save.'); show(format);
    } catch (error) { toast(error.message, true); }
  }
  const select = (label, path, options, value) => html`<div class="field"><label for=${'fmt-' + path}>${label}</label><select id=${'fmt-' + path} value=${String(value)} onChange=${e => set(path, options.find(o => String(o[0]) === e.currentTarget.value)[0])}>${options.map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}</select></div>`;
  const number = (label, path, value, step, min, max) => html`<div class="field"><label for=${'fmt-' + path}>${label}</label><input id=${'fmt-' + path} type="number" step=${step} min=${min} max=${max} value=${value} onInput=${e => set(path, Number(e.currentTarget.value))} /></div>`;
  return html`<${Card} title="Your resume format" icon="file" id="format-title" subtitle="Upload a PDF of your own resume and Plainhand matches its layout in every resume and cover letter: fonts, sizes, margins, headings, section order, dates and bullets. Only the format is kept, not the text." actions=${html`<${Pill} tone=${saved ? 'success' : 'neutral'}>${saved ? (saved.source === 'derived' ? 'From your resume' : 'Your format') : 'Default'}</${Pill}>`}>
    ${store.demo ? null : html`<label class="button"><${Icon} name="upload" /><span>Read format from my resume PDF</span><input type="file" accept="application/pdf,.pdf" class="visually-hidden" aria-label="Resume PDF to read the format from" onChange=${upload} /></label>`}
    <div class="format-grid">
      ${select('Page', 'page', [['letter', 'US Letter'], ['a4', 'A4']], f.page)}
      ${select('Font', 'font.family', [['serif', 'Serif (Times-like)'], ['sans', 'Sans (Arial-like)']], f.font.family)}
      <div class="field"><label for="fmt-font-name">Font name</label><input id="fmt-font-name" value=${f.font.name} onInput=${e => set('font.name', e.currentTarget.value)} /></div>
      ${number('Text size (pt)', 'font.size', f.font.size, 0.5, 8, 13)}
      ${number('Line spacing', 'font.lineHeight', f.font.lineHeight, 0.05, 1, 1.8)}
      ${number('Name size (pt)', 'name.size', f.name.size, 1, 12, 36)}
      ${select('Name and contact', 'name.align', [['left', 'Left'], ['center', 'Centered']], f.name.align)}
      ${select('Contact separator', 'contact.separator', [[' | ', 'a | b'], [' • ', 'a • b'], [' · ', 'a · b'], [' - ', 'a - b'], [', ', 'a, b']], f.contact.separator)}
      ${select('Section headings', 'headings.case', [['upper', 'UPPERCASE'], ['title', 'Title Case'], ['as-is', 'As written']], f.headings.case)}
      ${number('Heading size (pt)', 'headings.size', f.headings.size, 0.5, 8, 18)}
      ${select('Line under headings', 'headings.rule', [[true, 'Yes'], [false, 'No']], f.headings.rule)}
      ${select('Dates', 'entry.datesRight', [[true, 'Right margin'], [false, 'After the title']], f.entry.datesRight)}
      ${select('Bullets', 'bullet', [['•', '•'], ['▪', '▪'], ['–', '–'], ['-', '-'], ['none', 'None']], f.bullet)}
      ${number('Side margins (in)', 'margins.left', f.margins.left, 0.05, 0.25, 1.5)}
    </div>
    <div class="field full"><label for="fmt-sections">Section names, in order</label><input id="fmt-sections" value=${f.sections.join(', ')} placeholder="Education, Experience, Projects, Skills" onInput=${e => set('sections', e.currentTarget.value.split(',').map(s => s.trim()).filter(Boolean))} /><small>Your drafts use these names and this order.</small></div>
    <div class="action-row">
      <${ActionButton} icon="search" onClick=${() => show(f)}>Preview</${ActionButton}>
      ${store.demo ? null : html`<${ActionButton} class="primary" icon="check" disabled=${!draft} onClick=${async () => { await api('format/save', { format: { ...f, margins: { ...f.margins, right: f.margins.left } } }); clear(); toast('Format saved. New resumes and cover letters use it.'); refresh(); }}>Save format</${ActionButton}>`}
      ${saved && !store.demo ? html`<${ActionButton} class="ghost" onClick=${async () => { await api('format/save', { reset: true }); clear(); setPreview(null); refresh(); }}>Use the default</${ActionButton}>` : null}
    </div>
    ${preview ? html`<img class="format-preview" src=${preview} alt="Preview of a resume in this format" />` : null}
  </${Card}>`;
}

// Writing samples: the candidate's own text, used for voice (never for facts).
function Samples() {
  const samples = store.state.writingSamples || [];
  const [draft, setDraft, clear] = useDraft('writing-sample', { title: '', text: '' });
  const value = draft || { title: '', text: '' };
  async function add(event) {
    event.preventDefault();
    try { await api('samples/add', { title: value.title, text: value.text }); clear(); toast('Writing sample saved. Your next drafts will sound more like you.'); refresh(); }
    catch (error) { toast(error.message, true); }
  }
  return html`<${Card} title="How you write" icon="quote" id="samples-title" subtitle="Paste a few things you wrote yourself: an email, a post, a past cover letter, a project write-up. Your agent matches the voice; it never takes facts from them.">
    ${samples.length ? html`<ul class="plain-list sample-list">${samples.map(s => html`<li key=${s.id}><div><strong>${s.title || 'Writing sample'}</strong><span class="muted-text">${s.text.slice(0, 140)}${s.text.length > 140 ? '…' : ''}</span></div>${store.demo ? null : html`<${ActionButton} class="link-button small" onClick=${async () => { await api('samples/remove', { id: s.id }); refresh(); }}>Remove</${ActionButton}>`}</li>`)}</ul>` : null}
    ${store.demo || samples.length >= 10 ? null : html`<form class="sample-form" onSubmit=${add}>
      <${Field} form="sample" name="title" label="Title (optional)" value=${value.title} onInput=${v => setDraft({ ...value, title: v })} placeholder="Email to my project team" />
      <${Field} form="sample" name="text" area=${true} label="Your writing" value=${value.text} onInput=${v => setDraft({ ...value, text: v })} placeholder="Paste it here, unedited." />
      <${Button} type="submit" class="primary" icon="plus" disabled=${!value.text.trim()}>Add writing sample</${Button}>
    </form>`}
  </${Card}>`;
}

// Where the candidate draws the line on wording (plainhand/claim-line.mjs).
function Line() {
  const line = store.state.claimLineView;
  if (!line) return null;
  const empty = !line.decisions && !line.statements.length;
  return html`<${Card} title="Where you draw the line" icon="shield" id="line-title" subtitle="How strongly you like your real experience worded, from underselling to stretching. Nothing without evidence is ever used.">
    ${empty ? html`<p class="muted-text">As you choose wording on flagged claims in your applications, Plainhand learns where you draw the line. You can also just tell your agent, for example whether coordinating a team counts as leading it.</p>` : html`
      ${line.summary.length ? html`<ul class="plain-list">${line.summary.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul>` : html`<p class="muted-text">${line.decisions} ${line.decisions === 1 ? 'choice' : 'choices'} so far; a pattern shows after two of the same kind.</p>`}
      ${line.statements.length ? html`<h4>In your words</h4><ul class="plain-list line-statements">${line.statements.map((s, i) => html`<li key=${i}><span>“${s}”</span>${store.demo ? null : html`<${ActionButton} class="link-button small" onClick=${async () => { await api('line/remove', { index: i }); refresh(); }}>Remove</${ActionButton}>`}</li>`)}</ul>` : null}`}
    ${agentAvailable() ? html`<${ActionButton} class="ghost wide" icon="spark" onClick=${async () => { navigate('home'); await agentClient.send('Help me decide how strongly my experience should be worded'); }}>Talk it through with your agent</${ActionButton}>` : null}
  </${Card}>`;
}

// Guided setup: one step open at a time, in the order that makes the next step work.
let skipFormat = false;
try { skipFormat = localStorage.getItem('plainhand:skip-format') === '1'; } catch {}
function profileSteps(state) {
  const statements = (state.conversation || []).filter(m => m.role === 'user').length;
  const basics = !!(state.profile.name && state.profile.resume);
  return [
    { key: 'basics', title: 'Your basics and resume', why: 'Name, contact details, the roles you want, and your resume. Everything else builds on this.', done: basics, body: () => html`<${Foundation} />` },
    { key: 'format', title: 'Your resume format', optional: true, why: 'Upload your own resume PDF so every resume and cover letter looks like yours. Optional.', done: !!state.resumeFormat || skipFormat, locked: !basics && 'Do step 1 first.',
      body: () => html`<${Format} />${state.resumeFormat ? null : html`<div class="center-row"><${Button} class="ghost" onClick=${() => { skipFormat = true; try { localStorage.setItem('plainhand:skip-format', '1'); } catch {} refresh(); }}>Use the default format for now</${Button}></div>`}` },
    { key: 'story', title: 'Tell your story', why: 'Talk about projects and jobs you’re proud of, and paste a few things you’ve written. Plainhand keeps your words exactly.', done: statements >= 3, progress: statements ? `${statements} so far · 3 or more works well` : '', locked: !basics ? 'Do step 1 first.' : !state.provider && 'Connect your AI account first (Connections).',
      body: () => html`<${Interview} /><${Samples} />` },
    { key: 'understanding', title: 'Check how Plainhand sees you', why: 'Plainhand sums up your strengths and voice. Approve it only if it’s right.', done: !!state.understanding?.approved, locked: statements < 1 && 'Tell your story first (step 3).', body: () => html`<${Understanding} />` },
    { key: 'standard', title: 'Approve your standard application', why: 'One resume and cover letter that every application starts from.', done: state.standardStatus === 'approved', locked: !state.understanding?.approved && 'Approve how Plainhand sees you first (step 4).', body: () => html`<${Standard} />` },
  ];
}
function Steps() {
  const state = store.state;
  const steps = profileSteps(state);
  // A summary waiting for review comes first; otherwise the first step still to do.
  const current = state.understanding && !state.understanding.approved ? 'understanding' : steps.find(s => !s.done && !s.locked && !s.optional)?.key;
  // A manual choice holds until the next step changes, then the new step opens.
  const [choice, setOpen] = useState(null);
  const open = choice && choice.for === current ? choice.key : null;
  return html`<ol class="profile-steps">${steps.map((step, i) => {
    const expanded = (open ?? current) === step.key;
    const status = step.done ? html`<${Pill} tone="success" icon="check">Done</${Pill}>` : step.locked ? html`<${Pill} tone="neutral">Later</${Pill}>` : step.key === current ? html`<${Pill} tone="accent">Next</${Pill}>` : null;
    return html`<li key=${step.key} class=${'profile-step' + (expanded ? ' open' : '') + (step.done ? ' done' : '')}>
      <button type="button" class="step-head" aria-expanded=${expanded} onClick=${() => setOpen({ key: expanded ? '' : step.key, for: current })}>
        <span class="step-number">${step.done ? html`<${Icon} name="check" />` : i + 1}</span>
        <span class="step-text"><strong>${step.title}${step.optional ? html` <small class="muted-text">optional</small>` : null}</strong><span class="muted-text">${step.locked && !step.done ? step.locked : step.progress || step.why}</span></span>${status}
      </button>
      ${expanded ? html`<div class="step-body">${step.locked && !step.done ? html`<${Notice} tone="info">${step.locked}</${Notice}>` : step.body()}</div>` : null}
    </li>`;
  })}</ol>`;
}

export function ProfilePage() {
  const state = store.state;
  const steps = profileSteps(state), done = steps.filter(s => s.done).length;
  const started = (state.conversation || []).some(m => m.role === 'user');
  return html`
    <${PageHeading} title="Profile & brain" subtitle="Five short steps so Plainhand can represent you well. Everything it writes traces back to what you give it here." />
    <section class="brain-strip" aria-label="Setup progress">
      <div class="brain-strip-head"><strong>Your setup</strong><span>${done} of ${steps.length}</span></div>
      <${Meter} value=${done} max=${steps.length} label="Setup progress" />
    </section>
    <${Steps} />
    ${started ? html`<h2 class="section-heading">Keep improving</h2><${Strength} /><${Line} />` : null}
    ${store.demo ? null : html`<p class="footnote">Profile facts are saved to <code>config/profile.yml</code> and <code>cv.md</code>. <${Button} class="link-button inline" onClick=${() => navigate('workspace')}>See your files</${Button}></p>`}`;
}
