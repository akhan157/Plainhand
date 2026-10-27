// The in-app assistant (docs/AGENT-CONTRACTS.md §1 and §4). Plainhand runs the
// agent; this module only shows what the server says and sends what the
// candidate decides. Nothing here invents a reply or applies a change.
import { html, useEffect, useReducer, useRef, api, store, onServerEvent, openPanelRequest, toast, refresh, navigate, Icon, useDraft, todayISO, daysUntil } from './core.mjs';
import { MessageList, Composer, ProposalCard, TaskCard } from './conversation.mjs';
import { Button, Notice } from './components.mjs';

export const agentAvailable = () => !!store.state?.agent?.available && !store.demo;

const UNDO_MS = 10 * 60 * 1000;
const thread = {
  messages: [],        // server message records, plus optimistic { local: true } user messages
  proposals: {},       // id → proposal
  undo: {},            // proposalId → { token, expires }
  partial: {},         // turnId → { call, text } streamed text not yet final
  running: null,       // turnId of the turn in progress
  notes: {},           // turnId → error text when a turn ended without a message
  focusProposal: null, // proposal id to move focus to once rendered
  loaded: false, loading: false, error: null,
};
const listeners = new Set();
const changed = () => { threadVersion++; for (const l of listeners) l(); };
let threadVersion = 0;
export function useThread() {
  const [, force] = useReducer(n => n + 1, 0);
  const seen = useRef(threadVersion);
  seen.current = threadVersion;
  useEffect(() => { listeners.add(force); if (seen.current !== threadVersion) force(); return () => listeners.delete(force); }, []);
  return thread;
}

function addMessage(message) {
  if (thread.messages.some(m => m.id === message.id)) return;
  if (message.role === 'user') {
    const local = thread.messages.findIndex(m => m.local && m.text === message.text);
    if (local >= 0) { thread.messages.splice(local, 1, message); return; }
  }
  thread.messages.push(message);
}

export async function loadHistory() {
  if (thread.loading) return;
  thread.loading = true;
  try {
    const data = await api('agent/history?limit=100');
    const local = thread.messages.filter(m => m.local);
    thread.messages = [...data.messages];
    for (const m of local) addMessage(m);
    for (const p of data.proposals || []) thread.proposals[p.id] = p;
    thread.running = data.running || null;
    if (!thread.running) thread.partial = {};
    thread.loaded = true; thread.error = null;
  } catch (error) { thread.error = { code: error.code, text: error.message }; }
  finally { thread.loading = false; changed(); }
}

onServerEvent((name, data) => {
  if (!agentAvailable() || !data) return;
  const turnId = data.turnId;
  switch (name) {
    case 'agent.turn': thread.running = turnId; thread.partial[turnId] = { call: 0, text: '' }; break;
    case 'agent.delta': {
      const current = thread.partial[turnId];
      thread.partial[turnId] = !current || current.call !== data.call ? { call: data.call, text: data.text || '' } : { call: data.call, text: current.text + (data.text || '') };
      break;
    }
    case 'agent.message':
      if (data.message) { addMessage(data.message); if (data.message.role === 'assistant') delete thread.partial[turnId]; }
      break;
    case 'agent.proposal':
      if (data.proposal) { thread.proposals[data.proposal.id] = data.proposal; thread.focusProposal = data.proposal.id; }
      break;
    case 'agent.task': refresh(); break;
    case 'agent.panel': openPanelRequest(data.panel); break;
    case 'agent.done':
      if (thread.running === turnId) thread.running = null;
      delete thread.partial[turnId];
      if (data.status === 'failed' && !thread.messages.some(m => m.turnId === turnId && m.role === 'assistant')) thread.notes[turnId] ||= 'This reply did not finish. Try again.';
      break;
    case 'agent.error': thread.notes[turnId] = data.error || 'This reply did not finish.'; break;
    default: return;
  }
  changed();
});

// If an event was missed (stream reconnecting), the state read tells us the
// turn ended; reload the history so the reply still appears.
let lastRunning;
export function syncWithState() {
  const running = store.state?.agent?.running || null;
  if (running === lastRunning) return;
  lastRunning = running;
  if (!agentAvailable() || !thread.loaded) return;
  if (running && thread.running !== running) { thread.running = running; changed(); }
  else if (!running && thread.running) setTimeout(() => { if (thread.running && !store.state?.agent?.running) loadHistory(); }, 400);
}

