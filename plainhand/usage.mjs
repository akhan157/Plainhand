import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').slice(0, 100) : null;
const sum = values => values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
export function agentUsage(provider, output = '') {
  const empty = { inputTokens: null, uncachedInputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, reportedUsd: null, models: [] };
  let events;
  try { events = [JSON.parse(output)]; } catch { events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  if (provider === 'claude') {
    const envelope = events.findLast(e => e?.type === 'result');
    if (!envelope) return empty;
    const u = envelope.usage || {};
    const input = count(u.input_tokens), read = count(u.cache_read_input_tokens), write = count(u.cache_creation_input_tokens);
    return { ...empty, inputTokens: sum([input, read, write]), uncachedInputTokens: input, outputTokens: count(u.output_tokens), cacheReadTokens: read, cacheWriteTokens: write, reportedUsd: amount(envelope.total_cost_usd), models: Object.keys(envelope.modelUsage || {}).map(label).filter(Boolean).slice(0, 10) };
  }
  if (provider === 'codex') {
    const turns = events.filter(e => e?.type === 'turn.completed' && e.usage);
    if (!turns.length) return empty;
    const metric = key => sum(turns.map(e => count(e.usage[key])));
    return { ...empty, inputTokens: metric('input_tokens'), outputTokens: metric('output_tokens'), cacheReadTokens: metric('cached_input_tokens'), cacheWriteTokens: metric('cache_write_input_tokens'), reasoningTokens: metric('reasoning_output_tokens') };
  }
  // Antigravity's metering contract is unverified. Never guess from prose or
  // confuse a model-written "usage" object with provider metadata.
  return empty;
}

export class UsageLedger {
  constructor(workspace) { this.workspace = workspace; }
  file(id) { return `data/plainhand/usage/${id}.json`; }
  async records() {
    let names;
    try { names = await readdir(await this.workspace.safe('data/plainhand/usage')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const records = [];
    for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) records.push(JSON.parse(await this.workspace.read('data/plainhand/usage/' + name)));
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async recover() {
    for (const record of await this.records()) if (record.status === 'running') {
      record.status = 'interrupted'; record.finishedAt = new Date().toISOString(); record.durationMs = null;
      await this.workspace.write(this.file(record.id), JSON.stringify(record));
    }
  }
  async track(agent, provider, instruction, data, options = {}) {
    const context = options.usageContext || {};
    const record = { id: randomUUID(), provider, purpose: label(context.purpose) || 'agent', jobId: label(context.jobId), taskId: label(context.taskId), retryOf: label(context.retryOf), attempt: count(context.attempt) || 1, startedAt: new Date().toISOString(), status: 'running', ...agentUsage(provider) };
    await this.workspace.write(this.file(record.id), JSON.stringify(record));
    const start = Date.now();
    try {
      const result = await agent(provider, instruction, data, { ...options, onUsage: usage => {
        for (const key of ['inputTokens', 'uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) record[key] = count(usage[key]);
        record.reportedUsd = amount(usage.reportedUsd);
        record.models = Array.isArray(usage.models) ? usage.models.map(label).filter(Boolean).slice(0, 10) : [];
      } });
      record.status = 'succeeded'; return result;
    } catch (error) { record.status = options.signal?.aborted ? 'canceled' : 'failed'; throw error; }
    finally {
      record.durationMs = Date.now() - start; record.finishedAt = new Date().toISOString();
      await this.workspace.write(this.file(record.id), JSON.stringify(record));
    }
  }
  async summary(state) {
    const records = await this.records();
    const aggregate = entries => {
      const metric = key => { const available = entries.filter(e => e[key] !== null && e[key] !== undefined); return { value: available.length ? available.reduce((n, e) => n + e[key], 0) : null, reportedCalls: available.length }; };
      return { calls: entries.length, succeeded: entries.filter(e => e.status === 'succeeded').length, failed: entries.filter(e => e.status === 'failed').length, retriedCalls: entries.filter(e => e.retryOf).length, repeatedAttempts: entries.filter(e => e.attempt > 1).length, ...Object.fromEntries(['inputTokens', 'uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'reportedUsd', 'durationMs'].map(key => [key, metric(key)])) };
    };
    const group = key => [...new Set(records.map(e => e[key]).filter(Boolean))].map(id => ({ id, ...aggregate(records.filter(e => e[key] === id)) }));
    return { totals: aggregate(records), byProvider: group('provider'), byJob: group('jobId'), recent: records.slice(0, 50), impact: { evaluatedJobs: state.jobs.filter(j => j.evaluation).length, preparedPackets: state.jobs.filter(j => j.packet).length, applicationsWithFills: state.jobs.filter(j => j.browserCheckpoint?.result?.filled?.length).length, confirmedSubmissions: state.jobs.filter(j => j.submittedAt).length }, updatedAt: records[0]?.finishedAt || records[0]?.startedAt || null };
  }
}
