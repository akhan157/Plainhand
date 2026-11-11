// Rubric grading of a prepared packet by a model judge. The judge scores six
// anchored 1-5 dimensions and must quote the packet to justify each score; every
// quote is checked in code. A model's grade is a measurement to be calibrated
// against human ratings (see docs/internal/EVALUATION-JUDGE.md), not ground truth.
//
// Use a judge provider that differs from the provider under test when possible:
// models tend to rate text written by themselves more favourably (self-preference).
import { executeAgent, providerById } from '../agents.mjs';
import { extractClaims, checkClaims, matchQuote, packetText } from './claims.mjs';

export const RUBRIC = [
  {
    id: 'relevance',
    name: 'Relevance to this job',
    anchors: {
      1: 'Generic: the packet could be sent to any job, and it misses the job\'s central requirements even where the sources contain matching experience.',
      3: 'Relevant experience is present but mixed with weakly related or generic lines, or the most relevant experience is buried below less relevant material.',
      5: 'Leads with the experience that matches the job\'s central requirements; nearly every line serves this job; the job\'s vocabulary appears only where the work genuinely involved it.',
    },
  },
  {
    id: 'specificity',
    name: 'Specificity and evidence',
    anchors: {
      1: 'Mostly vague duties or stock phrases ("results-driven", "team player"); little a reader could check or picture.',
      3: 'A mix of concrete lines and vague ones; some results, numbers or scope that the sources contain are left out.',
      5: 'Lines name the concrete work, tools, scope and results, with the numbers the sources contain; a reader can picture what the candidate did.',
    },
  },
  {
    id: 'structure',
    name: 'Structure and ordering',
    anchors: {
      1: 'Disorganised: entries under wrong headings, repeated lines, a wall of text, or core sections (education, experience or projects) missing.',
      3: 'Readable, but with ordering problems for the candidate\'s level, entries split or duplicated, or bullets of very uneven length.',
      5: 'Conventional sections in a sensible order for the candidate\'s level, each entry under its correct heading, one idea per line; the cover letter has a clear opening, evidence and close.',
    },
  },
  {
    id: 'voice',
    name: 'Voice match',
    anchors: {
      1: 'Clearly another voice: inflated marketing tone, third person where first person is expected, or several of the candidate\'s banned words.',
      3: 'Mostly a neutral template tone with a partial match to the stated voice; occasional stock phrasing or one banned word.',
      5: 'The cover letter and answers read like the stated voice: sentence length, formality and person match, and no banned word appears.',
    },
  },
  {
    id: 'cover',
    name: 'Cover letter effectiveness',
    anchors: {
      1: 'Boilerplate, wrong company or role, placeholders left in, or mostly enthusiasm with no evidence.',
      3: 'Correct but generic: it restates the resume, links weakly to this job, or runs long.',
      5: 'Names the company and role, connects two or three specific true experiences to what this job needs, stays short and closes plainly; no paragraph could be reused unchanged for another employer.',
    },
  },
  {
    id: 'honesty',
    name: 'Honesty and calibration',
    anchors: {
      1: 'Invented experience, numbers, titles or skills, or claims the sources contradict.',
      3: 'Mostly supported, with one or two stretched claims (a stronger verb, scope or level than the evidence, such as "led" for "coordinated") or a clear undersell of a result the sources support.',
      5: 'Every claim matches the strength of its evidence: nothing stretched, nothing invented, gaps the job asks about are not papered over, and supported results are not undersold.',
    },
  },
];

export const DIMENSIONS = RUBRIC.map(item => item.id);

