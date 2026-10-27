import { runProcess } from './agents.mjs';

// Notification payloads must carry provenance: what was found, where, when, and
// why it was surfaced. A bare "new job" message is not enough to act on.
export function notificationPayload({ job, source, campaign, foundAt = new Date().toISOString(), reason = null }) {
  const title = `${job.company || 'Company'} — ${job.title || 'Role'}`;
  const lines = [
    job.location ? `Location: ${job.location}` : null,
    source ? `Source: ${source}` : null,
    campaign ? `Campaign: ${campaign}` : null,
    `Found: ${foundAt.slice(0, 10)}`,
    job.url ? job.url : null,
    reason ? `Why: ${reason}` : null,
  ].filter(Boolean);
  return {
    id: 'job-' + Buffer.from(String(job.url || title)).toString('base64url').slice(0, 40),
    title,
    body: lines.join('\n'),
    url: job.url || null,
    provenance: { company: job.company || null, role: job.title || null, location: job.location || null, source: source || null, campaign: campaign || null, foundAt },
  };
}

// Freedesktop desktop notifications. Command arguments are passed positionally;
// no shell interpolation and no payload text becomes a command.
export function createDesktopAdapter({ command = 'notify-send', runner = runProcess, timeout = 10000 } = {}) {
  return {
    name: 'desktop',
    async deliver(payload) {
      await runner(command, ['--app-name=Plainhand', '--urgency=normal', String(payload.title).slice(0, 120), String(payload.body).slice(0, 1000)], { timeout });
      return { accepted: true, channel: 'desktop' };
    },
  };
}

export function createStdoutAdapter({ write = line => console.log(line) } = {}) {
  return {
    name: 'stdout',
    async deliver(payload) { write(`${payload.title}\n${payload.body}\n`); return { accepted: true, channel: 'stdout' }; },
  };
}
