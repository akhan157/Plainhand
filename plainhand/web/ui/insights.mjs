// Insights: whether score bands relate to interviews, pattern performance with
// sample sizes, and suggestions the candidate approves, rejects or defers.
// Data comes from the insights.* registry actions (plainhand/features/insights.mjs).
// Missing data is shown as "not enough outcomes", never as 0%.
import { html, useEffect, useState, store, api, toast, navigate, Icon, plural } from './core.mjs';
import { ActionButton, Button, Card, PageHeading, Empty, Notice, Pill, Field, Spinner } from './components.mjs';

const act = async (name, input = {}) => (await api('action', { name, input })).result;
const pct = value => `${Math.round(value * 100)}%`;
const KIND = { threshold: 'Score threshold', target: 'Targets', narrative: 'Narrative', channel: 'Follow-up channel', portal: 'Portal' };

function Rate({ value, provisional, insufficient, observed, minimum, alt }) {
  if (insufficient || value === null || value === undefined) {
    return html`<span class="insight-rate is-missing"><${Pill} tone="neutral" icon="info">Not enough data</${Pill}>${observed !== undefined ? html`<small>${observed} of ${minimum} outcomes</small>` : null}</span>`;
  }
  const width = Math.round(value * 20) * 5;
  return html`<span class="insight-rate">
    <span class="insight-bar" aria-hidden="true"><span class=${'insight-bar-fill w' + width}></span></span>
    <strong>${pct(value)}</strong>${provisional ? html`<${Pill} tone="warn">Provisional</${Pill}>` : null}
    ${alt !== null && alt !== undefined ? html`<small>${pct(alt)} if silence means no</small>` : null}
  </span>`;
}

function BandTable({ summary }) {
  const minimum = summary.minimums.band;
  return html`<div class="table-wrap"><table class="insight-bands">
    <caption class="visually-hidden">Applications and outcomes by fit score band</caption>
    <thead><tr><th scope="col">Band</th><th scope="col">Applied</th><th scope="col">Interview</th><th scope="col">Offer</th><th scope="col">Rejected</th><th scope="col">Pending</th><th scope="col">Silent</th><th scope="col">Interview rate</th></tr></thead>
    <tbody>${summary.bands.map(band => html`<tr key=${band.key}>
      <th scope="row" data-label="Score band"><span>${band.label}</span><span class="sub">${band.evaluated} scored</span></th>
      <td data-label="Applied" class="num">${band.applied}</td>
      <td data-label="Interview" class="num">${band.interviews}</td><td data-label="Offer" class="num">${band.offers}</td>
      <td data-label="Rejected" class="num">${band.rejected}</td><td data-label="Pending" class="num">${band.pending}</td>
      <td data-label="Silent" class="num">${band.silent}</td>
      <td data-label="Interview rate"><${Rate} value=${band.interviewRate} provisional=${band.provisional} insufficient=${band.insufficientData} observed=${band.observed} minimum=${minimum} alt=${band.interviewRateIfSilenceIsNo} /></td>
    </tr>`)}</tbody></table></div>`;
}

