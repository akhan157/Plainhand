// The portable application kit for a site Plainhand cannot drive: the posting
// links, the approved documents, and every approved answer with its sources.
// Files are written under output/, which is local and gitignored. Nothing here
// submits, opens a browser or contacts the employer.
import { slug, packetIdentity } from './workflow.mjs';
import { digest } from './store.mjs';

export const kitDirectory = job => `output/manual-kit/${slug(job.company)}-${slug(job.title)}-${job.id.slice(0, 8)}`;

export async function writeManualKit({ workspace, state, job }) {
  if (!job) throw new Error('Job not found.');
  if (!job.packet) throw new Error('Prepare this application packet first; the kit needs the reviewed documents.');
  // The kit is what the candidate submits by hand, so it carries only documents they
  // approved: the resume PDF is verified against the approved hash; the cover-letter PDF
  // is copied from the prepared artifacts, whose hash the approval does not cover.
  if (!job.approvedHash || job.approvedHash !== packetIdentity(job)) throw new Error('Approve this application first; the kit carries only the version you approved.');
  const directory = kitDirectory(job);
  const link = job.applyUrl || job.url;
  const files = [];
  const write = async (name, content) => {
    const file = `${directory}/${name}`;
    await workspace.write(file, content);
    files.push({ name, path: file });
  };
  const artifacts = job.artifacts || [];
  const resume = job.pdf && artifacts.includes(job.pdf) ? job.pdf : artifacts.find(file => /(^|\/)cv-.*\.pdf$/.test(file) || /resume.*\.pdf$/i.test(file));
  const cover = artifacts.find(file => /cover-letter.*\.pdf$/i.test(file));
  await write('posting.md', [
    `# ${job.company} — ${job.title}`,
    '',
    `- Role: ${job.title}`,
    `- Company: ${job.company}`,
    `- Location: ${job.location || 'Not listed'}`,
    `- Posting: ${job.url}`,
    `- Apply here: ${link}`,
    `- Prepared: ${new Date().toISOString()}`,
    '',
    'You open the application, upload these documents, paste these answers, and submit.',
    'Plainhand never submits an application.',
    '',
  ].join('\n'));
  if (resume) {
    // The approval covers the resume PDF's hash: copy those exact bytes or nothing.
    const bytes = await workspace.readBinary(resume);
    if (job.pdfHash && digest(bytes) !== job.pdfHash) throw new Error('The resume file changed after you approved it. Prepare and approve it again before saving the kit.');
    await write('resume.pdf', bytes);
  }
  if (cover) await write('cover-letter.pdf', await workspace.readBinary(cover));
  if (job.packet.coverLetter) await write('cover-letter.md', job.packet.coverLetter.trim() + '\n');
  await write('answers.md', [
    `# ${job.company} — ${job.title}: approved answers`,
    '',
    ...(job.packet.answers || []).flatMap(answer => [
      `## ${answer.question}`,
      '',
      answer.answer,
      '',
      `Sources: ${(answer.evidence || []).map(item => item.sourceId).join(', ') || 'profile'}`,
      '',
    ]),
    job.packet.answers?.length ? '' : 'This packet has no free-text answers. Use your profile for contact details and the documents above.',
  ].join('\n'));
  await write('kit.json', JSON.stringify({
    company: job.company,
    title: job.title,
    location: job.location || null,
    posting: job.url,
    applyUrl: link,
    preparedAt: job.packet ? new Date().toISOString() : null,
    approved: Boolean(job.approvedHash),
    documents: [resume && 'resume.pdf', cover && 'cover-letter.pdf'].filter(Boolean),
    answerCount: job.packet.answers?.length || 0,
    generatedBy: 'plainhand/manual-kit.mjs',
  }, null, 2) + '\n');
  // The tracker entry stays exactly as preparation left it; the kit is what the
  // candidate carries to the site.
  const tracked = state.jobs.find(item => item.id === job.id);
  return {
    directory,
    files,
    posting: { company: job.company, title: job.title, url: job.url, applyUrl: link },
    status: tracked?.status || null,
    stage: tracked?.stage || null,
    trackerNumber: tracked?.trackerNumber || null,
  };
}
