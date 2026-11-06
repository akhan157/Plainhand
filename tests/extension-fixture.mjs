// Shared by tests/test-cloud-extension-api.mjs and tests/test-extension-fill.mjs:
// an in-memory hosted workspace with one approved role, and a direct caller for
// handleExtensionApi (no HTTP server, no database).
import { Readable } from 'node:stream';
import { Workspace, digest, now } from '../plainhand/store.mjs';
import { MemoryStorage } from '../plainhand/storage.mjs';
import { packetIdentity } from '../plainhand/workflow.mjs';
import { createRegistry } from '../plainhand/actions.mjs';
import { handleExtensionApi } from '../plainhand/cloud/extension-api.mjs';

export const PROFILE = {
  name: 'Riley Example', email: 'riley@example.invalid', phone: '+1 617 555 0100', location: 'Boston, MA', timezone: 'America/New_York',
  roles: 'Mechanical Engineer', compensation: '$90,000', eligibility: 'US citizen', graduation: '2027',
  links: 'https://www.linkedin.com/in/riley-example https://github.com/riley-example', resume: 'Riley Example. B.S. Mechanical Engineering, Example University, 2027. Formula SAE suspension lead.',
  story: 'I build and test suspension parts.', voice: 'Plain.', constraints: '',
};
export const WHY_QUESTION = 'Why do you want to work at Acme Robotics?';
export const WHY_ANSWER = 'I led the Formula SAE suspension redesign and want to keep building tested hardware at Acme.';
export const RESUME_BYTES = Buffer.from('%PDF-1.4 approved resume for Acme\n%%EOF\n');
export const COVER_BYTES = Buffer.from('%PDF-1.4 approved cover letter for Acme\n%%EOF\n');

function role(id, overrides = {}) {
  const slug = id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    id, company: 'Acme Robotics', title: 'Mechanical Engineer', url: 'https://job-boards.greenhouse.io/acme/jobs/4012345',
    description: 'Design and test robot drive trains.', createdAt: now(), stage: 'approved', selected: true,
    evaluation: { score: 4.5, recommendation: 'apply' }, verification: { state: 'active' },
    packet: { answers: [{ question: WHY_QUESTION, answer: WHY_ANSWER, evidence: [{ sourceId: 'cv', quote: 'Formula SAE suspension lead' }] }], questions: [], coverLetter: 'Dear Acme…' },
    review: { passed: true, issues: [] },
    pdf: `output/cv-${slug}.pdf`, artifacts: [`output/cv-${slug}.pdf`, `output/cover-letter-${slug}.pdf`, `output/answers-${slug}.md`],
    ...overrides,
  };
}

// approved: Acme (approved, current). draft: Beta Labs (packet written, not approved).
export async function approvedWorkspace() {
  const workspace = new Workspace('memory', { storage: new MemoryStorage() });
  const approved = role('job-acme');
  const draft = role('job-beta', { company: 'Beta Labs', title: 'Test Engineer', url: 'https://jobs.lever.co/beta/8f1e2d3c-1111-2222-3333-444455556666', stage: 'review' });
  await workspace.write(approved.pdf, RESUME_BYTES);
  await workspace.write(approved.artifacts[1], COVER_BYTES);
  await workspace.write(draft.pdf, Buffer.from('%PDF-1.4 beta draft\n'));
  await workspace.write(draft.artifacts[1], Buffer.from('%PDF-1.4 beta cover\n'));
  await workspace.mutate(async state => {
    state.profile = { ...state.profile, ...PROFILE };
    const context = await workspace.context(state);
    for (const job of [approved, draft]) {
      job.contextHash = context.hash;
      job.packetJobHash = digest([job.url, job.company, job.title, job.description]);
      job.pdfHash = digest(await workspace.readBinary(job.pdf));
    }
    approved.approvedHash = packetIdentity(approved);
    state.jobs = [approved, draft];
  });
  const registry = createRegistry({ workspace });
  return { workspace, registry, userId: 'user-1', approvedId: approved.id, draftId: draft.id };
}

// Calls the handler the way app.mjs will: a Node request stream and a response.
export async function callApi(deps, method, path, body, headers = {}) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(text ? [Buffer.from(text)] : []);
  Object.assign(req, { method, url: path, headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), ...headers } });
  const chunks = [], head = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) { head[name.toLowerCase()] = value; },
    getHeader(name) { return head[name.toLowerCase()]; },
    end(data) { if (data) chunks.push(Buffer.from(data)); this.finished = true; },
  };
  const served = await handleExtensionApi(req, res, deps);
  const raw = Buffer.concat(chunks);
  const json = /json/.test(head['content-type'] || '') ? JSON.parse(raw.toString('utf8')) : null;
  return { served, status: res.statusCode, headers: head, json, raw };
}
