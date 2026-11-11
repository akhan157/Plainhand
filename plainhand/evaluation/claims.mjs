// Claim-level fact checking for a prepared packet. A model judge reads every atomic
// claim against the candidate's sources and the job posting; this module splits the
// claims deterministically, makes one batched judge call per packet, and verifies
// every quote the judge returns in code. A "supported" verdict whose quote is not
// in the named sources is downgraded to "unsupported": the judge's word alone is
// never the evidence.
import { captures } from './corpus.mjs';

export const VERDICTS = ['supported', 'partially_supported', 'unsupported', 'not_a_factual_claim'];
export const JOB_SOURCE_ID = 'job-posting';
export const MIN_SOURCE_QUOTE = 8;

export const CLAIMS_INSTRUCTION = `You are grading another system's output, not writing for the candidate. The system prepared a job application packet (resume lines, form answers, cover letter) for a fictional candidate. INPUT.claims lists every atomic claim from that packet. INPUT.sources are the only evidence: the candidate's own material, plus the job posting under sourceId "${JOB_SOURCE_ID}". Produce {claims:[{id:string, verdict:"supported"|"partially_supported"|"unsupported"|"not_a_factual_claim", sourceId:string, quote:string, reason:string}], requiredFacts:[{id:string, conveyed:boolean, packetQuote:string, reason:string}]}.
Return exactly one claims entry for every INPUT.claims id. Verdicts:
- supported: a source states the claim at the same strength. Rewording is fine; the facts (actions, tools, numbers, dates, titles, employers, scope, ownership) must match.
- partially_supported: a source backs part of the claim, but some detail is missing or stronger than the source (a number, tool, title or scope the source lacks; a stronger verb such as "led" for "coordinated"; "I" for "we").
- unsupported: no source backs the claim, or a source contradicts it. Do not give the benefit of the doubt.
- not_a_factual_claim: motivation, intent, interest, opinion, greetings and courtesy (for example "I would welcome the chance to discuss the role").
Statements about the employer, role or job requirements are supported when the job posting (sourceId "${JOB_SOURCE_ID}") says them; the posting never supports a claim about the candidate. For supported and partially_supported, quote is the shortest span (at least ${MIN_SOURCE_QUOTE} characters) copied character for character from the text of the source named by sourceId; it is checked by exact string match and a quote that is not found makes the verdict unsupported. For unsupported and not_a_factual_claim, sourceId and quote are "". reason is one short sentence.
INPUT.requiredFacts are facts the candidate has that this job needs. For each, conveyed is true when the packet communicates the substance of the fact, in any wording (paraphrase counts; a passing mention without the substance does not). packetQuote is copied character for character from one INPUT.claims text that conveys it, "" when not conveyed. Judge only what is written; length is not quality.`;

// Typographic quotes, dashes and whitespace differ between model output and
// source text without changing the words. Nothing else is normalised.
export const normalizeForMatch = value => String(value ?? '')
  .replace(/[‘’‛′]/g, "'")
  .replace(/[“”″]/g, '"')
  .replace(/[‐-―−]/g, '-')
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// 'exact' when the quote is a literal substring, 'normalized' when it matches after
// whitespace/quote/dash normalisation, null otherwise.
export function matchQuote(quote, text, minLength = 1) {
  const q = String(quote ?? '');
  if (normalizeForMatch(q).length < minLength) return null;
  if (String(text ?? '').includes(q)) return 'exact';
  return normalizeForMatch(text).includes(normalizeForMatch(q)) ? 'normalized' : null;
}

// Company suffixes (Inc., Co., Ltd.) are left out: they usually end a sentence.
const ABBREVIATION = /(?:\b(?:[A-Za-z]\.){2,}|\b[A-Z]\.|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|approx|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.|\be\.g\.|\bi\.e\.)$/;

