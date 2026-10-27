import { randomUUID } from 'node:crypto';
import { digest } from '../store.mjs';
// Experimental scheduling boundary: claim/commit briefly; browser/model work
// happens outside the global workspace mutation chain. Not mounted in the app.
export async function detachedApplication(workspace, jobId, work) {
  const runId = randomUUID();
  const claim = await workspace.mutate(async state => {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) throw Error('Unknown application.');
    if (job.actorRun?.status === 'running') throw Error('Application is already running.');
    const sourceHash = (await workspace.context(state)).hash;
    const jobHash = digest([job.url, job.title, job.description]);
    job.actorRun = { id: runId, status: 'running', sourceHash, jobHash };
    return { runId, sourceHash, jobHash, job: structuredClone(job) };
  });
  let result;
  try { result = await work(claim); }
  catch (error) {
    await workspace.mutate(state => { const job = state.jobs.find(j => j.id === jobId); if (job?.actorRun?.id === runId) job.actorRun.status = 'paused'; });
    throw error;
  }
  return workspace.mutate(async state => {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job || job.actorRun?.id !== runId) throw Error('Application ownership changed.');
    if ((await workspace.context(state)).hash !== claim.sourceHash || digest([job.url, job.title, job.description]) !== claim.jobHash) {
      job.actorRun.status = 'needs-replan'; return { state: 'needs-replan' };
    }
    job.actorRun.status = 'review'; job.actorRun.result = result;
    return { state: 'review' };
  });
}