export const RUBRIC_INSTRUCTION = `You are grading another system's output, not writing for the candidate. The system prepared a job application packet for a fictional candidate. INPUT.packet is that packet, INPUT.sources is the only evidence about the candidate, INPUT.job is the job, INPUT.voice is how the candidate wants to sound (bannedWords must not appear), and INPUT.rubric defines each dimension with anchors for scores 1, 3 and 5 (2 and 4 fall between them). Produce {dimensions:[{id:string, score:integer 1-5 or null, excerpt:string, reason:string}], overall:integer 1-5, improvements:string[]}.
Return one entry for every rubric id. excerpt is a span copied character for character from INPUT.packet that best justifies the score; it is checked by exact string match. reason is one sentence tying the excerpt to the anchor. Score "cover" null with excerpt "" when the packet has no cover letter.
Rules: do not reward length; a longer packet is not a better one, and padding, repetition and generic lines lower relevance and specificity. Penalise any claim the sources do not support: an unsupported or stretched claim caps honesty at 2 and also lowers the dimension it appears in. Do not reward job keywords that the sources do not back. Judge the packet as written, not what the candidate could have written. overall is your holistic 1-5 judgement of whether this packet would serve the candidate for this job, not an average. improvements: at most 3 concrete changes, each naming the line to change and what to change it to, using only facts in the sources.`;

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

export function spread(values) {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!numbers.length) return { mean: null, min: null, max: null, sd: null, n: 0 };
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const sd = Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length);
  return { mean: round(mean), min: Math.min(...numbers), max: Math.max(...numbers), sd: round(sd), n: numbers.length };
}

const validScore = value => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 1 && number <= 5 ? number : null;
};

// Parses one judge reply into verified per-dimension results.
export function parseRubricResponse(response, packet) {
  if (!response || typeof response !== 'object') throw new Error('The rubric judge returned no JSON object.');
  const text = packetText(packet);
  const hasCover = Boolean(String(packet?.coverLetter ?? '').trim());
  const list = Array.isArray(response.dimensions)
    ? response.dimensions
    : response.dimensions && typeof response.dimensions === 'object' ? Object.entries(response.dimensions).map(([id, value]) => ({ id, ...value })) : [];
  const dimensions = {};
  for (const id of DIMENSIONS) {
    const item = list.find(entry => entry?.id === id);
    if (id === 'cover' && !hasCover) { dimensions[id] = { score: null, excerpt: null, excerptVerified: null, reason: 'No cover letter in the packet.', notApplicable: true }; continue; }
    if (!item) { dimensions[id] = { score: null, excerpt: null, excerptVerified: null, reason: 'Judge returned nothing for this dimension.', missing: true }; continue; }
    const excerpt = typeof item.excerpt === 'string' ? item.excerpt : '';
    const excerptMatch = excerpt.trim() ? matchQuote(excerpt, text, 1) : null;
    dimensions[id] = {
      score: validScore(item.score),
      excerpt: excerpt || null,
      excerptVerified: Boolean(excerptMatch),
      excerptMatch,
      reason: typeof item.reason === 'string' ? item.reason : '',
    };
  }
  const improvements = (Array.isArray(response.improvements) ? response.improvements : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 3);
  return { dimensions, overall: validScore(response.overall), improvements };
}

// Grades the packet `samples` times and reports mean and spread per dimension.
export async function gradePacket({ packet, sources = [], job, persona, judge, samples = 1 }) {
  if (typeof judge !== 'function') throw new Error('gradePacket needs a judge function.');
  const count = Math.max(1, Math.floor(Number(samples) || 1));
  const data = {
    job: { company: job?.company ?? null, title: job?.title ?? null, location: job?.location ?? null, description: job?.description ?? '' },
    voice: { description: persona?.profile?.voice ?? '', bannedWords: persona?.voice?.banned ?? [], firstPerson: Boolean(persona?.voice?.firstPerson) },
    sources: (sources || []).filter(source => source && typeof source.text === 'string').map(source => ({ id: String(source.id), text: source.text })),
    packet: { headline: packet?.headline ?? '', resume: (packet?.resume || []).map(entry => ({ section: entry?.section ?? null, heading: entry?.heading ?? null, text: entry?.text ?? '' })), coverLetter: packet?.coverLetter ?? '', answers: (packet?.answers || []).map(answer => ({ question: answer?.question ?? '', answer: answer?.answer ?? '' })) },
    rubric: RUBRIC,
  };
  const runs = [];
  // Sequential on purpose: live CLIs are rate-limited and samples should be independent calls.
  for (let i = 0; i < count; i++) {
    try { runs.push(parseRubricResponse(await judge(RUBRIC_INSTRUCTION, data), packet)); }
    catch (error) { runs.push({ error: error.message }); }
  }
  const ok = runs.filter(run => !run.error);
  if (!ok.length) throw new Error(`Every rubric sample failed: ${runs[0].error}`);
  const dimensions = {};
  for (const id of DIMENSIONS) {
    const scores = ok.map(run => run.dimensions[id].score);
    dimensions[id] = {
      ...spread(scores),
      scores,
      excerpts: ok.map(run => ({ excerpt: run.dimensions[id].excerpt, verified: run.dimensions[id].excerptVerified, reason: run.dimensions[id].reason })),
      ...(ok.every(run => run.dimensions[id].notApplicable) ? { notApplicable: true } : {}),
    };
  }
  const overallScores = ok.map(run => run.overall);
  const unverifiedExcerpts = ok.flatMap((run, sample) => DIMENSIONS.filter(id => run.dimensions[id].excerptVerified === false).map(id => ({ sample, dimension: id, excerpt: run.dimensions[id].excerpt })));
  return {
    samples: count,
    succeeded: ok.length,
    failed: runs.filter(run => run.error).map(run => run.error),
    dimensions,
    overall: { ...spread(overallScores), scores: overallScores },
    improvements: ok.find(run => run.improvements.length)?.improvements || [],
    unverifiedExcerpts,
  };
}