const ERRORS = {
  busy: 'Plainhand is still answering your last message. Wait for it, or choose Stop.',
  no_provider: 'Connect an AI account before talking to Plainhand.',
};
export const agentClient = {
  async send(text) {
    const local = { id: 'local-' + Date.now(), local: true, role: 'user', text, at: new Date().toISOString() };
    thread.messages.push(local); thread.error = null; changed();
    try {
      const { turnId } = await api('agent/message', { text });
      if (!thread.messages.some(m => m.turnId === turnId && m.role === 'assistant')) { thread.running = turnId; thread.partial[turnId] ||= { call: 0, text: '' }; }
      local.turnId = turnId; changed();
    } catch (error) {
      thread.messages = thread.messages.filter(m => m !== local);
      thread.error = { code: error.code, text: ERRORS[error.code] || error.message };
      changed();
      throw Object.assign(new Error(thread.error.text), { quiet: true });
    }
  },
  async stop() {
    if (!thread.running) return;
    await api('agent/cancel', { turnId: thread.running });
  },
  async confirm(proposal, accept, edits) {
    try {
      const result = await api('agent/confirm', { turnId: proposal.turnId, proposalId: proposal.id, accept, ...(edits ? { edits } : {}) });
      // A retryable failure was rolled back: the card stays open with the error shown.
      thread.proposals[proposal.id] = result.retryable
        ? { ...proposal, status: 'pending', outcomes: result.results, lastError: result.results.find(o => !o.ok)?.error || null }
        : { ...proposal, status: accept ? 'accepted' : 'declined', outcomes: result.results, edited: !!edits };
      if (result.undoToken) thread.undo[proposal.id] = { token: result.undoToken, expires: Date.now() + UNDO_MS };
      if (accept) toast(result.retryable ? 'Nothing was saved. Edit the change and try again, or decline it.' : result.ok === false ? 'Some changes could not be saved. See the conversation.' : proposal.actions[0]?.tier === 'task' ? 'Started.' : proposal.actions.length === 1 ? 'Change saved.' : 'Changes saved.', result.ok === false);
      changed(); refresh();
    } catch (error) {
      if (error.code === 'stale' || error.code === 'not_found') await loadHistory();
      throw error;
    }
  },
  async undo(proposal) {
    const entry = thread.undo[proposal.id];
    delete thread.undo[proposal.id]; changed();
    await api('agent/undo', { undoToken: entry?.token });
    thread.proposals[proposal.id] = { ...thread.proposals[proposal.id], undone: true };
    changed(); refresh(); toast('Undone. Those changes were reversed.');
  },
  async clear() {
    await api('agent/clear', {});
    Object.assign(thread, { messages: [], proposals: {}, undo: {}, partial: {}, notes: {}, running: null, error: null });
    changed();
  },
};

// Profile items the digest reports as missing (mirrors buildDigest in plainhand/actions.mjs).
export function profileMissing(state) {
  const p = state.profile || {};
  const missing = [['name', 'name'], ['resume', 'resume'], ['roles', 'target roles'], ['location', 'location']].filter(([key]) => !String(p[key] || '').trim()).map(([, label]) => label);
  if (!(state.conversation || []).some(m => m.role === 'user')) missing.push('your story in your own words');
  return missing;
}

// Starting points drawn from the briefing. They only fill the composer.
export function suggestions(state) {
  const list = [];
  const soon = (state.followUps || []).some(f => f.action && f.due && (f.overdue || daysUntil(f.due) <= 7))
    || state.jobs.some(j => (j.record?.interviews || []).some(r => r.status === 'scheduled' && r.date >= todayISO() && daysUntil(r.date) <= 7));
  if (soon) list.push('What’s due this week?');
  if (profileMissing(state).length) list.push('Help me build my profile');
  else if (state.profileStrength?.next?.length) list.push('Help me strengthen my profile');
  const review = state.jobs.find(j => j.packet && !j.approvedHash && !j.stale && !j.submittedAt);
  if (review) list.push(`Walk me through the ${review.company} packet`);
  const unevaluated = state.jobs.find(j => !j.evaluation);
  if (unevaluated) list.push(`Evaluate ${unevaluated.company} — ${unevaluated.title}`);
  if (state.jobs.some(j => j.evaluation) && list.length < 4) list.push('Which role should I focus on next?');
  if (!soon && list.length < 4) list.push('What’s due this week?');
  if (list.length < 4) list.push('I found a job I like: ');
  return list.slice(0, 4);
}

const PANEL_LABELS = { job: 'Open role', packet: 'Open packet', record: 'Open record', form: 'Open form assistance', profile: 'Open Profile & brain', applications: 'Open Applications', discover: 'Open Jobs', workspace: 'Open Workspace' };

function ProposalTasks({ proposal }) {
  const ids = (proposal.outcomes || []).map(o => o.result?.taskId).filter(Boolean);
  const tasks = ids.map(id => store.state.tasks.find(t => t.id === id)).filter(Boolean);
  return tasks.map(task => html`<${TaskCard} key=${task.id} task=${task} compact
    onCancel=${async () => { await api('tasks/cancel', { id: task.id }); toast('Cancellation requested. Saved work is preserved.'); refresh(); }}
    onRetry=${async () => { await api('tasks', { kind: task.kind, jobId: task.jobId, ...task.input, retryOf: task.id }); toast('Queued again.'); refresh(); }} />`);
}

