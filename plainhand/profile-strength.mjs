// Profile strength: how well Plainhand knows the candidate, computed only from data
// it already stores (profile fields, the candidate's own statements, evaluations and
// the understanding review log). Heuristic signals, not a grade: each dimension says
// what it counted, and "not enough data" is never reported as weak. Items marked
// fromModel quote text a model wrote from postings or the resume, so they stay out of
// the always-sent agent digest.

const FOUNDATION = [['name', 'your name'], ['resume', 'your resume'], ['roles', 'the roles you want'], ['location', 'your location'], ['story', 'the story your resume doesn’t tell'], ['voice', 'a sample of how you write']];
const MIN_EVALUATIONS = 3;
const STORY_SOURCES = new Set(['interview', 'stories', 'narrative', 'proof-points']);
const STOP = new Set('about after also and any are been but can does each experience from have into more must need needs not only role roles some such than that the their them there they this those with without would your candidate required requires requirement listed mentioned evidence clear clearly unclear'.split(' '));

const words = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const tokens = text => new Set(String(text || '').toLowerCase().match(/[a-z][a-z0-9+#.-]{3,}/g)?.filter(w => !STOP.has(w)) || []);
const jaccard = (a, b) => { let shared = 0; for (const w of a) if (b.has(w)) shared++; return shared / (a.size + b.size - shared || 1); };
const ratio = (part, whole) => whole ? Math.round(part / whole * 100) / 100 : null;

export function candidateStatements(state) {
  const fromConversation = (state.conversation || []).filter(m => m.role === 'user').map(m => m.text);
  const fromProfile = String(state.profile?.story || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return [...fromProfile, ...fromConversation].filter(text => words(text) >= 5);
}

// Stories told in conversation count for the story field.
function foundation(profile = {}, hasStatements = false, hasSamples = false) {
  const missing = FOUNDATION.filter(([key]) => !String(profile[key] || '').trim() && !(key === 'story' && hasStatements) && !(key === 'voice' && hasSamples)).map(([, label]) => label);
  const present = FOUNDATION.length - missing.length;
  return { level: present === FOUNDATION.length ? 'strong' : present >= 4 ? 'good' : 'thin', present, total: FOUNDATION.length, missing };
}

function depth(state) {
  const statements = candidateStatements(state);
  // In conversation a story and its follow-up details arrive as separate short
  // messages, so depth counts total words rather than long single statements.
  const total = statements.reduce((n, text) => n + words(text), 0);
  const withNumbers = statements.filter(text => /\d/.test(text)).length;
  const level = statements.length < 3 ? 'thin' : statements.length >= 5 && total >= 150 && withNumbers >= 3 ? 'strong' : total >= 80 ? 'good' : 'thin';
  return { level, statements: statements.length, words: total, withNumbers };
}

// Gap texts are written by the model, so similar gaps are grouped by shared words.
export function recurringGaps(evaluated) {
  const clusters = [];
  for (const job of evaluated) {
    for (const gap of job.evaluation.gaps || []) {
      const set = tokens(gap);
      if (!set.size) continue;
      const cluster = clusters.find(c => jaccard(c.tokens, set) >= 0.4);
      if (cluster) { cluster.jobs.add(job.id); for (const w of set) cluster.tokens.add(w); }
      else clusters.push({ text: gap, tokens: set, jobs: new Set([job.id]) });
    }
  }
  return clusters.filter(c => c.jobs.size >= 2).sort((a, b) => b.jobs.size - a.jobs.size).map(c => ({ text: c.text, roles: c.jobs.size }));
}

function coverage(jobs = []) {
  const evaluated = jobs.filter(job => Array.isArray(job.evaluation?.matches));
  const perJob = evaluated.map(job => ratio(job.evaluation.matches.length, job.evaluation.matches.length + (job.evaluation.gaps || []).length) ?? 0);
  const quotes = evaluated.flatMap(job => job.evaluation.matches.flatMap(m => m.evidence || []));
  const fromStories = quotes.filter(e => STORY_SOURCES.has(e.sourceId)).length;
  const average = perJob.length ? Math.round(perJob.reduce((a, b) => a + b, 0) / perJob.length * 100) / 100 : null;
  const level = evaluated.length < MIN_EVALUATIONS ? 'not-enough-data' : average >= 0.75 ? 'strong' : average >= 0.6 ? 'good' : 'thin';
  return { level, evaluated: evaluated.length, minimum: MIN_EVALUATIONS, average, storyEvidenceShare: ratio(fromStories, quotes.length), recurringGaps: recurringGaps(evaluated).slice(0, 5) };
}

// The understanding log records each summary built and each approval, so rebuilding
// before approving (the candidate wanted something changed) is visible.
function review(state) {
  const log = state.understandingLog || [];
  const built = log.filter(e => e.event === 'built');
  const approved = log.filter(e => e.event === 'approved').length;
  const current = state.understanding?.result;
  const openQuestions = current ? (current.questions || []).length + (current.gaps || []).length : null;
  const previous = built.length >= 2 ? built.at(-2) : null;
  const status = !state.understanding ? 'none' : state.understanding.approved ? 'approved' : 'needs-review';
  const level = status === 'approved' ? (openQuestions <= 2 ? 'strong' : 'good') : built.length ? 'thin' : 'not-enough-data';
  return { level, status, built: built.length, approved, approvalRate: ratio(approved, built.length), openQuestions,
    openQuestionsBefore: previous ? previous.questions + previous.gaps : null, firstQuestion: current?.questions?.[0] || current?.gaps?.[0] || null };
}

export function profileStrength(state) {
  const result = { foundation: foundation(state.profile, (state.conversation || []).some(m => m.role === 'user'), (state.writingSamples || []).length > 0), depth: depth(state), coverage: coverage(state.jobs), review: review(state) };
  const next = [];
  const { foundation: f, depth: d, coverage: c, review: r } = result;
  if (f.missing.length) next.push({ kind: 'foundation', text: `Add ${f.missing.slice(0, 2).join(' and ')}.` });
  if (d.statements < 3) next.push({ kind: 'depth', text: 'Tell your agent about a project or job you’re proud of: what you did, how, and what came of it.' });
  else if (d.withNumbers < Math.min(3, d.statements)) next.push({ kind: 'depth', text: 'Add results with numbers to your stories (size, time saved, people, budget, scores).' });
  else if (d.level === 'thin') next.push({ kind: 'depth', text: 'Go deeper on one story: the problem, what you personally did, and the outcome.' });
  for (const gap of c.recurringGaps.slice(0, 2)) next.push({ kind: 'coverage', fromModel: true, text: `${gap.roles} roles flagged: ${gap.text}. If you have related experience, tell your agent about it.` });
  if (c.level !== 'not-enough-data' && c.storyEvidenceShare !== null && c.storyEvidenceShare < 0.2 && d.statements >= 3) next.push({ kind: 'coverage', text: 'Evaluations rarely cite your stories; rebuild your understanding so they are used.' });
  if (r.status === 'needs-review') next.push({ kind: 'review', text: 'Review how your agent sees you and approve it only if it reflects you.' });
  else if (r.firstQuestion) next.push({ kind: 'review', fromModel: true, text: `Open question: ${r.firstQuestion}` });
  const levels = Object.values(result).map(x => x.level);
  return { ...result, summary: { strong: levels.filter(l => l === 'strong').length, good: levels.filter(l => l === 'good').length, thin: levels.filter(l => l === 'thin').length, notEnoughData: levels.filter(l => l === 'not-enough-data').length }, next: next.slice(0, 4) };
}

export function logUnderstanding(state, entry) {
  state.understandingLog = [...(state.understandingLog || []), { at: new Date().toISOString(), ...entry }].slice(-30);
}
