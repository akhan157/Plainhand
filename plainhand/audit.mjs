// Append-only record of actions Plainhand takes outside its own workspace.
// No cookies, tokens, answers or model output are stored here.
const FILE = 'data/plainhand/audit.jsonl';
const MAX_LINES = 5000;
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);

export class AuditLog {
  constructor(workspace, file = FILE) { this.workspace = workspace; this.file = file; }

  async append({ action, reason, jobId = null, artifact = null, outcome = null } = {}, { at = new Date().toISOString() } = {}) {
    const entry = { at, action: clean(action, 40), reason: clean(reason, 300) };
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(entry.action)) throw new Error('Record an audit action such as "fill" or "handoff".');
    if (!entry.reason) throw new Error('Every external action needs a reason.');
    if (jobId) entry.jobId = clean(jobId, 100);
    if (artifact) entry.artifact = clean(artifact, 300);
    if (outcome) entry.outcome = clean(outcome, 200);
    let lines = [];
    try { lines = (await this.workspace.read(this.file)).split('\n').filter(Boolean); } catch {}
    lines.push(JSON.stringify(entry));
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
    await this.workspace.write(this.file, lines.join('\n') + '\n');
    return entry;
  }

  async list({ limit = 50 } = {}) {
    let lines = [];
    try { lines = (await this.workspace.read(this.file)).split('\n').filter(Boolean); } catch { return []; }
    return lines.slice(-Math.max(1, Math.min(limit, MAX_LINES))).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).reverse();
  }
}