function Extras({ message }) {
  const proposal = message.proposalId && thread.proposals[message.proposalId];
  const undo = proposal && thread.undo[proposal.id];
  const undoable = undo && undo.expires > Date.now() && !proposal.undone;
  return html`
    ${proposal ? html`<${ProposalCard} key=${proposal.id} proposal=${proposal} autoFocus=${thread.focusProposal === proposal.id} onFocused=${() => { thread.focusProposal = null; }}
      undoToken=${undoable ? undo.token : null}
      onConfirm=${edits => agentClient.confirm(proposal, true, edits)} onDecline=${() => agentClient.confirm(proposal, false)} onUndo=${() => agentClient.undo(proposal)} />` : null}
    ${proposal ? html`<${ProposalTasks} proposal=${proposal} />` : null}
    ${message.panel && message.role === 'assistant' ? html`<div class="message-links"><${Button} class="small" iconEnd="arrow" onClick=${() => openPanelRequest(message.panel)}>${PANEL_LABELS[message.panel.type] || 'Open'}</${Button}></div>` : null}`;
}

function ThreadError() {
  const e = thread.error;
  if (!e) return null;
  return html`<div class="thread-error" role="alert"><${Notice} tone=${e.code === 'busy' ? 'warn' : 'danger'}>${e.text}${e.code === 'no_provider' ? html` <a href="#connections">Open Connections</a>` : null}</${Notice}></div>`;
}

// The assistant thread shown on Home when an AI account is connected.
export function AssistantThread({ compact }) {
  useThread();
  const [, setDraft] = useDraft('assistant', '');
  useEffect(() => { if (!thread.loaded) loadHistory(); }, []);
  const state = store.state;
  const name = state.profile.name?.trim().split(/\s+/)[0] || 'You';
  const running = thread.running;
  const partial = running ? thread.partial[running] : null;
  const notes = Object.entries(thread.notes).filter(([turnId]) => !thread.messages.some(m => m.turnId === turnId && m.role === 'assistant'));
  const ideas = suggestions(state);
  const fill = text => { setDraft(text); queueMicrotask(() => { const el = document.getElementById('composer-assistant'); el?.focus(); el?.setSelectionRange?.(text.length, text.length); }); };
  const empty = html`<div class="thread-empty"><p><strong>Ask Plainhand about your search.</strong> It reads your workspace, answers from it, and proposes changes for you to confirm. It never approves a packet, submits an application or marks one applied.</p></div>`;
  return html`<section class=${'card assistant' + (compact ? ' compact' : '')} aria-labelledby="assistant-title">
    <header class="card-head"><div class="card-title"><span class="card-icon"><span class="brand-mark small" aria-hidden="true">p</span></span><div><h2 id="assistant-title">Ask Plainhand</h2><p>Changes come back as proposals. Nothing is saved, approved or submitted without you.</p></div></div>
      ${thread.messages.length ? html`<div class="card-actions"><span class="thread-meta">${thread.messages.filter(m => !m.local).length} messages</span></div>` : null}</header>
    ${thread.error?.code === 'corrupt' && !thread.messages.length ? null : html`<${MessageList} pageFlow limit=${24} label="Conversation with Plainhand" messages=${thread.messages} authorFor=${m => m.role === 'user' ? name : 'Plainhand'} empty=${empty}
      renderExtra=${m => html`<${Extras} message=${m} />`}
      streaming=${running ? (partial?.text || '') : null} streamingKey=${running ? `${running}:${partial?.call || 0}` : null} />`}
    ${notes.map(([turnId, text]) => html`<${Notice} key=${turnId} tone="danger">${text}</${Notice}>`)}
    <${ThreadError} />
    <div class="composer-dock">
    ${!running && ideas.length ? html`<div class="suggestions" role="group" aria-label="Suggested questions">${ideas.map(text => html`<button type="button" class="suggestion" key=${text} onClick=${() => fill(text)}>${text}</button>`)}</div>` : null}
    <${Composer} draftKey="assistant" label="Message Plainhand" placeholder="Ask about your roles, follow-ups or next steps, or paste a job link…"
      running=${!!running} onStop=${() => agentClient.stop()}
      hint=${running ? 'Plainhand is working. You can keep typing; Stop ends this reply.' : 'Enter to send · Shift+Enter for a new line'}
      onSend=${text => agentClient.send(text)} />
    </div>
  </section>`;
}

// Shown in place of the thread when no AI account is connected yet.
export function AssistantLocked() {
  return html`<section class="card assistant locked" aria-labelledby="assistant-title">
    <header class="card-head"><div class="card-title"><span class="card-icon"><${Icon} name="plug" /></span><div><h2 id="assistant-title">Ask Plainhand</h2><p>Connect the AI account you already use, and you can run your search by conversation: save roles, ask about scores, record interviews.</p></div></div>
      <div class="card-actions"><${Button} class="primary small" iconEnd="arrow" onClick=${() => navigate('connections')}>Connect an account</${Button}></div></header>
  </section>`;
}