// Claims and rubric for one packet: 1 claim call plus `samples` rubric calls.
export async function judgePacket({ packet, sources = [], job, persona, judge, samples = 1 }) {
  const claims = extractClaims(packet, { candidateName: persona?.name });
  const claimResult = await checkClaims({ claims, sources, job, persona, judge, packet }).catch(error => ({ error: error.message }));
  const rubric = await gradePacket({ packet, sources, job, persona, judge, samples }).catch(error => ({ error: error.message }));
  return { claims: claimResult, rubric };
}

// A judge backed by a real provider CLI through the app's own executeAgent.
// Prefer a provider different from the one under test (self-preference).
export function liveJudge(providerId, { timeoutMs = 600000, execute = executeAgent } = {}) {
  const provider = providerById(providerId);
  if (provider.builtIn) throw new Error(`${provider.id} runs inside the app with a sign-in token and cannot be used as a judge from the command line. Use claude, codex or antigravity.`);
  const judge = (instruction, data) => execute(providerId, instruction, data, { timeout: timeoutMs });
  judge.providerId = providerId;
  return judge;
}

// Run-level numbers for a list of judgePacket results, for the main report.
export function summarizeJudgements(results) {
  const judged = results.filter(result => result && !result.error);
  const claimRuns = judged.map(result => result.claims).filter(claims => claims && !claims.error);
  const rubricRuns = judged.map(result => result.rubric).filter(rubric => rubric && !rubric.error);
  const sum = key => claimRuns.reduce((n, run) => n + (run.counts?.[key] || 0), 0);
  const counts = { supported: sum('supported'), partially_supported: sum('partially_supported'), unsupported: sum('unsupported'), not_a_factual_claim: sum('not_a_factual_claim'), unjudged: sum('unjudged') };
  const factual = counts.supported + counts.partially_supported + counts.unsupported;
  return {
    packets: judged.length,
    claimRuns: claimRuns.length,
    rubricRuns: rubricRuns.length,
    claimCounts: counts,
    unsupportedRate: factual ? round(counts.unsupported / factual, 3) : null,
    downgradedQuotes: claimRuns.reduce((n, run) => n + (run.downgraded || 0), 0),
    factCoverageSemantic: spread(claimRuns.map(run => run.factCoverageSemantic)).mean,
    factCoverageOverlap: spread(claimRuns.map(run => run.factCoverageOverlap)).mean,
    dimensions: Object.fromEntries(DIMENSIONS.map(id => [id, spread(rubricRuns.map(run => run.dimensions?.[id]?.mean)).mean])),
    overall: spread(rubricRuns.map(run => run.overall?.mean)).mean,
    unverifiedExcerpts: rubricRuns.reduce((n, run) => n + (run.unverifiedExcerpts?.length || 0), 0),
  };
}
