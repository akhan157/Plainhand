// Feature modules plug into Plainhand here, so features never edit the server,
// workflow or registry core. Each module may export:
//   name                      stable id
//   register(ctx)             define registry actions: ctx = { define, workspace, workflow, usage, helpers }
//   tasks                     { kind: { handler(taskCtx), needsProfile = true } } run through the task queue
//   attention(state)          extra briefing items [{ kind, jobId, text }] (pure, no I/O)
//   start(ctx)                background work while the server runs; returns an async stop()
// Contract: docs/AGENT-CONTRACTS.md §6.
import * as followups from './followups.mjs';
import { insights } from './insights.mjs';
import campaigns from './campaigns.mjs';

export const FEATURES = [campaigns, followups, insights];
