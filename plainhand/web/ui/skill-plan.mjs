// Skill gaps on the Insights page: which gaps keep coming up across the roles you
// evaluated (ranked towards roles you chose or applied to), and a learning plan for the
// ones you pick. The plan only advises: nothing here writes to your profile. When you
// finish a project you add it as a story yourself in Profile.
import { html, useEffect, useState, store, api, refresh, toast, navigate, Icon, ago, plural, ACTIVE, TASK_TITLES } from './core.mjs';
import { ActionButton, Button, Card, Empty, Notice, Pill, Spinner } from './components.mjs';

TASK_TITLES['skill-plan'] = 'Build a learning plan';
const act = async (name, input = {}) => (await api('action', { name, input })).result;

function Plan({ data }) {
  const { plan } = data, names = new Map([...(plan.gaps || [])].map(g => [g.id, g.text]));
  return html`<div class="sp-plan">
    <h3 class="insight-sub">Learning plan <small class="muted-inline">built ${ago(plan.createdAt)}</small></h3>
    ${plan.stale ? html`<${Notice} tone="warn">Your evaluations changed after this plan was built. Choose gaps and rebuild it.</${Notice}>` : null}
    <ol class="sp-list">${plan.plan.map(item => html`<li key=${item.gapId} class="sp-item">
      <strong>${names.get(item.gapId) || 'Skill gap'}</strong>
      <p><span class="sp-label">Learn</span> ${item.learn}</p>
      <p><span class="sp-label">Project</span> ${item.project}</p>
      <p><span class="sp-label">Time</span> ${item.estimate}</p>
      <p><span class="sp-label">Search for</span> ${item.searchTerms.map(t => html`<${Pill} key=${t}>${t}</${Pill}>`)}</p>
      ${item.adjacent.length ? html`<details class="trace"><summary>What you already have next to this · ${item.adjacent.length}</summary>
        <ul class="plain-list">${item.adjacent.map((a, i) => html`<li key=${i}>${a.claim}<ul class="fu-evidence">${a.evidence.map((e, j) => html`<li key=${j}><blockquote><cite>${e.label}</cite>${e.quote}</blockquote></li>`)}</ul></li>`)}</ul></details>` : null}
    </li>`)}</ol>
    <${Notice} tone="info" icon="info">This plan does not change your profile and is not a claim that you have these skills. When you finish a project, add it as a story in Profile in your own words.
      <div class="row-actions"><${Button} class="small ghost" iconEnd="arrow" onClick=${() => navigate('profile')}>Open Profile</${Button}></div></${Notice}>
  </div>`;
}

export function SkillGaps() {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(null);
  const revision = store.state?.revision;
  const load = async () => { try { setData(await act('skillPlan.get')); } catch { setData(null); } };
  useEffect(() => { if (!store.demo) load(); }, [revision, store.demo]);
  if (store.demo || !data) return null;
  const tasks = (store.state.tasks || []).filter(t => t.kind === 'skill-plan');
  const running = tasks.find(t => ACTIVE.includes(t.status));
  const failed = tasks[0] && ['failed', 'interrupted'].includes(tasks[0].status) && data.plan?.taskId !== tasks[0].id ? tasks[0] : null;
  const shown = data.gaps.slice(0, 15);
  const selected = picked || new Set(data.gaps.slice(0, data.defaultLimit).map(g => g.id));
  const toggle = id => { const next = new Set(selected); if (next.has(id)) next.delete(id); else if (next.size < data.maxLimit) next.add(id); setPicked(next); };
  const build = async () => {
    await act('skillPlan.build', { gapIds: shown.filter(g => selected.has(g.id)).map(g => g.id) });
    toast('Building your learning plan. Your profile is not changed.'); refresh();
  };
  return html`<${Card} title="Skill gaps" icon="layers" id="skill-gaps-title" subtitle="Gaps your evaluations keep raising, ranked towards roles you chose or applied to.">
    ${!data.gaps.length ? html`<${Empty} compact>${data.evaluated ? 'No gaps in your evaluated roles.' : 'Evaluate some roles to see which skill gaps keep coming up.'}</${Empty}>` : html`
      <div class="table-wrap"><table class="sp-table">
        <caption class="visually-hidden">Skill gaps across evaluated roles</caption>
        <thead><tr><th scope="col">Plan</th><th scope="col">Gap</th><th scope="col">Roles</th><th scope="col">Chosen</th><th scope="col">Applied</th></tr></thead>
        <tbody>${shown.map(g => html`<tr key=${g.id}>
          <td data-label="Plan"><input type="checkbox" aria-label=${'Include in plan: ' + g.text} checked=${selected.has(g.id)} onChange=${() => toggle(g.id)} /></td>
          <th scope="row" class="sp-gap"><span>${g.text}</span><details class="sp-roles"><summary>${plural(g.count, 'role')}</summary><ul class="plain-list">${g.roles.map(r => html`<li key=${r.jobId}>${r.label}${r.score !== null ? ` · ${r.score}` : ''}${r.applied ? ' · applied' : r.chosen ? ' · chosen' : ''}</li>`)}</ul></details></th>
          <td data-label="Roles" class="num"><span class="insight-bar" aria-hidden="true"><span class=${'insight-bar-fill w' + Math.min(100, Math.round(g.count / data.gaps[0].count * 20) * 5)}></span></span> ${g.count}</td>
          <td data-label="Chosen" class="num">${g.chosen}</td><td data-label="Applied" class="num">${g.applied}</td>
        </tr>`)}</tbody></table></div>
      ${failed ? html`<${Notice} tone="danger" title="The last attempt did not finish">${failed.message}</${Notice}>` : null}
      ${running ? html`<div class="fu-running" role="status"><${Spinner} /><div><strong>Planning</strong><p>${running.message || 'Waiting for the agent'}</p></div></div>`
        : html`<div class="action-row"><${ActionButton} class="primary small" icon="spark" disabled=${!selected.size} onClick=${build}>${data.plan ? 'Rebuild plan' : 'Build a learning plan'} for ${plural(selected.size, 'gap')}</${ActionButton}></div>`}`}
    ${data.plan ? html`<${Plan} data=${data} />` : null}
  </${Card}>`;
}
