// The sample workspace: a fictional candidate and fictional roles, browser
// only. Every write is refused by api() while it is shown.
import { todayISO } from './core.mjs';

function shift(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function demoState() {
  const at = new Date().toISOString();
  const earlier = days => new Date(Date.now() - days * 86400000).toISOString();
  const evidence = [{ sourceId: 'cv', quote: 'Built the valuation models behind 3 of the student investment fund’s 12 holdings.' }];
  const jobs = [
    { id: 'sample-1', company: 'Northbank Financial', title: 'Financial Analyst, Rotational Program', location: 'Boston, MA · Hybrid', url: 'https://example.invalid/northbank', createdAt: earlier(2), selected: true, stage: 'packet-ready', status: 'Apply', description: 'Fictional sample role for exploring the interface.', verification: { state: 'active', reason: 'Fictional sample. Nothing was checked.', checkedAt: earlier(2) },
      evaluation: { score: 4.6, recommendation: 'Apply', summary: 'Your modeling and analysis experience aligns with this sample role. The strongest evidence is the valuation work you did for the student investment fund.', matches: [{ text: 'Hands-on financial modeling with real decisions riding on it.', evidence }], gaps: ['Corporate finance experience is not yet documented.'], questions: [], legitimacyNotes: ['Fictional example; not a real posting.'] },
      packet: { headline: 'Finance Graduate', resume: [{ section: 'Experience', text: 'Student Investment Fund — Built the valuation models behind 3 of the fund’s 12 holdings.', evidence }, { section: 'Education', text: 'B.S. Finance, Example University, 2027.', evidence: [{ sourceId: 'cv', quote: 'B.S. Finance, Example University, 2027.' }] }], coverLetter: 'I’m applying for the Financial Analyst rotational program at Northbank Financial. In our student investment fund I built the valuation models behind 3 of the fund’s 12 holdings and presented each one to the investment committee myself. I would welcome the chance to bring that same care with numbers to your rotations.', answers: [{ question: 'Tell us about a project you are proud of.', answer: 'I built the valuation models behind 3 of our student investment fund’s 12 holdings. The most useful lesson was writing down my assumptions so someone else could challenge them.', evidence }], questions: [] },
      calibration: { band: 'mixed', total: 4, modelRated: true, balancedShare: 0.5, counts: { undersold: 1, balanced: 2, stretched: 1, unsupported: 0 }, claims: [
        { id: 'resume:0', rating: 'undersold', text: 'Student Investment Fund — Built the valuation models behind 3 of the fund’s 12 holdings.', reason: 'Your story says you also led the industrials coverage team; this leaves that out.', suggestion: 'Student Investment Fund — Led industrials coverage and built the valuation models behind 3 of the fund’s 12 holdings.' },
        { id: 'resume:1', rating: 'balanced', text: 'B.S. Finance, Example University, 2027.', reason: 'Matches your resume.', suggestion: '' },
        { id: 'answer:0', rating: 'balanced', text: 'I built the valuation models behind 3 of our student investment fund’s 12 holdings.', reason: 'Matches your story.', suggestion: '' },
        { id: 'cover:1', rating: 'stretched', text: 'In our student investment fund I built the valuation models behind 3 of the fund’s 12 holdings and presented each one to the investment committee myself.', reason: 'Your sources say the team presented to the committee, not that you presented each one yourself.', suggestion: 'In our student investment fund I built the valuation models behind 3 of the fund’s 12 holdings and helped present them to the investment committee.' },
      ] },
      review: { passed: true, issues: [] } },
    { id: 'sample-4', company: 'Riverside Analytics', title: 'Data Analyst I', location: 'Providence, RI · Hybrid', url: 'https://example.invalid/riverside', createdAt: earlier(16), selected: true, stage: 'submitted', status: 'Interview', submittedAt: earlier(12), description: 'Fictional sample role.',
      evaluation: { score: 4.3, recommendation: 'Apply', summary: 'A sample analyst role that matches your modeling and spreadsheet work.', matches: [{ text: 'Building models other people rely on.', evidence }], gaps: [], questions: [], legitimacyNotes: ['Fictional sample.'] },
      statusHistory: [{ from: 'Evaluated', to: 'Apply', at: earlier(14) }, { from: 'Apply', to: 'Applied', at: earlier(12) }, { from: 'Applied', to: 'Interview', at: earlier(4) }],
      record: { nextAction: { text: 'Send references to the recruiter', due: shift(-1) }, interviews: [{ id: 'r1', stage: 'Case interview', date: shift(3), status: 'scheduled', interviewer: 'Sam Rivera', preparation: 'Walk through the assumptions in one valuation model', notes: '' }, { id: 'r0', stage: 'Recruiter screen', date: shift(-4), status: 'completed', interviewer: 'Dana Lee', preparation: '', notes: 'Asked for two references.' }], contacts: [{ id: 'c1', name: 'Dana Lee', role: 'University recruiter', type: 'recruiter', email: 'dana@example.invalid', addedAt: earlier(4) }] } },
    { id: 'sample-3', company: 'Greenline Software', title: 'Business Analyst', location: 'Denver, CO · Hybrid', url: 'https://example.invalid/greenline', createdAt: earlier(3), selected: true, stage: 'evaluated', status: 'Evaluated', description: 'Fictional sample role.',
      evaluation: { score: 4.4, recommendation: 'Apply', summary: 'A sample fit for someone who likes turning numbers into decisions.', matches: [{ text: 'Analysis that led to a real decision.', evidence }], gaps: ['SQL experience is not yet documented.'], questions: [], legitimacyNotes: ['Fictional sample.'] } },
    { id: 'sample-2', company: 'Cedar Insurance', title: 'Risk Analyst', location: 'Austin, TX · On-site', url: 'https://example.invalid/cedar', createdAt: earlier(5), selected: false, stage: 'evaluated', status: 'Evaluated', description: 'Fictional sample role.',
      evaluation: { score: 3.7, recommendation: 'Investigate', summary: 'A sample opportunity to apply your modeling skills to insurance risk.', matches: [{ text: 'Careful quantitative modeling.', evidence }], gaps: ['Experience with insurance or claims data is not documented.'], questions: ['Have you worked with insurance or claims data?'], legitimacyNotes: ['Fictional sample.'] } },
    { id: 'sample-5', company: 'Brightpath Labs', title: 'Research Analyst', location: 'Seattle, WA', url: 'https://example.invalid/brightpath', createdAt: at, selected: false, stage: 'inbox', description: '' },
  ];
  const followUps = [
    { jobId: 'sample-4', action: 'Send references to the recruiter', due: shift(-1), overdue: true, dueToday: false, last: earlier(4) },
  ];
  return {
    revision: 0, demo: true,
    profile: { name: 'Alex Morgan', email: 'alex@example.invalid', location: 'Boston, MA', graduation: 'Finance · Class of 2027', roles: 'Financial analyst, data analyst, business analyst', resume: 'Built the valuation models behind 3 of the student investment fund’s 12 holdings.', story: 'I like getting a model to the point where someone can make a decision from it. In the student investment fund I led the industrials coverage team of four.', voice: 'Clear, precise, and specific. I prefer showing what I built over calling myself passionate.', constraints: 'Looking for an early-career analyst role with real ownership and good mentorship.' },
    provider: 'codex', tasks: [{ id: 'sample-task', kind: 'evaluate', jobId: 'sample-3', status: 'complete', message: 'Finished', createdAt: earlier(3), finishedAt: earlier(3) }], sources: [{ id: 'sample-source', name: 'Northbank Financial', url: 'https://example.invalid/careers' }],
    conversation: [
      { role: 'assistant', text: 'What’s a project you’re proud of, and what did you personally contribute?', at: earlier(6) },
      { role: 'user', text: 'The student investment fund. I led industrials coverage and built three of the valuation models we invested on.', at: earlier(6) },
    ],
    events: [{ at, text: 'This is a fictional workspace to explore the Plainhand experience.' }, { at: earlier(3), text: 'Evaluated Greenline Software — Business Analyst: 4.4/5.' }],
    sourceManifest: [{ id: 'cv', characters: 1520 }, { id: 'profile', characters: 830 }],
    understanding: { approved: true, result: { summary: 'A finance graduate who builds careful models and can explain them. Your strongest story is the valuation work for the student investment fund.', strengths: ['Building models with assumptions others can check', 'Leading a small coverage team'], voice: 'Precise, specific, and quietly confident.', sampleAnswer: 'I’m proudest of the valuation models I built for our student investment fund. Three of them led to positions we still hold, and I learned to write down every assumption so others could challenge it.', gaps: ['Confirm work authorization before answering eligibility questions.'], questions: [] } },
    claimLineView: { decisions: 4, allowedStretches: [], strict: ['ownership'], keepUnderstated: [], wantsMore: ['results'],
      summary: ['Holds ownership (helped, built, led) to the evidence (chose the closer wording 2 of 2 times).', 'Wants results and numbers stated fully (chose to say more 2 of 2 times).'],
      statements: ['I only say I led something if I was the one making the calls.'] },
    profileStrength: {
      foundation: { level: 'good', present: 4, total: 6, missing: ['the story your resume doesn’t tell', 'a sample of how you write'] },
      depth: { level: 'thin', statements: 1, words: 16, withNumbers: 0 },
      coverage: { level: 'good', evaluated: 3, minimum: 3, average: 0.67, storyEvidenceShare: 0.25, recurringGaps: [{ text: 'No SQL experience shown', roles: 2 }] },
      review: { level: 'strong', status: 'approved', built: 2, approved: 1, approvalRate: 0.5, openQuestions: 1, openQuestionsBefore: 4, firstQuestion: null },
      next: [
        { kind: 'foundation', text: 'Add the story your resume doesn’t tell and a sample of how you write.' },
        { kind: 'depth', text: 'Tell your agent about a project or job you’re proud of: what you did, how, and what came of it.' },
        { kind: 'coverage', text: '2 roles flagged: No SQL experience shown. If you have related experience, tell your agent about it.' },
      ],
    },
    jobs, followUps, answerBank: [], corrections: [], audit: [], usage: null, tracker: '', loginSessions: [], localCaptchaSolver: { installed: false },
    asOf: todayISO(),
  };
}
