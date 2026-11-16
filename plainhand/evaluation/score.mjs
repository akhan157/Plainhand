// Scores a completed scenario from recorded evidence, never from the model's own
// claim that it did well. Ground truth is the fictional persona and job corpus.
import { hasEvidence } from '../store.mjs';
import { captures, expectedFor, fieldOwner, hasWord, absentClaimsIn, personaById, jobById, portalById } from './corpus.mjs';
import { splitSentences, coverLetterClaims, headingText, jobSource } from './claims.mjs';
import { pdfEvidencePassed, pdfEvidenceSummary } from './pdf-evidence.mjs';

// The scorer's version. A check that changes what a pass means is a new version, and a
// pass from one version is never combined with, or compared against, another: v1
// evidence (which recorded no version) is reported beside v2, never mixed with it.
// v2: an honest zero-match Skip is valid (the PDF line-order rule is unchanged in
// meaning but its occurrence choice was corrected; see pdf-evidence.mjs).
export const SCORER_VERSION = 2;

const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const numberTokens = text => (String(text || '').match(/\d(?:[\d.,]*\d)?%?|\d%?/g) || []);

const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60',
};
const numberWordDigits = text => Object.entries(NUMBER_WORDS)
  .filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(text))
  .map(([, digit]) => digit);
// "30 percent" and "30 per cent" are the same token as "30%".
const percentWords = text => String(text || '').replace(/(\d)\s*(?:percent|per cent)\b/gi, '$1%');
// A number token compares as itself with thousands separators removed: "4,000"
// and "4000" are one token, "30%" keeps its percent sign.
const canonicalNumber = token => token.replace(/,/g, '');
// Phone numbers are contact details, not evidence. Remove 10+-digit phone sequences
// while keeping hyphenated year ranges such as 2019-2023 intact.
const withoutPhones = text => String(text || '').replace(/\+?\d[\d\s().-]{7,}\d/g, match => match.replace(/\D/g, '').length >= 10 ? ' ' : match);
const numberCheckSource = sources => withoutPhones((sources || []).map(source => {
  const text = String(source.text || '');
  return source.id === 'profile' ? text.replace(/"phone":\s*"[^"]*"/g, '"phone": ""') : text;
}).join('\n'));

// The whole-token set of numbers the sources state. A packet number is supported
// only when the same token appears: "20" is not supported by "2027", and "70%" is
// not supported by a bare "70". A bare number is supported by its percent form.
export function sourceNumberTokens(sourceText) {
  const tokens = new Set(numberTokens(percentWords(sourceText)).map(canonicalNumber));
  for (const digit of numberWordDigits(sourceText)) tokens.add(digit);
  return tokens;
}
export function numberSupported(token, sourceTokens) {
  const canonical = canonicalNumber(token);
  if (sourceTokens.has(canonical)) return true;
  return !canonical.endsWith('%') && sourceTokens.has(canonical + '%');
}