function ScoreBands({ summary }) {
  const o = summary.overall;
  const tone = summary.correlation.status === 'insufficient-data' ? 'info' : summary.correlation.status === 'higher-scores-fewer-interviews' ? 'warn' : 'neutral';
  return html`<${Card} title="Score bands and interviews" icon="layers" id="insight-bands-title" subtitle="Do higher fit scores go with more interviews? Counted from your own applications.">
    <${Notice} tone=${tone} title=${summary.correlation.status === 'insufficient-data' ? 'Not enough outcomes yet' : 'What your outcomes show'}>${summary.correlation.statement}</${Notice}>
    <dl class="stat-grid">
      <div><dt>Applied</dt><dd>${o.applied}</dd><small>${summary.sources.legacyTrackerRows ? `Includes ${plural(summary.sources.legacyTrackerRows, 'tracker row')} from before Plainhand` : 'From your Plainhand applications'}</small></div>
      <div><dt>Observed outcomes</dt><dd>${o.observed}</dd><small>${o.insufficientData ? `${o.minimum} needed to compare bands` : 'Enough to compare bands'}</small></div>
      <div><dt>Reached interview</dt><dd>${o.interviews}</dd><small>${o.rejectedAfterInterview ? `${o.rejectedAfterInterview} later rejected` : 'Interview, offer or a recorded round'}</small></div>
      <div><dt>Silent (assumed)</dt><dd>${o.silent}</dd><small>No change for ${summary.silenceDays} days; not a rejection</small></div>
    </dl>
    <${BandTable} summary=${summary} />
    <p class="detail">A band shows a rate once it has ${summary.minimums.band} observed outcomes (interview, offer or rejection). Rates stay provisional until ${summary.minimums.overall} outcomes overall. ${o.unscoredApplications ? `${plural(o.unscoredApplications, 'application')} without a score are not in any band.` : ''}</p>
  </${Card}>`;
}

const PATTERN_ROWS = 5;
function PatternTable({ d }) {
  const [all, setAll] = useState(false);
  // Groups with one application each say nothing on their own; show the largest first.
  const rows = all ? d.groups : d.groups.slice(0, PATTERN_ROWS);
  const hidden = d.groups.length - rows.length;
  return html`<section class="insight-pattern" aria-labelledby=${'pattern-' + d.field}>
    <h3 id=${'pattern-' + d.field}>${d.label}${d.fromReports ? html` <small class="muted-inline">from report summaries</small>` : null}</h3>
    <div class="table-wrap"><table>
      <caption class="visually-hidden">${d.label} performance</caption>
      <thead><tr><th scope="col">${d.label} and evidence</th><th scope="col">Applied</th><th scope="col">Observed</th><th scope="col">Interviews</th><th scope="col">Interview rate</th></tr></thead>
      <tbody>${rows.map(g => html`<tr key=${g.value}>
        <th scope="row" class="pattern-value"><span>${g.value}</span><span class="sub">${g.evidence}</span></th>
        <td data-label="Applied" class="num">${g.sample}</td><td data-label="Observed" class="num">${g.observed}</td><td data-label="Interviews" class="num">${g.interviews}</td>
        <td data-label="Interview rate"><${Rate} value=${g.interviewRate} insufficient=${g.insufficientData} /></td>
      </tr>`)}</tbody></table></div>
    ${hidden || all ? html`<button type="button" class="button ghost small" aria-expanded=${all ? 'true' : 'false'} onClick=${() => setAll(!all)}><${Icon} name=${all ? 'chevronDown' : 'plus'} />${all ? 'Show fewer' : `Show ${hidden} more (${d.groups.slice(PATTERN_ROWS).every(g => g.insufficientData) ? 'all with not enough data' : 'mixed'})`}</button>` : null}
    ${d.more ? html`<p class="detail">${d.more} more not listed.</p>` : null}
  </section>`;
}

function Patterns({ patterns }) {
  const shown = patterns.dimensions.filter(d => d.available);
  const missing = patterns.dimensions.filter(d => !d.available);
  return html`<${Card} title="Patterns" icon="activity" id="insight-patterns-title" subtitle="Interview rates by archetype, company, narrative, channel and portal, each with its sample size.">
    <p class="detail">${patterns.note} Negative evidence means enough outcomes and no interviews.</p>
    ${shown.length ? shown.map(d => html`<${PatternTable} key=${d.field} d=${d} />`) : html`<${Empty} compact>No patterns yet. They appear as you apply and record outcomes.</${Empty}>`}
    ${missing.length ? html`<ul class="insight-missing">${missing.map(d => html`<li key=${d.field}><strong>${d.label}</strong><span>${d.limit}</span></li>`)}</ul>` : null}
    ${patterns.sourceWarnings.map(w => html`<p class="detail" key=${w.code}><${Icon} name="info" /> ${w.message}</p>`)}
  </${Card}>`;
}

