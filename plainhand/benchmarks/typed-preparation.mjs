import { hasEvidence, requireText } from '../store.mjs';
import { PACKET_INSTRUCTION, REVIEW_INSTRUCTION } from '../agents.mjs';

function validate(packet, context) {
  requireText(packet.headline, 'headline'); requireText(packet.coverLetter, 'cover letter', 25000);
  if (!Array.isArray(packet.resume) || !packet.resume.length || packet.resume.length > 60 || !Array.isArray(packet.answers) || packet.answers.length > 40 || !Array.isArray(packet.questions)) throw Error('Invalid packet structure.');
  for (const entry of [...packet.resume, ...packet.answers]) if (!hasEvidence(entry, context)) throw Error('Packet claim lacks valid source evidence.');
  for (const entry of packet.resume) { requireText(entry.section, 'section', 100); requireText(entry.text, 'resume text', 10000); }
  for (const answer of packet.answers) { requireText(answer.question, 'question', 2000); requireText(answer.answer, 'answer', 15000); }
  for (const question of packet.questions) requireText(question, 'missing fact', 15000);
}
export async function typedPreparation({ workflow, provider, context, job, fields }) {
  const reviews = []; let previousPacket, reviewFeedback;
  for (let attempt = 0; attempt < 2; attempt++) {
    const packet = await workflow.agent(provider, PACKET_INSTRUCTION + '\nIf a required observed field cannot be answered from the sources, include missingRequired:[{fieldKey:string,question:string}]. Link each item to its actual observed field. Do not include optional improvement questions. A missing fact is a needs-input state, not a failed factual review.', { context, job, observedFields: fields, ...(attempt ? { previousPacket, reviewFeedback } : {}) }, { usageContext: { jobId: job.id, purpose: 'prepare', attempt: attempt + 1 } });
    validate(packet, context);
    const missing = (packet.missingRequired || []).filter(item => fields.some(field => field.key === item.fieldKey && field.required) && typeof item.question === 'string');
    if (missing.length) return { state: 'needs-input', packet, questions: missing, reviews };
    const review = await workflow.agent(provider, REVIEW_INSTRUCTION + '\nJudge factual claims in supplied answers and documents. Missing user facts explicitly listed as pending are a needs-input state, not an invented claim. Native choice values and field keys are metadata interpreted through observedFields.', { context, job, packet, observedFields: fields }, { usageContext: { jobId: job.id, purpose: 'review', attempt: attempt + 1 } });
    if (typeof review.passed !== 'boolean' || !Array.isArray(review.issues)) throw Error('Invalid factual review.');
    reviews.push({ attempt: attempt + 1, ...review });
    if (review.passed && !review.issues.length) return { state: 'reviewed', packet, review, reviews };
    previousPacket = packet; reviewFeedback = review.issues;
  }
  return { state: 'needs-review', packet: previousPacket, reviews };
}
