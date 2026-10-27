/** Claim calibration benchmark: can Plainhand tell underselling from inflating?
 *
 *   node benchmark-calibration.mjs                    rule checks only, against 24 labelled claims
 *   node benchmark-calibration.mjs --provider claude  + the reviewer model, and real drafted packets
 *
 * Part 1 grades labelled claims (undersold, balanced, stretched, unsupported) with the
 * rule checks, the reviewer model and the two combined, and reports agreement with the
 * labels. Part 2 (live only) drafts a packet per persona for a fictional job and grades
 * it, showing where real drafts land between underselling and inflating. Part 3 (live)
 * drafts the same application for two candidates with different lines (strict and
 * comfortable), learned from choices on two earlier applications, and checks each
 * draft against its own candidate's line.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { executeAgent, PACKET_INSTRUCTION, REVIEW_INSTRUCTION } from './plainhand/agents.mjs';
import { UsageLedger } from './plainhand/usage.mjs';
import { Workspace } from './plainhand/store.mjs';
import { gradePacket, RATINGS } from './plainhand/claim-calibration.mjs';
import { recordDecision, candidateLine, lineInput } from './plainhand/claim-line.mjs';
import { initialState } from './plainhand/store.mjs';
import { cases, sourcesFor } from './plainhand/benchmarks/calibration-cases.mjs';
import { personas } from './plainhand/benchmarks/profile-bench.mjs';

const option = name => { const i = process.argv.indexOf('--' + name); return i < 0 ? null : process.argv[i + 1]; };
const provider = option('provider');
const JOBS = {
  'mech-grad': { company: 'Fictional Robotics Co', title: 'Junior Mechanical Design Engineer', description: 'SYNTHETIC TEST JOB. Design and test mechanical assemblies for mobile robots. SolidWorks, FEA, prototyping and test planning. GD&T for production parts is a plus. Work with technicians to build and test prototypes.' },
  'career-changer': { company: 'Fictional Health Analytics', title: 'Data Analyst', description: 'SYNTHETIC TEST JOB. Build dashboards and reports in SQL and Tableau for operations teams. Explain findings to non-technical stakeholders. Python a plus. Two years of business analytics experience preferred.' },
  'quiet-junior': { company: 'Fictional Transit Software', title: 'Junior Software Engineer', description: 'SYNTHETIC TEST JOB. TypeScript services and web apps for transit riders. Write tests, take part in code review, and join an on-call rotation after onboarding.' },
};

const SEVERITY = { undersold: -1, balanced: 0, stretched: 1, unsupported: 2 };
const direction = r => Math.sign(SEVERITY[r]);
function agreement(rows, key) {
  const graded = rows.filter(r => r[key]);
  const exact = graded.filter(r => r[key] === r.expected).length;
  const dir = graded.filter(r => direction(r[key]) === direction(r.expected)).length;
  const confusion = Object.fromEntries(RATINGS.map(e => [e, Object.fromEntries(RATINGS.map(g => [g, graded.filter(r => r.expected === e && r[key] === g).length]))]));
  // The two errors that matter: calling inflation fine, and calling a fair claim inflated.
  const missedInflation = graded.filter(r => direction(r.expected) > 0 && direction(r[key]) <= 0).length;
  const falseAlarms = graded.filter(r => direction(r.expected) <= 0 && direction(r[key]) > 0).length;
  const missedUndersell = graded.filter(r => r.expected === 'undersold' && r[key] !== 'undersold').length;
  return { graded: graded.length, exact, exactRate: graded.length ? Math.round(exact / graded.length * 100) / 100 : null, directionRate: graded.length ? Math.round(dir / graded.length * 100) / 100 : null, missedInflation, falseAlarms, missedUndersell, confusion };
}

const root = await mkdtemp(path.join(tmpdir(), 'plainhand-calibration-bench-'));
const ledger = new UsageLedger(new Workspace(root));
const call = (instruction, data, purpose) => ledger.track(executeAgent, provider, instruction, data, { usageContext: { purpose } });
const rows = [], drafts = [], lines = [];
try {
  for (const persona of [...new Set(cases.map(c => c.persona))]) {
    const mine = cases.filter(c => c.persona === persona);
    const sources = sourcesFor(persona);
    const packet = { headline: 'Benchmark packet', resume: mine.map(c => ({ section: 'Experience', text: c.text, evidence: [{ sourceId: sources.find(s => s.text.includes(c.quote)).id, quote: c.quote }] })), coverLetter: '', answers: [], questions: [], suggestions: [] };
    const rulesOnly = gradePacket(packet, sources, []);
    let review = null;
    if (provider) {
      try { review = await call(REVIEW_INSTRUCTION, { context: { sources }, job: JOBS[persona], packet }, 'calibration-bench-review'); }
      catch (error) { console.log(`${persona}: reviewer failed: ${error.message}`); }
    }
    const modelOnly = new Map((review?.calibration || []).filter(r => RATINGS.includes(r?.rating)).map(r => [r.id, r]));
    const combined = review ? gradePacket(packet, sources, review.calibration) : null;
    mine.forEach((c, i) => rows.push({ persona, expected: c.expected, note: c.note, text: c.text, rules: rulesOnly.claims[i].rating, model: modelOnly.get(`resume:${i}`)?.rating || null, combined: combined?.claims[i].rating || null, reason: modelOnly.get(`resume:${i}`)?.reason || rulesOnly.claims[i].reason }));
  }
  if (provider) {
    for (const persona of personas) {
      const sources = sourcesFor(persona.id);
      try {
        const packet = await call(PACKET_INSTRUCTION, { context: { sources }, job: JOBS[persona.id], roleAnswers: '' }, 'calibration-bench-draft');
        const review = await call(REVIEW_INSTRUCTION, { context: { sources }, job: JOBS[persona.id], packet }, 'calibration-bench-draft-review');
        const grade = gradePacket(packet, sources, review.calibration);
        drafts.push({ persona: persona.id, passedReview: review.passed, issues: review.issues, band: grade.band, counts: grade.counts, balancedShare: grade.balancedShare,
          flagged: grade.claims.filter(c => c.rating !== 'balanced').map(c => ({ rating: c.rating, text: c.text, reason: c.reason, suggestion: c.suggestion, source: c.source })) });
        console.log(`draft ${persona.id}: ${grade.band} · ${JSON.stringify(grade.counts)} · review ${review.passed ? 'passed' : 'failed'}`);
      } catch (error) { drafts.push({ persona: persona.id, error: error.message }); console.log(`draft ${persona.id}: failed: ${error.message}`); }
    }
  }
  if (provider) {
    // Two candidates, same evidence and job, different lines. Their earlier choices are
    // replayed on the labelled engineering claims from two earlier applications.
    const persona = 'mech-grad', sources = sourcesFor(persona), job = JOBS[persona];
    const earlier = cases.filter(c => c.persona === persona && ['stretched', 'undersold'].includes(c.expected));
    const prior = gradePacket({ resume: earlier.map(c => ({ section: 'Experience', text: c.text, evidence: [{ sourceId: sources.find(s => s.text.includes(c.quote)).id, quote: c.quote }] })), answers: [], coverLetter: '' }, sources,
      earlier.map((c, i) => ({ id: `resume:${i}`, rating: c.expected, kind: /led|lead/i.test(c.text) ? 'ownership' : /expert|familiar/i.test(c.text) ? 'level' : /20%/.test(c.text) ? 'numbers' : /adopted|daily/i.test(c.text) ? 'scope' : 'results', suggestion: 'Closer wording.' })));
    const profiles = {
      strict: { keep: () => false, statement: 'I only say I led something if I was the one making the calls, and I never round numbers up.' },
      comfortable: { keep: claim => claim.rating === 'stretched' && ['ownership', 'numbers'].includes(claim.kind), statement: 'If I coordinated the team, calling it leading is fine by me, and rounding 18% to nearly 20% is fine.' },
    };
    const draftWith = async (label, candidateState) => {
      const line = candidateState ? lineInput(candidateState, 'bench') : null;
      const packet = await call(PACKET_INSTRUCTION, { context: { sources }, job, roleAnswers: '', ...(line ? { candidateLine: line } : {}) }, 'calibration-bench-line-draft');
      const review = await call(REVIEW_INSTRUCTION, { context: { sources }, job, packet, ...(line ? { candidateLine: line } : {}) }, 'calibration-bench-line-review');
      return { label, packet, review };
    };
    const states = Object.fromEntries(Object.entries(profiles).map(([name, p]) => {
      const state = initialState();
      for (const jobId of ['earlier-1', 'earlier-2']) for (const claim of prior.claims) recordDecision(state, { jobId, claim, decision: p.keep(claim) ? 'keep-mine' : 'use-suggestion' });
      state.claimLine.statements.push({ text: p.statement, at: new Date().toISOString() });
      return [name, state];
    }));
    try {
      const runs = [await draftWith('no line', null), await draftWith('strict', states.strict), await draftWith('comfortable', states.comfortable)];
      for (const run of runs) for (const [name, state] of Object.entries(states)) {
        const grade = gradePacket(run.packet, sources, run.review.calibration, candidateLine(state));
        const outside = grade.claims.filter(c => !c.withinLine && c.rating !== 'balanced');
        lines.push({ draft: run.label, judgedBy: name, line: candidateLine(state).allowedStretches, passedReview: run.review.passed, band: grade.band, counts: grade.counts,
          outsideLine: outside.length, unsupported: grade.counts.unsupported, flagged: outside.map(c => `${c.rating}/${c.kind}: ${c.text.slice(0, 120)}`) });
      }
      for (const l of lines) console.log(`line: draft "${l.draft}" judged by ${l.judgedBy}'s line: ${l.band} · outside line ${l.outsideLine} · within ${l.counts.withinLine} · unsupported ${l.unsupported} · review ${l.passedReview ? 'passed' : 'failed'}`);
    } catch (error) { lines.push({ error: error.message }); console.log('line scenario failed: ' + error.message); }
  }
  const result = { date: new Date().toISOString(), provider: provider || 'rules-only', cases: rows.length, lines,
    rules: agreement(rows, 'rules'), model: provider ? agreement(rows, 'model') : null, combined: provider ? agreement(rows, 'combined') : null,
    drafts, usage: provider ? (await ledger.summary({ jobs: [] })).totals : null, rows };
  const directory = path.join('output', `calibration-benchmark-${provider || 'rules'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2));
  for (const key of ['rules', 'model', 'combined']) if (result[key]) console.log(`${key.padEnd(8)} exact ${result[key].exact}/${result[key].graded} · right direction ${result[key].directionRate} · missed inflation ${result[key].missedInflation} · false alarms ${result[key].falseAlarms} · missed undersell ${result[key].missedUndersell}`);
  console.log('Evidence: ' + directory);
} finally { await rm(root, { recursive: true, force: true }); }