function Decide({ rec, onDone, allowApprove = true }) {
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const run = async verb => {
    const result = await act(`insights.${verb}`, { id: rec.id, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    toast(result.message); setMode(null); setReason(''); await onDone();
  };
  if (mode) return html`<form class="insight-reason" onSubmit=${e => e.preventDefault()}>
    <${Field} form=${'reason-' + rec.id} name="reason" label=${mode === 'reject' ? 'Why reject it?' : 'Why defer it?'} value=${reason} onInput=${setReason} hint="A short note for yourself." />
    <div class="row-actions"><${ActionButton} class="small primary" disabled=${!reason.trim()} onClick=${() => run(mode)}>${mode === 'reject' ? 'Reject suggestion' : 'Defer suggestion'}</${ActionButton}><${Button} class="small ghost" onClick=${() => { setMode(null); setReason(''); }}>Cancel</${Button}></div>
  </form>`;
  return html`<div class="row-actions">
    ${allowApprove ? html`<${ActionButton} class="small primary" icon="check" onClick=${() => run('approve')}>Approve</${ActionButton}>` : null}
    <${Button} class="small" onClick=${() => setMode('reject')}>Reject</${Button}>
    <${Button} class="small ghost" onClick=${() => setMode('defer')}>Defer</${Button}>
  </div>`;
}

function Recommendation({ rec, onDone, superseded }) {
  const decided = rec.status !== 'candidate';
  const statusPill = { approved: ['success', 'Approved'], rejected: ['neutral', 'Rejected'], deferred: ['info', 'Deferred'] }[rec.status];
  return html`<li class="insight-rec">
    <div class="insight-rec-head"><${Pill} tone="accent">${KIND[rec.kind] || 'Suggestion'}</${Pill}>${rec.confidence ? html`<${Pill}>${rec.confidence} confidence</${Pill}>` : null}${statusPill ? html`<${Pill} tone=${statusPill[0]}>${statusPill[1]}</${Pill}>` : null}${superseded ? html`<${Pill} tone="warn">Outcomes changed since</${Pill}>` : null}</div>
    <p class="insight-rec-text">${rec.message}</p>
    ${rec.evidence?.observed ? html`<p class="detail">Based on ${plural(rec.evidence.observed, 'observed outcome')}${rec.evidence.interviews !== undefined ? `, ${plural(rec.evidence.interviews, 'interview')}` : ''}.</p>` : null}
    ${rec.status === 'approved' ? html`<p class="detail"><${Icon} name="info" /> ${rec.howToApply}</p><${Button} class="small ghost" iconEnd="arrow" onClick=${() => navigate('profile')}>Open Profile</${Button}>` : null}
    ${rec.decisionReason ? html`<p class="detail">Your note: ${rec.decisionReason}</p>` : null}
    ${decided ? null : html`<${Decide} rec=${rec} onDone=${onDone} allowApprove=${!superseded} />`}
  </li>`;
}

function Suggestions({ recs, reload }) {
  const [showDecided, setShowDecided] = useState(false);
  const decided = [...recs.approved, ...recs.rejected, ...recs.deferred];
  const insufficient = recs.data.status === 'insufficient-data';
  const look = async () => { const result = await act('insights.suggest'); toast(result.message); await reload(); };
  return html`<${Card} title="Suggestions" icon="spark" id="insight-recs-title" subtitle="Changes your outcomes may support. You decide; approving records your decision and changes nothing."
    actions=${html`<${ActionButton} class="small" icon="refresh" disabled=${insufficient} onClick=${look}>Look for suggestions</${ActionButton}>`}>
    ${insufficient ? html`<${Notice} tone="info" title="Not enough outcomes yet">${recs.data.message}</${Notice}>`
      : recs.data.newSuggestions ? html`<${Notice} tone="info" icon="spark">${plural(recs.data.newSuggestions, 'new suggestion')} from your current outcomes. Select “Look for suggestions” to review ${recs.data.newSuggestions === 1 ? 'it' : 'them'}.</${Notice}>` : null}
    ${recs.pending.length ? html`<ul class="insight-recs" aria-label="Suggestions waiting for your decision">${recs.pending.map(r => html`<${Recommendation} key=${r.id} rec=${r} onDone=${reload} />`)}</ul>`
      : !insufficient ? html`<${Empty} compact>No suggestions waiting for you.</${Empty}>` : null}
    ${recs.superseded.length ? html`<h3 class="insight-sub">Earlier suggestions</h3><p class="detail">Your outcomes changed after these were made. Reject or defer them; a current version appears as a new suggestion.</p>
      <ul class="insight-recs">${recs.superseded.map(r => html`<${Recommendation} key=${r.id} rec=${r} onDone=${reload} superseded />`)}</ul>` : null}
    ${decided.length ? html`<button type="button" class="button ghost small" aria-expanded=${showDecided ? 'true' : 'false'} aria-controls="insight-decided" onClick=${() => setShowDecided(!showDecided)}><${Icon} name=${showDecided ? 'chevronDown' : 'chevron'} />Decided (${decided.length})</button>
      ${showDecided ? html`<ul class="insight-recs" id="insight-decided">${decided.map(r => html`<${Recommendation} key=${r.id} rec=${r} onDone=${reload} />`)}</ul>` : null}` : null}
    <p class="detail">${recs.note}</p>
  </${Card}>`;
}

function ObservedAssumed({ summary }) {
  return html`<${Card} title="Observed and assumed" icon="info" id="insight-oa-title" subtitle="What these numbers rest on.">
    <div class="two-col insight-oa">
      <section aria-labelledby="oa-observed"><h3 id="oa-observed"><${Icon} name="checkCircle" /> Observed</h3><ul>${summary.observedVsAssumed.observed.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul></section>
      <section aria-labelledby="oa-assumed"><h3 id="oa-assumed"><${Icon} name="alert" /> Assumed</h3><ul>${summary.observedVsAssumed.assumed.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul></section>
    </div>
  </${Card}>`;
}

export function InsightsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const revision = store.state?.revision;
  const load = async () => {
    try {
      const [summary, patterns, recs] = await Promise.all([act('insights.summary'), act('insights.patterns'), act('insights.recommendations')]);
      setData({ summary, patterns, recs }); setError(null);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { if (!store.demo) load(); }, [revision, store.demo]);
  const heading = html`<${PageHeading} title="Insights" subtitle="Whether your fit scores go with interviews, what is working, and suggestions you decide on. Nothing here changes your settings." />`;
  if (store.demo) return html`${heading}<${Card}><${Empty} icon="layers" title="Insights use your own outcomes.">Leave the sample workspace to see how your applications are going.</${Empty}></${Card}>`;
  if (error && !data) return html`${heading}<${Notice} tone="danger" title="Insights could not load">${error}</${Notice}>`;
  if (!data) return html`${heading}<div class="insight-loading"><${Spinner} label="Loading insights" /> Loading insights…</div>`;
  const { summary, patterns, recs } = data;
  if (summary.empty) return html`${heading}
    <${Card}><${Empty} icon="layers" title="No applications to learn from yet." action=${html`<${Button} iconEnd="arrow" onClick=${() => navigate('jobs')}>Find roles</${Button}>`}>Once you apply and record what happens (a reply, an interview, an offer or a rejection), Insights shows whether your scores go with interviews. Until then there is nothing to measure, which is not the same as 0%.</${Empty}></${Card}>
    <${ObservedAssumed} summary=${summary} />`;
  return html`${heading}
    <${ScoreBands} summary=${summary} />
    <${Suggestions} recs=${recs} reload=${load} />
    <${Patterns} patterns=${patterns} />
    <${ObservedAssumed} summary=${summary} />`;
}