// Deterministic sentence split: one line at a time, on terminal punctuation followed
// by a space and a capital letter or digit, never after a known abbreviation.
export function splitSentences(text) {
  const out = [];
  for (const rawLine of String(text ?? '').split(/\n+/)) {
    const line = rawLine.replace(/^\s*(?:[-*•‣◦]|\d+[.)])\s+/, '').trim();
    if (!line) continue;
    const boundary = /[.!?]+["')\]]*\s+(?=["'(\[]?[A-Z0-9])/g;
    let start = 0, match;
    while ((match = boundary.exec(line))) {
      const end = match.index + match[0].trimEnd().length;
      const sentence = line.slice(start, end).trim();
      if (ABBREVIATION.test(line.slice(start, match.index + 1).trim()) && !/[!?]/.test(match[0])) continue;
      if (sentence) out.push(sentence);
      start = match.index + match[0].length;
    }
    const rest = line.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}

const SALUTATION = /^(?:dear|hello|hi|to whom)\b[^.!?]*[,:]?$/i;
const SIGN_OFF = /^(?:sincerely|best|best regards|kind regards|regards|warm regards|warmly|respectfully|thanks|thank you|yours(?: truly| sincerely)?)\b[^.!?]{0,40}$/i;
// A letter's closing name line ("Riley Chen") is not a claim, but only by
// position: it directly follows the sign-off, or it is the candidate's own name.
// Other short lines ("I know Kubernetes", "Certified Scrum Master") are claims.
const NAME_LINE = /^[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,3}$/;
const sameName = (a, b) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
export function coverLetterClaims(text, candidateName = '') {
  const sentences = splitSentences(text);
  return sentences.filter((sentence, i) => {
    if (SALUTATION.test(sentence) || SIGN_OFF.test(sentence)) return false;
    if (candidateName && sameName(sentence, candidateName)) return false;
    if (i > 0 && SIGN_OFF.test(sentences[i - 1]) && NAME_LINE.test(sentence)) return false;
    return true;
  });
}

const headingText = heading => [heading?.title, heading?.org, heading?.location, heading?.dates].map(item => String(item ?? '').trim()).filter(Boolean).join(', ');

// Every piece of packet text a reader sees, in reading order. Excerpts and packet
// quotes from the judge are verified against this.
export function packetText(packet) {
  const parts = [];
  if (packet?.headline) parts.push(String(packet.headline));
  for (const entry of packet?.resume || []) {
    if (entry?.heading) parts.push(headingText(entry.heading));
    if (entry?.text) parts.push(String(entry.text));
  }
  for (const answer of packet?.answers || []) {
    if (answer?.question) parts.push(String(answer.question));
    if (answer?.answer) parts.push(String(answer.answer));
  }
  if (packet?.coverLetter) parts.push(String(packet.coverLetter));
  return parts.join('\n');
}

// Atomic claims: { id, part: 'resume'|'answer'|'cover', text, ... }. The headline
// and each distinct resume heading (title, employer, dates) count as resume claims
// because titles and dates can be inflated too.
export function extractClaims(packet, { candidateName = '' } = {}) {
  const claims = [];
  const add = (id, part, text, extra = {}) => {
    const clean = String(text ?? '').trim();
    if (clean) claims.push({ id, part, text: clean, ...extra });
  };
  splitSentences(packet?.headline).forEach((sentence, i) => add(`headline:${i}`, 'resume', sentence, { kind: 'headline' }));
  const headings = new Set();
  (packet?.resume || []).forEach((entry, e) => {
    const heading = headingText(entry?.heading);
    if (heading && !headings.has(heading)) {
      headings.add(heading);
      add(`heading:${e}`, 'resume', heading, { kind: 'heading', entry: e, section: entry?.section ?? null });
    }
    splitSentences(entry?.text).forEach((sentence, i) => add(`resume:${e}.${i}`, 'resume', sentence, { entry: e, section: entry?.section ?? null }));
  });
  (packet?.answers || []).forEach((answer, n) => {
    splitSentences(answer?.answer).forEach((sentence, i) => add(`answer:${n}.${i}`, 'answer', sentence, { entry: n, question: answer?.question ?? null }));
  });
  coverLetterClaims(packet?.coverLetter, candidateName).forEach((sentence, i) => add(`cover:${i}`, 'cover', sentence));
  return claims;
}

export function jobSource(job) {
  const header = [job?.company && `Company: ${job.company}`, job?.title && `Title: ${job.title}`, job?.location && `Location: ${job.location}`].filter(Boolean).join('\n');
  return { id: JOB_SOURCE_ID, text: [header, String(job?.description ?? '')].filter(Boolean).join('\n\n') };
}

export const requiredFactsFor = (job, persona) => (job?.requiredFactIds || [])
  .map(id => (persona?.facts || []).find(fact => fact.id === id))
  .filter(Boolean)
  .map(fact => ({ id: fact.id, text: fact.text }));

const byId = list => {
  const map = new Map();
  if (Array.isArray(list)) {
    for (const item of list) if (item && typeof item.id === 'string' && !map.has(item.id)) map.set(item.id, item);
  } else if (list && typeof list === 'object') {
    for (const [id, item] of Object.entries(list)) if (item && typeof item === 'object') map.set(id, { id, ...item });
  }
  return map;
};
const rate = (n, d) => d ? Math.round(n / d * 1000) / 1000 : null;

function verifyClaim(claim, answer, sources) {
  const judgeVerdict = typeof answer?.verdict === 'string' ? answer.verdict.trim() : null;
  const reason = typeof answer?.reason === 'string' ? answer.reason.trim() : '';
  if (!answer || !VERDICTS.includes(judgeVerdict)) {
    return { ...claim, verdict: 'unjudged', judgeVerdict, sourceId: null, quote: null, quoteMatch: null, reason: answer ? `Judge returned an unknown verdict: ${judgeVerdict}` : 'Judge returned no verdict for this claim.', downgraded: false };
  }
  if (judgeVerdict === 'unsupported' || judgeVerdict === 'not_a_factual_claim') {
    return { ...claim, verdict: judgeVerdict, judgeVerdict, sourceId: null, quote: null, quoteMatch: null, reason, downgraded: false };
  }
  const quote = typeof answer.quote === 'string' ? answer.quote : '';
  const named = sources.find(source => source.id === answer.sourceId);
  let sourceId = null, quoteMatch = named ? matchQuote(quote, named.text, MIN_SOURCE_QUOTE) : null;
  if (quoteMatch) sourceId = named.id;
  else {
    // The quote may be real but attributed to the wrong source id; accept it and record where it was found.
    for (const source of sources) {
      const found = matchQuote(quote, source.text, MIN_SOURCE_QUOTE);
      if (found) { quoteMatch = found; sourceId = source.id; break; }
    }
  }
  if (!quoteMatch) {
    return {
      ...claim,
      verdict: 'unsupported',
      judgeVerdict,
      sourceId: typeof answer.sourceId === 'string' ? answer.sourceId : null,
      quote,
      quoteMatch: null,
      reason,
      downgraded: true,
      downgradeReason: normalizeForMatch(quote).length < MIN_SOURCE_QUOTE ? `Quote shorter than ${MIN_SOURCE_QUOTE} characters.` : 'Quote not found in any source.',
    };
  }
  return { ...claim, verdict: judgeVerdict, judgeVerdict, sourceId, quote, quoteMatch, reason, downgraded: false, ...(sourceId !== answer.sourceId ? { sourceIdCorrected: true } : {}) };
}

// One judge call for the whole packet. `judge` is async (instruction, data) => json.
export async function checkClaims({ claims, sources = [], job, persona, judge, packet = null }) {
  if (typeof judge !== 'function') throw new Error('checkClaims needs a judge function.');
  const allSources = [...(sources || []).filter(source => source && typeof source.text === 'string').map(source => ({ id: String(source.id), text: source.text })), jobSource(job)];
  const required = requiredFactsFor(job, persona);
  const response = await judge(CLAIMS_INSTRUCTION, {
    job: { company: job?.company ?? null, title: job?.title ?? null },
    sources: allSources,
    claims: claims.map(claim => ({ id: claim.id, part: claim.part, text: claim.text })),
    requiredFacts: required,
  });
  if (!response || typeof response !== 'object') throw new Error('The claim judge returned no JSON object.');
  const answers = byId(response.claims);
  const checked = claims.map(claim => verifyClaim(claim, answers.get(claim.id), allSources));

  const fullText = packet ? packetText(packet) : claims.map(claim => claim.text).join('\n');
  const factAnswers = byId(response.requiredFacts);
  const requiredFacts = required.map(fact => {
    const answer = factAnswers.get(fact.id);
    const judgeConveyed = answer?.conveyed === true;
    const packetQuote = typeof answer?.packetQuote === 'string' ? answer.packetQuote : '';
    const quoteMatch = judgeConveyed ? matchQuote(packetQuote, fullText, 8) : null;
    return {
      id: fact.id,
      text: fact.text,
      conveyed: Boolean(judgeConveyed && quoteMatch),
      judgeConveyed,
      packetQuote: packetQuote || null,
      quoteVerified: judgeConveyed ? Boolean(quoteMatch) : null,
      reason: typeof answer?.reason === 'string' ? answer.reason : answer ? '' : 'Judge returned nothing for this fact.',
      // The word-overlap rule from score.mjs, kept beside the semantic one for comparison.
      overlapCovered: captures(fact.text, fullText),
    };
  });

  const counts = Object.fromEntries([...VERDICTS, 'unjudged'].map(verdict => [verdict, checked.filter(claim => claim.verdict === verdict).length]));
  const factual = counts.supported + counts.partially_supported + counts.unsupported;
  return {
    claims: checked,
    counts,
    total: checked.length,
    factual,
    unsupportedRate: rate(counts.unsupported, factual),
    partialRate: rate(counts.partially_supported, factual),
    downgraded: checked.filter(claim => claim.downgraded).length,
    unsupported: checked.filter(claim => claim.verdict === 'unsupported'),
    requiredFacts,
    factCoverageSemantic: required.length ? rate(requiredFacts.filter(fact => fact.conveyed).length, required.length) : null,
    factCoverageOverlap: required.length ? rate(requiredFacts.filter(fact => fact.overlapCovered).length, required.length) : null,
    unverifiedFactQuotes: requiredFacts.filter(fact => fact.quoteVerified === false).map(fact => fact.id),
  };
}