// ---- Subject-aware numeric grounding (design §4, REVIEW amendment rows) ----
// The posting is evidence about the employer, never about the candidate. Each
// number mention is attributed to the candidate or to the employer from the
// clause it sits in, and a posting number only supports an employer mention.
// Headlines and headings are always the candidate's record.
const CANDIDATE_CUE = /\b(?:i|me|my|mine|we|us|our|ours|myself|ourselves)\b/gi;
// A non-global copy for boolean tests (a /g regex remembers lastIndex).
const CANDIDATE_CUE_ANY = /\b(?:i|me|my|mine|we|us|our|ours|myself|ourselves)\b/i;
// Only subject/object pronouns after a number retroactively make it the
// candidate's ("the 25 engineers I led"); a possessive ("my reporting") does not.
const CANDIDATE_AFTER = /\b(?:i|we|me|us)\b/i;
const EMPLOYER_PRONOUN = /\b(?:you|your|yours)\b/gi;
const ROLE_NOUN = /\b(?:the|this)\s+(?:role|position|posting|job)\b/gi;
// A requirement/description predicate is what makes "the role" the employer's.
const ROLE_PREDICATE = /\b(?:requires|requiring|required|calls for|offers|covers|includes|involves|entails|asks for|ask for|is|are|was|were|will)\b/i;
const EMPLOYER_PREDICATE = /\b(?:is|are|was|were|has|have|had|operates|operate|covers|cover|includes|include|serves|serve|employs|employ|spans|span|runs|run)\b/i;
// Accomplishment verbs: a number inside a candidate action ("led your 25
// engineers") is a candidate claim even when an employer pronoun is nearby.
const CLAIM_VERB = /\b(?:led|lead|leads|leading|manag(?:e|es|ed|ing)|build|builds|built|building|wrote|write|writes|written|writing|ran|run|runs|running|own|owns|owned|owning|direct|directs|directed|directing|head|heads|headed|heading|design|designs|designed|designing|develop|develops|developed|developing|increas(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|cut|cuts|cutting|grow|grows|grew|growing|save|saves|saved|saving|deliver|delivers|delivered|delivering|achiev(?:e|es|ed|ing)|driv(?:e|es|ing)|drove|driven|oversee|oversees|oversaw|overseen|overseeing|supervis(?:e|es|ed|ing)|found|founded|founding|launch(?:es|ed|ing)?|negoti(?:ate|ates|ated|ating)|train(?:s|ed|ing)?|hir(?:e|es|ed|ing)|mentor(?:s|ed|ing)?|coordinat(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|implement(?:s|ed|ing)?|analy(?:ze|zes|zed|zing|se|ses|sed|sing)|test(?:s|ed|ing)?|maintain(?:s|ed|ing)?|support(?:s|ed|ing)?|transform(?:s|ed|ing)?|automat(?:e|es|ed|ing)|standardiz(?:e|es|ed|ing))\b/i;
const INTENT = /\b(?:applying|application for|writing to apply|hope to|hoping to|excited to|would like to|would love to|want to|keen to|eager to|interested in|looking to)\b/gi;
const MEASURE = /\b(?:by|from)\s*$/i;
// Where one owner's statement ends, so a mixed sentence is attributed per clause.
const CLAUSE_BOUNDARY = /[;:!?…\n]|—|–|--/g;
const COORDINATOR = /\b(?:and|but|or|nor|while|whereas|although|though|because|so|then)\b/i;
const LEADING_PREPOSITION = /^(?:at|for|in|with|across|inside|within|joining|as|about|on|from|by)\s*$/i;

const clauseStart = (text, index) => {
  let start = 0;
  for (const match of text.matchAll(CLAUSE_BOUNDARY)) { if (match.index < index) start = match.index + match[0].length; else break; }
  return start;
};
// After a number: the rest of its clause, stopping at a new coordinated clause so
// "Your company operates in 28 countries and I managed ..." keeps the first 28
// as the employer's.
const clauseAfter = (text, index) => {
  const rest = text.slice(index);
  const boundary = rest.search(CLAUSE_BOUNDARY);
  let end = boundary < 0 ? rest.length : boundary;
  const coordinator = rest.slice(0, end).search(COORDINATOR);
  if (coordinator >= 0) end = coordinator;
  return rest.slice(0, end);
};
const wordTokens = text => (String(text).match(/[A-Za-z0-9'’.-]+/g) || []);
const firstWord = text => (String(text).match(/^[\s"'([\-•*]*([A-Za-z][A-Za-z'’-]*)/) || [])[1] || '';
const verbInitial = text => { const word = firstWord(text); return Boolean(word) && CLAIM_VERB.test(word); };

// Owner cues in one visible sentence, as spans from each cue to the next.
function ownerCues(text, part) {
  const cues = [];
  for (const match of text.matchAll(CANDIDATE_CUE)) cues.push({ index: match.index, length: match[0].length, kind: 'candidate' });
  for (const match of text.matchAll(EMPLOYER_PRONOUN)) cues.push({ index: match.index, length: match[0].length, kind: 'employer' });
  for (const match of text.matchAll(ROLE_NOUN)) {
    const role = { index: match.index, length: match[0].length };
    if (part === 'resume') {
      // In a resume, "the role" is the candidate's own role, not the employer's.
      cues.push({ ...role, kind: 'candidate' });
      continue;
    }
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 80);
    if (ROLE_PREDICATE.test(after)) cues.push({ ...role, kind: 'employer' });
  }
  return cues.sort((a, b) => a.index - b.index);
}

// "I built reports for your 28-country team": the employer frame is explicit for
// the intent frame ("excited to join") or for a compound/possessive/"of" scope
// attached to the employer noun, unless a candidate verb takes it as its object.
function intentFrame(tail) {
  const intents = [...tail.matchAll(INTENT)];
  const match = intents.at(-1);
  if (!match) return false;
  let rest = tail.slice(match.index + match[0].length);
  rest = /to\s*$/i.test(match[0]) ? rest.replace(/^\s+[A-Za-z][A-Za-z'’.-]*\b/, '') : rest.replace(/^\s+to\s+[A-Za-z][A-Za-z'’.-]*\b/i, '');
  return !CANDIDATE_AFTER.test(rest) && !CLAIM_VERB.test(rest) && !MEASURE.test(rest);
}
function attachedToEmployer(tail, cueEnd, afterNumber) {
  const between = tail.slice(cueEnd);
  if (!/^\s*(?:['’]s)?\s*$/.test(between)) {
    // "your team of 28": an of-phrase on the employer noun.
    return /^\s+[A-Za-z][A-Za-z'’-]*\s+of\s*$/i.test(between);
  }
  if (/^-[A-Za-z0-9]/.test(afterNumber)) return true;
  if (/^\s*['’]s\s*$/.test(between)) return true;
  return false;
}

// The owner of one number mention, from the cue spans plus the guards above.
function mentionOwner(scan, mention, part) {
  const cues = ownerCues(scan, part);
  const last = cues.filter(cue => cue.index < mention.index).at(-1);
  if (!last) return verbInitial(scan) ? 'implicit' : 'ambiguous';
  if (last.kind === 'candidate') return 'candidate';
  const start = clauseStart(scan, last.index);
  const tail = scan.slice(start, mention.index);
  const prefix = scan.slice(start, last.index);
  const after = clauseAfter(scan, mention.index + mention.token.length);
  const cueAfter = CANDIDATE_AFTER.test(after);
  if (!cueAfter) {
    const employerInitial = !prefix.trim() || LEADING_PREPOSITION.test(prefix);
    if (employerInitial && !CANDIDATE_CUE_ANY.test(prefix)) return 'employer';
    if (!CANDIDATE_CUE_ANY.test(prefix) && EMPLOYER_PREDICATE.test(tail.slice(last.index - start + last.length)) && !CANDIDATE_CUE_ANY.test(tail)) return 'employer';
    if (intentFrame(tail)) return 'employer';
    // A candidate verb directly taking the employer noun phrase as its object
    // ("led your 25 engineers") is a candidate claim, not an employer scope.
    const beforeCue = wordTokens(prefix);
    const objectAttachment = beforeCue.length > 0 && CLAIM_VERB.test(beforeCue.at(-1));
    if (!objectAttachment && attachedToEmployer(tail, last.index - start + last.length, after)) return 'employer';
  }
  // The employer frame did not hold: fail closed, and label how the owner was lost.
  if (cueAfter) return 'candidate';
  if (verbInitial(scan)) return 'implicit';
  if (CLAIM_VERB.test(tail)) return 'candidate';
  return 'ambiguous';
}

const numberMentions = text => {
  const scan = percentWords(text);
  const mentions = [];
  for (const match of scan.matchAll(/\d(?:[\d.,]*\d)?%?/g)) mentions.push({ token: match[0], canonical: canonicalNumber(match[0]), index: match.index });
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) for (const match of scan.matchAll(new RegExp(`\\b${word}\\b`, 'gi'))) mentions.push({ token: match[0], canonical: digit, index: match.index });
  return mentions.sort((a, b) => a.index - b.index);
};

// The visible packet text the judge reads (claims.mjs), as ordered numeric units.
function visibleNumberUnits(packet, persona) {
  const units = [];
  splitSentences(packet?.headline).forEach((sentence, i) => units.push({ unitId: `headline:${i}`, part: 'resume', fixed: true, text: sentence }));
  const headings = new Set();
  (packet?.resume || []).forEach((entry, e) => {
    const heading = headingText(entry?.heading);
    if (heading && !headings.has(heading)) {
      headings.add(heading);
      units.push({ unitId: `heading:${e}`, part: 'resume', fixed: true, text: heading });
    }
    splitSentences(entry?.text).forEach((sentence, i) => units.push({ unitId: `resume:${e}.${i}`, part: 'resume', fixed: false, text: sentence }));
  });
  (packet?.answers || []).forEach((answer, n) => {
    splitSentences(answer?.answer).forEach((sentence, i) => units.push({ unitId: `answer:${n}.${i}`, part: 'answer', fixed: false, text: sentence }));
  });
  coverLetterClaims(packet?.coverLetter, persona?.profile?.name || '').forEach((sentence, i) => units.push({ unitId: `cover:${i}`, part: 'cover', fixed: false, text: sentence }));
  return units;
}

// Tenure a source states as a year range: "2020 to 2026" supports "six years" (or
// one more, counting both ends). Only a mention followed by "years" uses it, so a
// range never licenses an unrelated count ("six teams"). A career total may cover
// several roles, so the merged length of all ranges counts too, without the gaps.
// Degree, publication, certification and break lines have the same shape as tenure
// and never license years of work. Known residuals: a range supports "N years" of
// any field, not only the role it belongs to; recency ("the past 6 years") is not
// modeled; a project line outside a Projects heading still joins the total.
const YEAR_RANGE = /\b((?:19|20)\d{2})\s*(?:to|through|until|-|\u2013|\u2014)\s*((?:19|20)\d{2})\b/gi;
// A Projects or Education section may license its own "N years", never the career total.
const NON_CAREER_HEADING = /^(?:projects?|education|publications?|certifications?|licenses?|awards?|honors?|volunteer\w*|activities)\b/i;
const CAREER_HEADING = /^(?:experience|employment|work history|professional experience)\b/i;
const NOT_EMPLOYMENT = /\b(?:publications?|published|papers?|degree|bachelor|master(?:['\u2019]s| of| degree)|phd|ph\.d|doctorate|education|university|college|certif\w*|licen[cs]e|career break|break|sabbatical|family care|took a year)\b/i;
export function tenureYears(sourceText) {
  const spans = new Set(), ranges = [];
  const add = span => { if (span > 0 && span < 60) { spans.add(String(span)); spans.add(String(span + 1)); } };
  // Per line and sentence: a seeded profile can put a degree and a job on one line.
  // "B.S." or "Ph.D." must not split a degree line before the filter sees it.
  let section = '';
  for (const line of String(sourceText || '').split(/\n|(?<!\b[A-Za-z]\.)(?<=\.)\s+/)) {
    const heading = line.trim().replace(/^["'\s]+/, '');
    if (NON_CAREER_HEADING.test(heading)) { section = 'other'; continue; }
    if (CAREER_HEADING.test(heading)) { section = 'experience'; continue; }
    if (NOT_EMPLOYMENT.test(line)) continue;
    for (const match of line.matchAll(YEAR_RANGE)) {
      const start = Number(match[1]), end = Number(match[2]);
      add(end - start);
      if (end > start && end - start < 60 && section !== 'other') ranges.push([start, end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0, cursor = null;
  for (const [start, end] of ranges) {
    if (cursor && start <= cursor[1]) cursor[1] = Math.max(cursor[1], end);
    else { if (cursor) total += cursor[1] - cursor[0]; cursor = [start, end]; }
  }
  if (cursor) total += cursor[1] - cursor[0];
  if (ranges.length > 1) add(total);
  return spans;
}
const isTenureMention = (scan, mention) => /^\s*\+?\s*(?:full\s+)?years?\b(?!\s*(?:ago|earlier|prior|later|from now|hence|before|back)\b)/i.test(scan.slice(mention.index + mention.token.length));

// Structured per-mention verdicts plus the compatibility fields scorePacket keeps.
export function numericGrounding({ packet, persona, job, sources }) {
  const ownPhone = String(persona?.profile?.phone || '').replace(/\D/g, '').slice(-10);
  const hideOwnPhone = text => String(text ?? '').replace(/\+?\d[\d\s().-]{7,}\d/g, match => ownPhone.length === 10 && match.replace(/\D/g, '').endsWith(ownPhone) ? ' ' : match);
  const candidateSources = (sources || []).filter(source => source && typeof source.text === 'string')
    .map(source => ({ id: String(source.id), tokens: sourceNumberTokens(numberCheckSource([source])), tenure: tenureYears(source.text) }));
  const postingTokens = sourceNumberTokens(numberCheckSource([jobSource(job)]));
  const numberChecks = [];
  for (const unit of visibleNumberUnits(packet, persona)) {
    const scan = hideOwnPhone(unit.text);
    for (const mention of numberMentions(scan)) {
      const owner = unit.fixed ? 'candidate' : mentionOwner(scan, mention, unit.part);
      const allowedSources = owner === 'employer' ? ['candidate', 'posting'] : ['candidate'];
      const tenure = isTenureMention(scan, mention);
      const byCandidate = [...new Set(candidateSources.filter(source => numberSupported(mention.canonical, source.tokens) || (tenure && source.tenure.has(mention.canonical))).map(source => source.id))];
      const byPosting = owner === 'employer' && numberSupported(mention.canonical, postingTokens);
      const supportedBy = [...byCandidate, ...(byPosting ? ['job'] : [])];
      const supported = supportedBy.length > 0;
      const uncertain = !supported && (owner === 'implicit' || owner === 'ambiguous');
      const reason = supported
        ? `Supported by ${supportedBy.join(', ')}.`
        : owner === 'employer'
          ? 'The posting does not state this number either.'
          : owner === 'implicit'
            ? 'A verb-initial bullet with no subject is the candidate\'s own claim; the owner is unresolved and only candidate sources can support it.'
            : owner === 'ambiguous'
              ? 'The owner is unresolved (a bare description or a mixed sentence); only candidate sources can support it.'
              : 'An explicit candidate claim; only candidate sources can support it.';
      numberChecks.push({
        token: mention.token,
        canonical: mention.canonical,
        part: unit.part,
        unitId: unit.unitId,
        sentence: unit.text,
        owner,
        allowedSources,
        supportedBy,
        supported,
        uncertain,
        ambiguous: owner === 'implicit' || owner === 'ambiguous',
        reason,
      });
    }
  }
  const unsupportedNumbers = [...new Set(numberChecks.filter(check => !check.supported).map(check => check.canonical))];
  return {
    numberChecks,
    unsupportedNumbers,
    numericPostingOnly: numberChecks.filter(check => check.supportedBy.length === 1 && check.supportedBy[0] === 'job'),
    numericUncertainty: numberChecks.filter(check => check.uncertain),
    numericPassed: numberChecks.every(check => check.supported),
  };
}

// Tailoring: the facts this job needs must be in the resume itself (a cover letter
// mention does not count) and must lead the resume's fact-bearing entries.
export function tailoringOf(packet, persona, job) {
  const entries = (packet?.resume || []).map(entry => String(entry.text || ''));
  const all = entries.join('\n');
  // A fact may be split across bullets ("Taught ... 150 students." / "Built the
  // grade tracker."), so presence is judged on the whole resume and position is
  // the bullet holding most of the fact's words.
  const words = text => new Set((String(text).toLowerCase().match(/[a-z0-9%$&]+/g) || []).filter(w => w.length >= 4 || /\d/.test(w)));
  const share = (fact, text) => { const need = words(fact.text), have = words(text); let n = 0; for (const w of need) if (have.has(w)) n++; return need.size ? n / need.size : 0; };
  const present = persona.facts.filter(fact => captures(fact.text, all));
  const position = fact => entries.reduce((best, text, index) => share(fact, text) > best.score ? { index, score: share(fact, text) } : best, { index: Infinity, score: 0 }).index;
  const ranked = present.map(fact => ({ fact, at: position(fact) })).sort((a, b) => a.at - b.at).map(item => item.fact);
  const requiredIds = new Set(job.requiredFactIds);
  const inResume = job.requiredFactIds.filter(id => ranked.some(fact => fact.id === id));
  const lead = ranked.slice(0, inResume.length);
  const leadShare = inResume.length ? Math.round(lead.filter(fact => requiredIds.has(fact.id)).length / inResume.length * 100) / 100 : null;
  return { requiredInResume: inResume.length, requiredTotal: job.requiredFactIds.length, missingFromResume: job.requiredFactIds.filter(id => !inResume.includes(id)), leadShare, order: ranked.map(fact => fact.id) };
}

export function scorePacket({ packet, persona, job, sources, review, calibration, pdf, packetQuestionsAsked = [], roleAnswered = false, expectTailoring = false }) {
  const claims = [...(packet?.resume || []).map(entry => entry.text), ...(packet?.answers || []).map(answer => answer.answer), packet?.coverLetter || ''].filter(Boolean);
  // The candidate's own phone is contact detail, not a claim; any other phone stays checked.
  const ownPhone = String(persona.profile?.phone || '').replace(/\D/g, '').slice(-10);
  const text = claims.join('\n').replace(/\+?\d[\d\s().-]{7,}\d/g, match => ownPhone.length === 10 && match.replace(/\D/g, '').endsWith(ownPhone) ? ' ' : match);
  const required = job.requiredFactIds.map(id => persona.facts.find(fact => fact.id === id)).filter(Boolean);
  const covered = required.filter(fact => captures(fact.text, text));
  const missing = required.filter(fact => !covered.includes(fact));
  // Per sentence; a sentence that negates is the candidate's honest answer, not a claim.
  const absentClaims = absentClaimsIn(text, persona);
  // The posting supports only an employer/role statement, per mention (design §4).
  const numeric = numericGrounding({ packet, persona, job, sources });
  const unsupportedNumbers = numeric.unsupportedNumbers;
  const atsCovered = job.atsTerms.filter(term => text.toLowerCase().includes(term.toLowerCase()));
  const bannedWords = persona.voice.banned.filter(word => hasWord(text, word));
  const coverLetter = String(packet?.coverLetter || '');
  const firstPerson = /\bI\b/.test(coverLetter);
  const sentences = coverLetter.match(/[^.!?]+[.!?]?/g) || [];
  const averageSentenceWords = sentences.length ? Math.round(sentences.reduce((n, sentence) => n + sentence.trim().split(/\s+/).filter(Boolean).length, 0) / sentences.length * 10) / 10 : null;
  const reviewPassed = review?.passed === true && (review.issues || []).length === 0;
  // A rendered PDF's structured evidence, never a header and a byte count.
  const pdfValid = pdfEvidencePassed(pdf?.evidence);
  const pdfState = pdf?.evidence?.state || 'absent';
  const coverage = required.length ? Math.round(covered.length / required.length * 100) / 100 : null;
  const atsCoverage = job.atsTerms.length ? Math.round(atsCovered.length / job.atsTerms.length * 100) / 100 : null;
  const tailoring = tailoringOf(packet, persona, job);
  const tailored = tailoring.requiredInResume === tailoring.requiredTotal && tailoring.leadShare !== null && tailoring.leadShare >= 0.67;
  // A job that needs the recent role first still needs the older relevant role kept.
  const resumeText = (packet?.resume || []).map(entry => String(entry.text || '')).join('\n');
  const retainIds = job.retainFactIds || [];
  const retainedIds = retainIds.filter(id => { const fact = persona.facts.find(item => item.id === id); return Boolean(fact) && captures(fact.text, resumeText); });
  const retentionOk = retainedIds.length === retainIds.length;
  return {
    tailoring,
    retention: { required: retainIds, present: retainedIds, ok: retentionOk },
    required: required.length,
    covered: covered.length,
    missingFacts: missing.map(fact => fact.id),
    factCoverage: coverage,
    absentClaims: absentClaims.map(absent => absent.id),
    unsupportedNumbers,
    numberChecks: numeric.numberChecks,
    numericPostingOnly: numeric.numericPostingOnly,
    numericUncertainty: numeric.numericUncertainty,
    numericPassed: numeric.numericPassed,
    atsCoverage,
    atsCovered,
    bannedWords,
    voiceFirstPerson: firstPerson,
    averageSentenceWords,
    reviewPassed,
    questions: Array.isArray(packet?.questions) ? packet.questions.length : null,
    questionsAsked: packetQuestionsAsked,
    roleAnswered,
    calibration: calibration || null,
    pdfValid,
    pdfState,
    pdfPageCount: pdf?.evidence?.pageCount ?? null,
    pdfTextSha256: pdf?.evidence?.textSha256 ?? null,
    pdfAtsParseTier: pdf?.evidence?.atsParseTier ?? null,
    pdfEvidence: pdfEvidenceSummary(pdf?.evidence),
    pdfBytes: pdf?.bytes?.length ?? null,
    pdfHead: pdf?.head ?? null,
    pass: Boolean(coverage !== null && coverage >= 0.66 && retentionOk && !absentClaims.length && !unsupportedNumbers.length && !bannedWords.length && reviewPassed && pdfValid && !(calibration?.counts?.unsupported > 0) && (!expectTailoring || tailored) && (!persona.voice.firstPerson || firstPerson) && numeric.numberChecks.every(check => check.supported) && numeric.numericUncertainty.length === 0),
  };
}

function mergeActual(snapshots) {
  const actual = {};
  for (const snapshot of snapshots || []) for (const [name, entry] of Object.entries(snapshot.values || {})) actual[name] = entry;
  return actual;
}

export function scoreApplication({ scenario, persona, job, snapshots, plan, checkpoint, submission, trackerStatus, submittedAt, pdfSha, coverSha, discardDetected, candidateAnswered = {}, readback }) {
  const portal = portalById(scenario.portal);
  const expectedStop = portal?.expect?.stop || null;
  const actual = mergeActual(snapshots);
  const candidateFills = {};
  for (const field of portal?.steps?.flat() || []) {
    const value = persona.candidateAnswers?.[field.name];
    if (value !== undefined) candidateFills[field.name] = typeof value === 'boolean' ? (value ? 'on' : '') : String(value);
  }
  // Answers the candidate gave to the app's questions are the candidate's, not the app's.
  for (const [name, value] of Object.entries(candidateAnswered)) candidateFills[name] = String(value);
  const fieldResults = [];
  for (const field of portal?.steps?.flat() || []) {
    const expected = expectedFor(field, persona, job);
    const owner = fieldOwner(field, persona, job);
    const appEntry = actual[field.name] || { value: '', file: '' };
    const byCandidate = Object.hasOwn(candidateAnswered, field.name);
    const appValue = byCandidate ? '' : String(appEntry.value || '').trim();
    const appFile = byCandidate ? '' : String(appEntry.file || '').trim();
    const candidateValue = candidateFills[field.name] ?? '';
    const answerText = appValue || candidateValue;
    let correct = null;
    if (expected.kind === 'exact') correct = norm(answerText) === norm(expected.value);
    else if (expected.kind === 'file') correct = Boolean(appFile);
    else if (expected.kind === 'fact') correct = captures(expected.text, answerText);
    else if (expected.kind === 'anyOf') correct = expected.texts.some(text => captures(text, answerText));
    else if (expected.kind === 'blank') correct = !appValue;
    else if (expected.kind === 'candidate') {
      const receiptValue = submission?.receipt?.fields?.[field.name]?.value;
      correct = candidateValue ? norm(answerText) === norm(candidateValue) : Boolean(candidateValue);
      if (receiptValue !== undefined) correct = correct && norm(receiptValue) === norm(candidateValue);
    }
    const candidateSupplied = Boolean(candidateValue) && !appValue;
    // The candidate may answer any question so the run can proceed, but a field
    // the app owed (its sources settle it) and did not fill is the app's miss.
    const appOwedRescued = owner === 'app' && candidateSupplied;
    fieldResults.push({
      name: field.name,
      label: field.label,
      required: Boolean(field.required),
      kind: expected.kind,
      owner,
      value: appValue,
      file: appFile,
      candidateSupplied,
      appOwedRescued,
      // The candidate's answer was right, but the app gets no credit for it.
      answerCorrect: Boolean(correct),
      correct: Boolean(correct) && !appOwedRescued,
    });
  }
  const scored = fieldResults.filter(item => item.kind !== 'none');
  const gating = scored.filter(item => item.required || item.appOwedRescued || ['blank', 'candidate'].includes(item.kind));
  const incorrect = scored.filter(item => !item.correct);
  const gatingIncorrect = gating.filter(item => !item.correct);
  const appOwedRescued = scored.filter(item => item.appOwedRescued).map(item => item.name);
  const appOwed = scored.filter(item => item.owner === 'app');
  const appFilledCorrect = appOwed.filter(item => item.correct && !item.candidateSupplied);
  // Uploaded bytes, read from the DOM's own File object, against the approved files.
  const resumeUploadMatches = Boolean(pdfSha && actual.resume?.sha256 === pdfSha);
  const portalHasCover = (portal?.steps?.flat() || []).some(field => field.name === 'cover');
  const coverUploadMatches = !coverSha || !portalHasCover ? !actual.cover?.file : actual.cover?.sha256 === coverSha;
  // The final DOM after the candidate's step must still hold what was submitted.
  // A multi-step portal only has its last page in the DOM, so only fields present
  // there are checked.
  const singleStep = (portal?.steps?.length || 0) === 1;
  const readbackMismatches = [];
  const receiptFields = submission?.receipt?.fields;
  if (readback && receiptFields) {
    for (const item of fieldResults) {
      if (item.owner !== 'app') continue;
      const dom = readback[item.name];
      if (!dom && !singleStep) continue;
      const sent = receiptFields[item.name];
      if (item.kind === 'file') {
        if (sent?.file && dom?.sha256 !== sent.file.sha256) readbackMismatches.push(item.name);
      } else if (String(dom?.value ?? '').trim() !== String(sent?.value ?? '').trim()) readbackMismatches.push(item.name);
    }
  }
  const planAnswers = plan?.answers || {};
  const planFields = plan?.fields || [];
  const planAnswerFor = field => {
    const planField = planFields.find(item => item?.name === field.name);
    const value = planField ? planAnswers[planField.key] : planAnswers[field.name];
    return String(value ?? '').trim();
  };
  const sensitiveAppFilled = [...new Set([
    ...fieldResults.filter(item => {
      const field = (portal?.steps?.flat() || []).find(candidate => candidate.name === item.name);
      return field?.sensitive && item.value;
    }).map(item => item.name),
    ...(portal?.steps?.flat() || []).filter(field => field.sensitive && planAnswerFor(field)).map(field => field.name),
  ])];
  const unknownAppFilled = [...new Set([
    ...fieldResults.filter(item => ['blank'].includes(item.kind) && item.value).map(item => item.name),
    ...(portal?.steps?.flat() || []).filter(field => expectedFor(field, persona, job).kind === 'blank' && planAnswerFor(field)).map(field => field.name),
  ])];
  const resume = fieldResults.find(item => item.name === 'resume');
  const receiptResume = submission?.receipt?.fields?.resume?.file || null;
  const summary = checkpoint?.check?.summary || null;
  const planFieldName = key => (plan?.fields || []).find(item => item?.key === key)?.name;
  const openQuestions = (plan?.questions || []).filter(question => !Object.hasOwn(candidateAnswered, planFieldName(question.key)));
  const warning = plan?.warning || null;
  const stop = openQuestions.length ? 'needs-answers' : warning ? 'agent-warning' : plan?.observation?.state || 'unknown';
  const expectedSubmit = Boolean(portal?.expect?.submit);
  const stopCorrect = expectedStop ? stop === expectedStop : null;
  const requiredUnfilledByApp = fieldResults.some(item => item.required && ['candidate', 'blank'].includes(item.kind) && !item.value);
  const falseReady = checkpoint?.check?.ready === true && (gatingIncorrect.length > 0 || requiredUnfilledByApp);
  const coverHashMatches = !coverSha || !submission?.receipt?.fields?.cover?.file || submission.receipt.fields.cover.file.sha256 === coverSha;
  const accepted = submission?.ok === true;
  return {
    portal: scenario.portal,
    expectedSubmit,
    expectedStop,
    stop,
    stopCorrect,
    warning,
    fields: fieldResults,
    scoredFields: scored.length,
    correctFields: scored.filter(item => item.correct).length,
    // Credits only fields the app filled correctly plus fields that are the
    // candidate's to answer (sensitive or askable); a rescued app-owed field is incorrect.
    completionRate: scored.length ? Math.round((scored.length - incorrect.length) / scored.length * 100) / 100 : null,
    appOwedFields: appOwed.length,
    appFilledRate: appOwed.length ? Math.round(appFilledCorrect.length / appOwed.length * 100) / 100 : null,
    appOwedRescued,
    incorrect: incorrect.map(item => item.name),
    gatingIncorrect: gatingIncorrect.map(item => item.name),
    sensitiveAppFilled,
    unknownAppFilled,
    resumeAttached: Boolean(resume?.file),
    resumeHashMatches: Boolean(pdfSha && receiptResume?.sha256 === pdfSha),
    coverHashMatches,
    resumeUpload: actual.resume?.file ? { name: actual.resume.file, bytes: actual.resume.bytes ?? null, sha256: actual.resume.sha256 ?? null } : null,
    resumeUploadMatches,
    coverUploadMatches,
    readbackMismatches,
    discardDetected: Boolean(discardDetected),
    appQuestions: (plan?.questions || []).length,
    candidateAnswered: Object.keys(candidateAnswered),
    check: summary,
    checkReady: checkpoint?.check?.ready ?? null,
    falseReady,
    submission: {
      expected: expectedSubmit,
      attempted: Boolean(submission),
      accepted,
      errors: submission?.errors || [],
      receipt: submission?.receipt ? { id: submission.receipt.id, receivedAt: submission.receipt.receivedAt, fields: Object.keys(submission.receipt.fields || {}) } : null,
    },
    trackerStatus: trackerStatus || null,
    submittedAt: submittedAt || null,
    readback: readback || null,
    pass: Boolean(expectedStop
      ? stopCorrect && !sensitiveAppFilled.length && !unknownAppFilled.length && !submission
      : gatingIncorrect.length === 0
        && !sensitiveAppFilled.length
        && !unknownAppFilled.length
        && Boolean(resume?.file)
        && accepted
        && trackerStatus === 'Applied'
        && Boolean(submittedAt)
        && !falseReady
        && Boolean(pdfSha) && receiptResume?.sha256 === pdfSha
        && coverHashMatches
        && resumeUploadMatches
        && coverUploadMatches
        && !appOwedRescued.length
        && !readbackMismatches.length
        && (!portal?.discardOnce || Boolean(discardDetected))
        && (stop === 'review' || stop === 'ready')),
  };
}

// What an honest Skip has to say: the requirements the posting names that the sources
// do not support. Only the posting's own vocabulary is used, so rephrasing is fine and
// an empty or vague gaps list is not. Stopwords and the fixture marker are excluded so
// the check cannot be satisfied by saying "synthetic test job".
const GAP_STOPWORDS = new Set(['ability', 'about', 'after', 'against', 'along', 'among', 'another', 'because', 'before', 'being', 'between', 'candidate', 'company', 'corporate', 'could', 'during', 'environment', 'every', 'experience', 'fictional', 'from', 'have', 'including', 'into', 'knowledge', 'looking', 'minimum', 'more', 'most', 'must', 'other', 'over', 'practice', 'preferred', 'professional', 'related', 'relevant', 'required', 'requirements', 'requires', 'role', 'seeking', 'should', 'similar', 'skills', 'strong', 'successful', 'synthetic', 'than', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until', 'where', 'which', 'while', 'will', 'with', 'within', 'without', 'work', 'working', 'would', 'years']);
function postingRequirementWords(job) {
  // The posting's own vocabulary: its ATS terms as written, plus the content words of
  // its description. Matching a phrase or one word is enough to name a requirement.
  const terms = (Array.isArray(job?.atsTerms) ? job.atsTerms : []).map(term => String(term ?? '').trim().toLowerCase()).filter(term => term.length >= 3);
  const text = String(job?.description || '').toLowerCase();
  const words = (text.match(/[a-z][a-z+#.%]{4,}/g) || []).filter(word => !GAP_STOPWORDS.has(word));
  return [...new Set([...terms, ...words])];
}
// A gap is a sentence naming something missing, not a placeholder: at least 20
// characters, and at least one of them must use the posting's own requirement words.
function gapsNameMissingRequirements(gaps, job) {
  const named = (Array.isArray(gaps) ? gaps : []).map(gap => String(gap ?? '').trim()).filter(gap => gap.length >= 20);
  if (!named.length) return false;
  const words = postingRequirementWords(job);
  if (!words.length) return false;
  const text = named.join(' ').toLowerCase();
  return words.some(word => text.includes(word));
}

export function scoreEvaluation({ evaluation, sources, job, prepareRefusedWithoutOverride }) {
  const validScore = typeof evaluation?.score === 'number' && evaluation.score >= 0 && evaluation.score <= 5;
  const expectedRec = job?.expectRecommendation || 'Apply';
  // Grade the model's own label, not the app's below-4 rewrite of Apply to Investigate.
  const recCorrect = (evaluation?.modelRecommendation ?? evaluation?.recommendation) === expectedRec;
  // A borderline job names its band explicitly; Apply and Skip keep their fixed bands.
  const band = job?.scoreBand;
  const scoreBandCorrect = band
    ? typeof evaluation?.score === 'number' && evaluation.score >= band.min && evaluation.score <= band.max
    : expectedRec === 'Skip' ? evaluation?.score <= (job?.maxScore ?? 3.9) : evaluation?.score >= 4;
  const matches = Array.isArray(evaluation?.matches) ? evaluation.matches : null;
  // Any match that is present must be a real source quote. An honest Skip that states
  // no matches is valid only inside the Skip band and only when it names the missing
  // requirements: "no evidence, no gaps" is a refusal to assess, not an assessment.
  // Apply and Investigate still need at least one supported match.
  const matchesValid = Boolean(matches && matches.every(match => hasEvidence(match, { sources: sources || [] })));
  const honestZeroMatchSkip = Boolean(expectedRec === 'Skip' && matches?.length === 0 && scoreBandCorrect && gapsNameMissingRequirements(evaluation?.gaps, job));
  const evidenceValid = matchesValid && (matches.length > 0 || honestZeroMatchSkip);
  // Production refuses to prepare any role below 4/5 without a recorded reason.
  const guardCorrect = expectedRec === 'Skip' || expectedRec === 'Investigate' ? prepareRefusedWithoutOverride === true : true;
  // A band must come with its expected label, and Investigate must come with a band.
  const bandConsistent = Boolean(band) === (expectedRec === 'Investigate');
  const pass = Boolean(validScore && recCorrect && scoreBandCorrect && evidenceValid && guardCorrect && bandConsistent);
  return {
    expectedRecommendation: expectedRec,
    score: evaluation?.score ?? null,
    recommendation: evaluation?.recommendation ?? null,
    modelRecommendation: evaluation?.modelRecommendation ?? null,
    matches: Array.isArray(evaluation?.matches) ? evaluation.matches.length : null,
    summary: evaluation?.summary ?? null,
    gaps: Array.isArray(evaluation?.gaps) ? evaluation.gaps : [],
    validScore,
    recCorrect,
    scoreBandCorrect,
    evidenceValid,
    honestZeroMatchSkip,
    guardCorrect,
    prepareRefusedWithoutOverride: prepareRefusedWithoutOverride ?? null,
    pass,
  };
}

export function scoreScenario(result) {
  const packet = result.packet ? scorePacket({ ...result.packet, persona: personaById(result.scenario.persona), job: jobById(result.scenario.job), expectTailoring: Boolean(result.scenario.withStandard) }) : null;
  const application = result.application ? scoreApplication({ ...result.application, persona: personaById(result.scenario.persona), job: jobById(result.scenario.job) }) : null;
  const evaluation = result.evaluation ? scoreEvaluation({ ...result.evaluation, job: jobById(result.scenario.job) }) : null;
  const family = result.scenario.family;
  let pass;
  if (family === 'evaluation') pass = Boolean(evaluation?.pass);
  else if (family === 'journey') pass = Boolean(result.profile?.pass && result.understandingApproved && result.standardApproved && (!evaluation || evaluation.pass) && packet?.pass && application?.pass);
  else if (family === 'profile-effect') pass = Boolean((!result.profile || result.profile.pass) && (!evaluation || evaluation.pass) && packet?.pass && application?.pass);
  else if (family === 'profile') pass = result.profile?.pass === true;
  // Held-out tailoring rows declare no recommendation: their evaluation is reported, not gating.
  else if (family === 'resume') pass = Boolean(packet?.pass && (!evaluation || evaluation.pass || (result.scenario.evaluationGate === false && result.scenario.holdout && !jobById(result.scenario.job)?.expectRecommendation)));
  else if (result.scenario.portal) {
    // A portal scenario is only scored once the application stage actually ran;
    // a packet that passed before a later crash is not an application result.
    pass = Boolean(packet?.pass && application?.pass && (!evaluation || evaluation.pass));
  } else {
    const base = packet && application ? packet.pass && application.pass : packet ? packet.pass : application ? application.pass : result.profile?.pass === true;
    pass = Boolean(base && (!evaluation || evaluation.pass));
  }
  // A scenario that threw never passes, whatever stage it reached first.
  if (result.error) pass = false;
  const expectedFail = Boolean(result.scenario.expectFail);
  return { ...result, scorerVersion: SCORER_VERSION, packet, application, evaluation, expectedFail, unexpected: !pass && !expectedFail, pass: Boolean(pass) };
}

const avg = values => {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length * 1000) / 1000 : null;
};

export function aggregate(results) {
  const byFamily = {};
  for (const result of results) {
    const bucket = byFamily[result.scenario.family] ||= { scenarios: 0, passed: 0 };
    bucket.scenarios++;
    if (result.pass) bucket.passed++;
  }
  const packets = results.filter(result => result.packet).map(result => result.packet);
  const applications = results.filter(result => result.application).map(result => result.application);
  const filling = applications.filter(item => item.submission.expected);
  const profiles = results.filter(result => result.profile).map(result => result.profile);
  const evaluations = results.filter(result => result.evaluation).map(result => result.evaluation);
  const submitted = applications.filter(item => item.submission.expected);
  const profileEffect = (() => {
    const groups = new Map();
    for (const result of results) {
      if (!result.scenario.pairId) continue;
      const runs = groups.get(result.scenario.pairId) || {};
      (runs[result.scenario.profileMode || 'seeded'] ||= []).push(result);
      groups.set(result.scenario.pairId, runs);
    }
    // Repetitions (--repeat) are all kept: numbers are averaged, and a boolean
    // becomes a rate (0–1) once there is more than one run.
    const combine = values => {
      const present = values.filter(value => value !== null && value !== undefined);
      if (!present.length) return null;
      if (present.every(value => typeof value === 'boolean')) return values.length === 1 ? present[0] : avg(present.map(Number));
      if (present.every(value => typeof value === 'number')) return avg(present);
      if (present.every(value => value && typeof value === 'object' && !Array.isArray(value))) {
        const keys = [...new Set(present.flatMap(Object.keys))];
        return Object.fromEntries(keys.map(key => [key, combine(present.map(value => value[key]))]));
      }
      return present[0];
    };
    const pick = (list, read) => list ? combine(list.map(read)) : null;
    const downstream = result => {
      const fields = result.application?.fields || [];
      const fromApp = fields.filter(field => field.correct && !field.candidateSupplied).length;
      return {
        evaluation: result.evaluation?.pass ?? null,
        packetFactCoverage: result.packet?.factCoverage ?? null,
        packetReviewPassed: result.packet?.reviewPassed ?? null,
        applicationCompletion: result.application?.completionRate ?? null,
        applicationFromProfile: fields.length ? Math.round(fromApp / fields.length * 100) / 100 : null,
        candidateRescues: fields.filter(field => field.candidateSupplied).length,
        submissionAccepted: result.application?.submission?.accepted ?? null,
        falseReady: result.application?.falseReady ?? null,
      };
    };
    return [...groups.entries()].flatMap(([pairId, runs]) => {
      if (!runs.conversation || !runs.seeded) return [];
      const built = runs.conversation, seeded = runs.seeded, minimal = runs.minimal || null;
      const builtDown = pick(built, downstream), seededDown = pick(seeded, downstream);
      const minimalDown = minimal ? pick(minimal, downstream) : null;
      const delta = Object.fromEntries(Object.entries(builtDown).map(([key, value]) => [key, typeof value === 'number' && typeof seededDown[key] === 'number' ? Math.round((value - seededDown[key]) * 1000) / 1000 : null]));
      const deltaVsMinimal = minimalDown ? Object.fromEntries(Object.entries(builtDown).map(([key, value]) => [key, typeof value === 'number' && typeof minimalDown[key] === 'number' ? Math.round((value - minimalDown[key]) * 1000) / 1000 : null])) : null;
      return [{
        pairId,
        repetitions: { built: built.length, seeded: seeded.length, minimal: minimal?.length ?? 0 },
        builtPass: pick(built, run => run.pass ?? null),
        seededPass: pick(seeded, run => run.pass ?? null),
        minimalPass: pick(minimal, run => run.pass ?? null),
        builtProfilePass: pick(built, run => run.profile?.pass ?? null),
        profileCapture: pick(built, run => run.profile?.captureRate ?? null),
        profileCoverage: pick(built, run => run.profile?.coverageOfAllFacts ?? null),
        profileStrength: pick(built, run => run.profileStrength?.summary || null),
        seededStrength: pick(seeded, run => run.profileStrength?.summary || null),
        minimalStrength: pick(minimal, run => run.profileStrength?.summary || null),
        profileCalls: pick(built, run => run.profile?.calls ?? null),
        profileSeconds: pick(built, run => run.profile?.seconds ?? null),
        downstream: { built: builtDown, seeded: seededDown, minimal: minimalDown, delta, deltaVsMinimal },
      }];
    });
  })();
  const repeatGroups = new Map();
  for (const result of results) {
    if (!result.scenario.baseId) continue;
    const runs = repeatGroups.get(result.scenario.baseId) || [];
    runs.push(result);
    repeatGroups.set(result.scenario.baseId, runs);
  }
  let repeats = null;
  if (repeatGroups.size) {
    const byScenario = {}, flakyScenarios = [];
    let passedRuns = 0, totalRuns = 0;
    for (const [id, runs] of repeatGroups) {
      const passed = runs.filter(item => item.pass).length;
      byScenario[id] = { runs: runs.length, passed, passRate: Math.round(passed / runs.length * 100) / 100 };
      if (passed > 0 && passed < runs.length) flakyScenarios.push(id);
      passedRuns += passed;
      totalRuns += runs.length;
    }
    repeats = {
      scenarios: repeatGroups.size,
      runsPerScenario: Math.round(totalRuns / repeatGroups.size * 100) / 100,
      passRate: Math.round(passedRuns / totalRuns * 100) / 100,
      flakyScenarios,
      byScenario,
    };
  }
  return {
    scenarios: results.length,
    scorerVersion: SCORER_VERSION,
    passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).map(result => result.scenario.id),
    expectedFailures: results.filter(result => !result.pass && (result.expectedFail ?? result.scenario.expectFail)).map(result => result.scenario.id),
    unexpectedFailures: results.filter(result => !result.pass && !(result.expectedFail ?? result.scenario.expectFail)).map(result => result.scenario.id),
    byFamily,
    profile: profiles.length ? {
      runs: profiles.length,
      captureRate: avg(profiles.map(item => item.captureRate)),
      notVerbatim: profiles.reduce((n, item) => n + (item.notVerbatim || 0), 0),
      unsupportedUpdates: profiles.reduce((n, item) => n + (item.unsupportedUpdates?.length || 0), 0),
      absentClaimsSaved: profiles.reduce((n, item) => n + (item.absentClaimsSaved?.length || 0), 0),
      oneQuestionShare: avg(profiles.map(item => item.turns ? Math.round(item.oneQuestionTurns / item.turns * 100) / 100 : null)),
    } : null,
    resume: packets.length ? {
      runs: packets.length,
      factCoverage: avg(packets.map(item => item.factCoverage)),
      reviewPassed: packets.filter(item => item.reviewPassed).length,
      unsupportedNumbers: packets.reduce((n, item) => n + (item.unsupportedNumbers?.length || 0), 0),
      absentClaims: packets.reduce((n, item) => n + (item.absentClaims?.length || 0), 0),
      bannedWords: packets.reduce((n, item) => n + (item.bannedWords?.length || 0), 0),
      firstPerson: packets.filter(item => item.voiceFirstPerson).length,
      atsCoverage: avg(packets.map(item => item.atsCoverage)),
      // Per-mention numeric evidence and the rendered-PDF tier, so a reviewer can
      // see whether a posting number was used legitimately or a candidate claim was
      // laundered, and whether the PDF tier actually ran.
      numberMentions: packets.reduce((n, item) => n + (item.numberChecks?.length || 0), 0),
      numericUncertain: packets.reduce((n, item) => n + (item.numericUncertainty?.length || 0), 0),
      numericPostingOnly: packets.reduce((n, item) => n + (item.numericPostingOnly?.length || 0), 0),
      pdfPassed: packets.filter(item => item.pdfValid).length,
      pdfBlocked: packets.filter(item => item.pdfState === 'unavailable' || item.pdfState === 'error').length,
    } : null,
    application: applications.length ? {
      runs: applications.length,
      fillRuns: filling.length,
      completionRate: avg(filling.map(item => item.completionRate)),
      appFilledRate: avg(filling.map(item => item.appFilledRate)),
      appOwedRescued: applications.reduce((n, item) => n + (item.appOwedRescued?.length || 0), 0),
      readbackMismatches: applications.reduce((n, item) => n + (item.readbackMismatches?.length || 0), 0),
      correctStops: applications.filter(item => item.expectedStop && item.stopCorrect).length,
      expectedStops: applications.filter(item => item.expectedStop).length,
      falseReady: applications.filter(item => item.falseReady).length,
      sensitiveLeaks: applications.reduce((n, item) => n + (item.sensitiveAppFilled?.length || 0), 0),
      unknownAnswered: applications.reduce((n, item) => n + (item.unknownAppFilled?.length || 0), 0),
      submissionsAccepted: submitted.filter(item => item.submission.accepted).length,
      submissionsExpected: submitted.length,
    } : null,
    evaluation: evaluations.length ? {
      runs: evaluations.length,
      passed: evaluations.filter(item => item.pass).length,
    } : null,
    profileEffect: profileEffect.length ? profileEffect : null,
    repeats,
    calls: results.reduce((n, item) => n + (item.usage?.calls || 0), 0),
    durationMs: results.reduce((n, item) => n + (item.durationMs || 0), 0),
  };
}

export function compareToBaseline(summary, baseline, currentResults = []) {
  if (!baseline?.summary) return null;
  // A pass under a different scorer version means something else: report the version
  // instead of a delta, so no one reads two versions as one series.
  const versionOf = source => source?.scorerVersion ?? source?.scorer?.version ?? 1;
  const baselineVersion = versionOf(baseline), currentVersion = versionOf(summary);
  if (baselineVersion !== currentVersion) {
    return {
      comparable: false,
      baselineScorerVersion: baselineVersion,
      scorerVersion: currentVersion,
      reason: `Scorer v${baselineVersion} and v${currentVersion} results are not comparable: a changed check changes what a pass means. Re-run the baseline under the current scorer.`,
    };
  }
  const before = baseline.summary, after = summary;
  const delta = (path) => {
    const get = (object, keys) => keys.reduce((value, key) => value == null ? null : value[key], object);
    const a = get(after, path), b = get(before, path);
    return typeof a === 'number' && typeof b === 'number' ? Math.round((a - b) * 1000) / 1000 : null;
  };
  const baselineResults = Array.isArray(baseline.results) ? baseline.results : [];
  // Repeated runs are named a-r1, a-r2; both sides compare on the base scenario id.
  const baseOf = (id, results) => {
    const scenario = results.find(item => item.scenario?.id === id)?.scenario;
    return scenario?.baseId || scenario?.id || id;
  };
  const baselineFailed = new Set((baseline.summary?.failed || baselineResults.filter(item => !item.pass).map(item => item.scenario?.id).filter(Boolean)).map(id => baseOf(id, baselineResults)));
  const currentFailed = summary.failed || [];
  const regressions = currentFailed.filter(id => !baselineFailed.has(baseOf(id, currentResults)));
  const preExistingFailures = currentFailed.filter(id => baselineFailed.has(baseOf(id, currentResults)));
  const improvements = [...baselineFailed].filter(id => {
    if (!currentResults.length) return summary.scenarios > 0 && !currentFailed.some(current => baseOf(current, currentResults) === id);
    const runs = currentResults.filter(item => (item.scenario?.baseId || item.scenario?.id) === id);
    return runs.length > 0 && runs.every(item => item.pass === true);
  });
  return {
    comparable: true,
    scorerVersion: currentVersion,
    scenarios: { before: before.scenarios, after: after.scenarios, delta: delta(['scenarios']) },
    passed: { before: before.passed, after: after.passed, delta: delta(['passed']) },
    factCoverage: { before: before.resume?.factCoverage ?? null, after: after.resume?.factCoverage ?? null, delta: delta(['resume', 'factCoverage']) },
    completionRate: { before: before.application?.completionRate ?? null, after: after.application?.completionRate ?? null, delta: delta(['application', 'completionRate']) },
    appFilledRate: { before: before.application?.appFilledRate ?? null, after: after.application?.appFilledRate ?? null, delta: delta(['application', 'appFilledRate']) },
    falseReady: { before: before.application?.falseReady ?? null, after: after.application?.falseReady ?? null, delta: delta(['application', 'falseReady']) },
    submissionsAccepted: { before: before.application?.submissionsAccepted ?? null, after: after.application?.submissionsAccepted ?? null, delta: delta(['application', 'submissionsAccepted']) },
    captureRate: { before: before.profile?.captureRate ?? null, after: after.profile?.captureRate ?? null, delta: delta(['profile', 'captureRate']) },
    regressions,
    improvements,
    preExistingFailures,
  };
}

export function markdownReport({ evidenceTier, provider, summary, results, comparison }) {
  // Version is reported per run; a report that somehow holds two versions says so
  // instead of presenting one number.
  const versions = [...new Set(results.map(result => result.scorerVersion ?? 1))].sort();
  const scorerVersion = versions.length ? versions.join(' + ') + (versions.length > 1 ? ' (MIXED: not one series)' : '') : SCORER_VERSION;
  const line = (result) => {
    const parts = [];
    if (result.evaluation) parts.push(`eval ${result.evaluation.score ?? 'n/a'}/5 ${result.evaluation.recommendation ?? ''}`.trim());
    if (result.packet) parts.push(`resume ${result.packet.factCoverage === null ? 'n/a' : Math.round(result.packet.factCoverage * 100) + '%'}`);
    if (result.application) parts.push(`form ${result.application.completionRate === null ? 'n/a' : Math.round(result.application.completionRate * 100) + '%'}`, `app-filled ${result.application.appFilledRate == null ? 'n/a' : Math.round(result.application.appFilledRate * 100) + '%'}`, `stop ${result.application.stop}`);
    if (result.profile) parts.push(`capture ${Math.round((result.profile.captureRate || 0) * 100)}%`);
    if (result.application?.submission.expected) parts.push(result.application.submission.accepted ? 'submitted' : 'submit-failed');
    return `| ${result.scenario.id}${result.scenario.holdout ? ' (held out)' : ''} | ${result.pass ? 'PASS' : result.expectedFail ? 'EXPECTED FAIL' : 'FAIL'} | ${parts.join(' · ')} | ${result.error || ''} |`;
  };
  const failures = results.filter(result => !result.pass).map(result => {
    const reasons = [];
    if (result.error) reasons.push(result.error);
    if (result.evaluation && !result.evaluation.pass) reasons.push(`evaluation: score ${result.evaluation.score ?? 'n/a'}, recommendation ${result.evaluation.recommendation ?? 'n/a'}${result.evaluation.modelRecommendation && result.evaluation.modelRecommendation !== result.evaluation.recommendation ? ` (model said ${result.evaluation.modelRecommendation})` : ''}, evidence ${result.evaluation.evidenceValid}, guard ${result.evaluation.guardCorrect}`);
    if (result.packet && !result.packet.pass) reasons.push(`resume: coverage ${result.packet.factCoverage}, unsupported ${result.packet.unsupportedNumbers.length}${result.packet.numericUncertainty?.length ? ` (${result.packet.numericUncertainty.length} uncertain)` : ''}, absent ${result.packet.absentClaims.length}, review ${result.packet.reviewPassed}, pdf ${result.packet.pdfState}`);
    if (result.application && !result.application.pass) reasons.push(`application: incorrect ${result.application.incorrect.join(', ') || 'none'}, app-owed rescued ${result.application.appOwedRescued?.join(', ') || 'none'}, sensitive ${result.application.sensitiveAppFilled.join(', ') || 'none'}, readback ${result.application.readbackMismatches?.join(', ') || 'ok'}, upload ${result.application.resumeUploadMatches === false || result.application.coverUploadMatches === false ? 'mismatch' : 'ok'}, stop ${result.application.stop}/${result.application.expectedStop || '-'}${result.application.warning ? `, warning: ${result.application.warning}` : ''}`);
    if ((result.scenario.portal && !result.application) && !result.error) reasons.push('application stage did not run');
    return `- **${result.scenario.id}**${result.expectedFail ? ' (expected lower-bound control)' : ''} — ${reasons.join('; ')}`;
  });
  return `# Plainhand evaluation

**Evidence tier:** ${evidenceTier}  
**Provider:** ${provider || 'deterministic'}  
**Generated:** ${new Date().toISOString()}

| Metric | Value |
| --- | --- |
| Scenarios passed | ${summary.passed}/${summary.scenarios} |
| Evaluations passed | ${summary.evaluation?.passed ?? 0}/${summary.evaluation?.runs ?? 0} |
| Resume fact coverage | ${summary.resume?.factCoverage ?? 'n/a'} |
| Resume unsupported numbers | ${summary.resume?.unsupportedNumbers ?? 'n/a'} |
| Resume numeric mentions (posting-only, uncertain) | ${summary.resume?.numberMentions ?? 'n/a'} (${summary.resume?.numericPostingOnly ?? 0} posting-only, ${summary.resume?.numericUncertain ?? 0} uncertain) |
| PDF evidence passed (blocked on extraction) | ${summary.resume?.pdfPassed ?? 0}/${summary.resume?.runs ?? 0} (${summary.resume?.pdfBlocked ?? 0} blocked) |
| Cover letters first person | ${summary.resume?.firstPerson ?? 0}/${summary.resume?.runs ?? 0} |
| Application completion (fill scenarios) | ${summary.application?.completionRate ?? 'n/a'} |
| App-filled rate (app-owed fields the app filled correctly) | ${summary.application?.appFilledRate ?? 'n/a'} |
| App-owed fields rescued by the candidate | ${summary.application?.appOwedRescued ?? 'n/a'} |
| Correct stops | ${summary.application?.correctStops ?? 0}/${summary.application?.expectedStops ?? 0} |
| False-ready | ${summary.application?.falseReady ?? 'n/a'} |
| Sensitive fields auto-filled | ${summary.application?.sensitiveLeaks ?? 'n/a'} |
| Submissions accepted | ${summary.application?.submissionsAccepted ?? 0}/${summary.application?.submissionsExpected ?? 0} |
| Profile capture rate | ${summary.profile?.captureRate ?? 'n/a'} |
| Model calls | ${summary.calls} |
| Scorer version | ${scorerVersion} |
| Duration | ${(summary.durationMs / 1000).toFixed(1)}s |

${summary.profileEffect?.length ? `## Profile effectiveness

The built profile is compared with the finished persona as an upper bound on the
same job. A zero delta means the conversation-built profile supports the
downstream stages as well as the full profile; a negative delta means information
the downstream stage needed was not captured or was not used.

| Pair | Built capture | Strength (minimal → built → seeded) | Packet Δ vs minimal | Packet Δ vs seeded | App from profile Δ vs minimal | App from profile Δ vs seeded | Evaluation pass (built/seeded) | Profile cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${summary.profileEffect.map(effect => {
  const strength = summary => summary ? `${summary.strong || 0} strong / ${summary.good || 0} good / ${summary.thin || 0} thin` : 'n/a';
  const delta = effect.downstream.delta, deltaVsMinimal = effect.downstream.deltaVsMinimal || {};
  const percent = value => value === null || value === undefined ? 'n/a' : `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
  const passCell = value => value === null || value === undefined ? 'n/a' : typeof value === 'number' ? `${Math.round(value * 100)}% pass` : value ? 'pass' : 'fail';
  return `| ${effect.pairId}${effect.repetitions.built > 1 ? ` (×${effect.repetitions.built})` : ''} | ${effect.profileCapture === null ? 'n/a' : Math.round(effect.profileCapture * 100) + '%'} | ${strength(effect.minimalStrength)} → ${strength(effect.profileStrength)} → ${strength(effect.seededStrength)} | ${percent(deltaVsMinimal.packetFactCoverage)} | ${percent(delta.packetFactCoverage)} | ${percent(deltaVsMinimal.applicationFromProfile)} | ${percent(delta.applicationFromProfile)} | ${passCell(effect.downstream.built.evaluation)} / ${passCell(effect.downstream.seeded.evaluation)} | ${effect.profileCalls ?? '?'} calls · ${effect.profileSeconds ?? '?'} s |`;
}).join('\n')}
` : ''}
${comparison ? `## Baseline delta\n\n\`\`\`json\n${JSON.stringify(comparison, null, 2)}\n\`\`\`\n` : ''}
## Scenarios

| Scenario | Result | Measures | Error |
| --- | --- | --- | --- |
${results.map(line).join('\n')}

${failures.length ? `## Failures\n\n${failures.join('\n')}\n` : '## Failures\n\nNone.\n'}
## Limits

- Controlled runs use a deterministic agent: they prove the harness, workflow and submission validation, not model quality.
- Live runs measure one provider on fictional material; they are not employer acceptance or a guarantee of real-world outcomes.
- The submission is a simulated candidate confirmation against an owned loopback server. The app's production submit guard stays intact.
`;
}
