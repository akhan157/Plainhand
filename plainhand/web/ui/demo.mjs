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
  const evidence = [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis for the Formula SAE team.' }];
  const jobs = [
    { id: 'sample-1', company: 'Northstar Robotics', title: 'Mechanical Engineer, New Graduate', location: 'Boston, MA · On-site', url: 'https://example.invalid/northstar', createdAt: earlier(2), selected: true, stage: 'packet-ready', status: 'Apply', description: 'Fictional sample role for exploring the interface.', verification: { state: 'active', reason: 'Fictional sample. Nothing was checked.', checkedAt: earlier(2) },
      evaluation: { score: 4.6, recommendation: 'Apply', summary: 'Your mechanical design and physical testing experience aligns with this sample role. The strongest evidence is your Formula SAE chassis project.', matches: [{ text: 'Hands-on mechanical design and testing experience.', evidence }], gaps: ['Industry experience is not yet documented.'], questions: [], legitimacyNotes: ['Fictional example; not a real posting.'] },
      packet: { headline: 'Mechanical Engineering Graduate', resume: [{ section: 'Projects', text: 'Formula SAE — Designed and tested a lightweight chassis for the team.', evidence }, { section: 'Education', text: 'B.S. Mechanical Engineering, Example University, 2027.', evidence: [{ sourceId: 'cv', quote: 'B.S. Mechanical Engineering, Example University, 2027.' }] }], coverLetter: 'I’m interested in the opportunity to work on physical systems at Northstar Robotics. Through Formula SAE, I designed and tested a lightweight chassis and learned to connect design decisions with what happens in the workshop. I would welcome the chance to bring that approach to your engineering team.', answers: [{ question: 'Tell us about a project you are proud of.', answer: 'I designed and tested a lightweight chassis for our Formula SAE team. The most useful lesson was connecting the design process with hands-on testing.', evidence }], questions: [] },
      calibration: { band: 'mixed', total: 4, modelRated: true, balancedShare: 0.5, counts: { undersold: 1, balanced: 2, stretched: 1, unsupported: 0 }, claims: [
        { id: 'resume:0', rating: 'undersold', text: 'Formula SAE — Designed and tested a lightweight chassis for the team.', reason: 'Your story says you owned the design and test loop; this reads like a supporting role.', suggestion: 'Formula SAE — Owned the design and test loop for a lightweight chassis.' },
        { id: 'resume:1', rating: 'balanced', text: 'B.S. Mechanical Engineering, Example University, 2027.', reason: 'Matches your resume.', suggestion: '' },
        { id: 'answer:0', rating: 'balanced', text: 'I designed and tested a lightweight chassis for our Formula SAE team.', reason: 'Matches your story.', suggestion: '' },
        { id: 'cover:1', rating: 'stretched', text: 'Through Formula SAE, I designed and tested a lightweight chassis and learned to connect design decisions with what happens in the workshop.', reason: 'Nothing in your sources says you worked in the workshop yourself.', suggestion: 'Through Formula SAE, I designed and tested a lightweight chassis with the teammates who built it.' },
      ] },
      review: { passed: true, issues: [] } },
    { id: 'sample-4', company: 'Tidewater Instruments', title: 'Test Engineer I', location: 'Providence, RI · Hybrid', url: 'https://example.invalid/tidewater', createdAt: earlier(16), selected: true, stage: 'submitted', status: 'Interview', submittedAt: earlier(12), description: 'Fictional sample role.',
      evaluation: { score: 4.3, recommendation: 'Apply', summary: 'A sample test-engineering role that matches your physical testing work.', matches: [{ text: 'Physical test planning and analysis.', evidence }], gaps: [], questions: [], legitimacyNotes: ['Fictional sample.'] },
      statusHistory: [{ from: 'Evaluated', to: 'Apply', at: earlier(14) }, { from: 'Apply', to: 'Applied', at: earlier(12) }, { from: 'Applied', to: 'Interview', at: earlier(4) }],
      record: { nextAction: { text: 'Send references to the recruiter', due: shift(-1) }, interviews: [{ id: 'r1', stage: 'Technical interview', date: shift(3), status: 'scheduled', interviewer: 'Sam Rivera', preparation: 'Walk through the chassis test plan', notes: '' }, { id: 'r0', stage: 'Recruiter screen', date: shift(-4), status: 'completed', interviewer: 'Dana Lee', preparation: '', notes: 'Asked for two references.' }], contacts: [{ id: 'c1', name: 'Dana Lee', role: 'Technical recruiter', type: 'recruiter', email: 'dana@example.invalid', addedAt: earlier(4) }] } },
    { id: 'sample-3', company: 'Fieldwork Systems', title: 'Associate Product Design Engineer', location: 'Denver, CO · Hybrid', url: 'https://example.invalid/fieldwork', createdAt: earlier(3), selected: true, stage: 'evaluated', status: 'Evaluated', description: 'Fictional sample role.',
      evaluation: { score: 4.4, recommendation: 'Apply', summary: 'A sample fit for an engineer who enjoys iterative physical product design.', matches: [{ text: 'Design iteration grounded in physical testing.', evidence }], gaps: ['Consumer product experience is not yet documented.'], questions: [], legitimacyNotes: ['Fictional sample.'] } },
    { id: 'sample-2', company: 'Arcwell Energy', title: 'Graduate Manufacturing Engineer', location: 'Austin, TX · On-site', url: 'https://example.invalid/arcwell', createdAt: earlier(5), selected: false, stage: 'evaluated', status: 'Evaluated', description: 'Fictional sample role.',
      evaluation: { score: 3.7, recommendation: 'Investigate', summary: 'A sample opportunity to use practical design experience in a manufacturing environment.', matches: [{ text: 'Experience building and testing a physical system.', evidence }], gaps: ['Production-line experience is not documented.'], questions: ['Have you worked with production tooling?'], legitimacyNotes: ['Fictional sample.'] } },
    { id: 'sample-5', company: 'Lumen Aerospace', title: 'Structures Engineer, Early Career', location: 'Seattle, WA', url: 'https://example.invalid/lumen', createdAt: at, selected: false, stage: 'inbox', description: '' },
  ];
  const followUps = [
    { jobId: 'sample-4', action: 'Send references to the recruiter', due: shift(-1), overdue: true, dueToday: false, last: earlier(4) },
  ];
  return {
    revision: 0, demo: true,
    profile: { name: 'Alex Morgan', email: 'alex@example.invalid', location: 'Boston, MA', graduation: 'Mechanical Engineering · Class of 2027', roles: 'Mechanical engineer, design engineer', resume: 'Designed and tested a lightweight chassis for the Formula SAE team.', story: 'I enjoy turning ideas into things you can test. I led the chassis design work for our Formula SAE team.', voice: 'Clear, curious, and specific. I prefer showing what I built over calling myself passionate.', constraints: 'Looking for an early-career role with hands-on engineering and mentorship.' },
    provider: 'codex', tasks: [{ id: 'sample-task', kind: 'evaluate', jobId: 'sample-3', status: 'complete', message: 'Finished', createdAt: earlier(3), finishedAt: earlier(3) }], sources: [{ id: 'sample-source', name: 'Northstar Robotics', url: 'https://example.invalid/careers' }],
    conversation: [
      { role: 'assistant', text: 'What’s a project you’re proud of, and what did you personally contribute?', at: earlier(6) },
      { role: 'user', text: 'Our Formula SAE chassis. I owned the design and ran the physical tests with two teammates.', at: earlier(6) },
    ],
    events: [{ at, text: 'This is a fictional workspace to explore the Plainhand experience.' }, { at: earlier(3), text: 'Evaluated Fieldwork Systems — Associate Product Design Engineer: 4.4/5.' }],
    sourceManifest: [{ id: 'cv', characters: 1520 }, { id: 'profile', characters: 830 }],
    understanding: { approved: true, result: { summary: 'A hands-on mechanical engineering graduate who connects CAD, physical testing, and clear teamwork. Your strongest stories come from Formula SAE and building real prototypes.', strengths: ['Designing with manufacturing constraints in mind', 'Explaining tradeoffs through test results'], voice: 'Specific, clear, and quietly confident.', sampleAnswer: 'I’m proudest of our Formula SAE chassis work. I owned the design and test loop, and learned how much better a design gets when the people building it are part of the conversation.', gaps: ['Confirm work authorization before answering eligibility questions.'], questions: [] } },
    claimLineView: { decisions: 4, allowedStretches: [], strict: ['ownership'], keepUnderstated: [], wantsMore: ['results'],
      summary: ['Holds ownership (helped, built, led) to the evidence (chose the closer wording 2 of 2 times).', 'Wants results and numbers stated fully (chose to say more 2 of 2 times).'],
      statements: ['I only say I led something if I was the one making the calls.'] },
    profileStrength: {
      foundation: { level: 'good', present: 4, total: 6, missing: ['the story your resume doesn’t tell', 'a sample of how you write'] },
      depth: { level: 'thin', statements: 1, words: 16, withNumbers: 0 },
      coverage: { level: 'good', evaluated: 3, minimum: 3, average: 0.67, storyEvidenceShare: 0.25, recurringGaps: [{ text: 'No production GD&T experience shown', roles: 2 }] },
      review: { level: 'strong', status: 'approved', built: 2, approved: 1, approvalRate: 0.5, openQuestions: 1, openQuestionsBefore: 4, firstQuestion: null },
      next: [
        { kind: 'foundation', text: 'Add the story your resume doesn’t tell and a sample of how you write.' },
        { kind: 'depth', text: 'Tell your agent about a project or job you’re proud of: what you did, how, and what came of it.' },
        { kind: 'coverage', text: '2 roles flagged: No production GD&T experience shown. If you have related experience, tell your agent about it.' },
      ],
    },
    jobs, followUps, answerBank: [], corrections: [], audit: [], usage: null, tracker: '', loginSessions: [], localCaptchaSolver: { installed: false },
    asOf: todayISO(),
  };
}
