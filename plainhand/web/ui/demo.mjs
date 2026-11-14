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
  const evidence = [{ sourceId: 'cv', quote: 'Ran the fall fundraising campaign for the campus food pantry, raising $4,200 from 310 donors.' }];
  const jobs = [
    { id: 'sample-1', company: 'Harbor Health Network', title: 'Patient Experience Coordinator', location: 'Boston, MA · On-site', url: 'https://example.invalid/harbor', createdAt: earlier(2), selected: true, stage: 'packet-ready', status: 'Apply', description: 'Fictional sample role for exploring the interface.', verification: { state: 'active', reason: 'Fictional sample. Nothing was checked.', checkedAt: earlier(2) },
      evaluation: { score: 4.6, recommendation: 'Apply', summary: 'Your experience organizing people and following through on details aligns with this sample role. The strongest evidence is the food pantry campaign you ran.', matches: [{ text: 'Coordinating volunteers and keeping track of many people at once.', evidence }], gaps: ['Healthcare experience is not yet documented.'], questions: [], legitimacyNotes: ['Fictional example; not a real posting.'] },
      packet: { headline: 'Communications Graduate', resume: [{ section: 'Experience', text: 'Campus Food Pantry — Ran the fall fundraising campaign, raising $4,200 from 310 donors.', evidence }, { section: 'Education', text: 'B.A. Communications, Example University, 2027.', evidence: [{ sourceId: 'cv', quote: 'B.A. Communications, Example University, 2027.' }] }], coverLetter: 'I’m interested in helping patients feel looked after at Harbor Health Network. Last fall I ran the fundraising campaign for our campus food pantry, raising $4,200 from 310 donors, and personally thanked every one of them. I would welcome the chance to bring that care for each person to your patient experience team.', answers: [{ question: 'Tell us about a project you are proud of.', answer: 'I ran the fall fundraising campaign for our campus food pantry. We raised $4,200 from 310 donors, and the most useful lesson was how much a quick personal thank-you brings people back.', evidence }], questions: [] },
      calibration: { band: 'mixed', total: 4, modelRated: true, balancedShare: 0.5, counts: { undersold: 1, balanced: 2, stretched: 1, unsupported: 0 }, claims: [
        { id: 'resume:0', rating: 'undersold', text: 'Campus Food Pantry — Ran the fall fundraising campaign, raising $4,200 from 310 donors.', reason: 'Your story says you also recruited and scheduled the volunteers; this leaves that out.', suggestion: 'Campus Food Pantry — Ran the fall fundraising campaign and its 12 volunteers, raising $4,200 from 310 donors.' },
        { id: 'resume:1', rating: 'balanced', text: 'B.A. Communications, Example University, 2027.', reason: 'Matches your resume.', suggestion: '' },
        { id: 'answer:0', rating: 'balanced', text: 'I ran the fall fundraising campaign for our campus food pantry.', reason: 'Matches your story.', suggestion: '' },
        { id: 'cover:1', rating: 'stretched', text: 'Last fall I ran the fundraising campaign for our campus food pantry, raising $4,200 from 310 donors, and personally thanked every one of them.', reason: 'Your sources say the team sent thank-you notes, not that you thanked every donor yourself.', suggestion: 'Last fall I ran the fundraising campaign for our campus food pantry, raising $4,200 from 310 donors, and made sure every donor was thanked.' },
      ] },
      review: { passed: true, issues: [] } },
    { id: 'sample-4', company: 'Riverside Public Schools', title: 'Family Engagement Assistant', location: 'Providence, RI · On-site', url: 'https://example.invalid/riverside', createdAt: earlier(16), selected: true, stage: 'submitted', status: 'Interview', submittedAt: earlier(12), description: 'Fictional sample role.',
      evaluation: { score: 4.3, recommendation: 'Apply', summary: 'A sample school role that matches your outreach and event work.', matches: [{ text: 'Reaching many families and keeping them engaged.', evidence }], gaps: [], questions: [], legitimacyNotes: ['Fictional sample.'] },
      statusHistory: [{ from: 'Evaluated', to: 'Apply', at: earlier(14) }, { from: 'Apply', to: 'Applied', at: earlier(12) }, { from: 'Applied', to: 'Interview', at: earlier(4) }],
      record: { nextAction: { text: 'Send references to the recruiter', due: shift(-1) }, interviews: [{ id: 'r1', stage: 'Panel interview', date: shift(3), status: 'scheduled', interviewer: 'Sam Rivera', preparation: 'Walk through how the pantry campaign reached new donors', notes: '' }, { id: 'r0', stage: 'Recruiter screen', date: shift(-4), status: 'completed', interviewer: 'Dana Lee', preparation: '', notes: 'Asked for two references.' }], contacts: [{ id: 'c1', name: 'Dana Lee', role: 'HR coordinator', type: 'recruiter', email: 'dana@example.invalid', addedAt: earlier(4) }] } },
    { id: 'sample-3', company: 'Greenline Outfitters', title: 'Marketing Coordinator', location: 'Denver, CO · Hybrid', url: 'https://example.invalid/greenline', createdAt: earlier(3), selected: true, stage: 'evaluated', status: 'Evaluated', description: 'Fictional sample role.',
      evaluation: { score: 4.4, recommendation: 'Apply', summary: 'A sample fit for someone who likes running campaigns and measuring what works.', matches: [{ text: 'Planned and ran a campaign with a measurable result.', evidence }], gaps: ['Paid social advertising experience is not yet documented.'], questions: [], legitimacyNotes: ['Fictional sample.'] } },
    { id: 'sample-2', company: 'Cedar Credit Union', title: 'Member Services Associate', location: 'Austin, TX · On-site', url: 'https://example.invalid/cedar', createdAt: earlier(5), selected: false, stage: 'evaluated', status: 'Evaluated', description: 'Fictional sample role.',
      evaluation: { score: 3.7, recommendation: 'Investigate', summary: 'A sample opportunity to use your people skills in a branch setting.', matches: [{ text: 'Friendly, reliable contact with hundreds of people.', evidence }], gaps: ['Cash handling experience is not documented.'], questions: ['Have you handled cash or payments at work?'], legitimacyNotes: ['Fictional sample.'] } },
    { id: 'sample-5', company: 'Brightpath Community Services', title: 'Volunteer Program Associate', location: 'Seattle, WA', url: 'https://example.invalid/brightpath', createdAt: at, selected: false, stage: 'inbox', description: '' },
  ];
  const followUps = [
    { jobId: 'sample-4', action: 'Send references to the recruiter', due: shift(-1), overdue: true, dueToday: false, last: earlier(4) },
  ];
  return {
    revision: 0, demo: true,
    profile: { name: 'Alex Morgan', email: 'alex@example.invalid', location: 'Boston, MA', graduation: 'Communications · Class of 2027', roles: 'Coordinator roles in healthcare, education, marketing or nonprofits', resume: 'Ran the fall fundraising campaign for the campus food pantry, raising $4,200 from 310 donors.', story: 'I like making sure nobody falls through the cracks. For the food pantry campaign I recruited and scheduled 12 volunteers and we wrote a thank-you note to every donor.', voice: 'Warm, clear, and specific. I prefer showing what I did over calling myself passionate.', constraints: 'Looking for an early-career role working with people, with room to learn.' },
    provider: 'codex', tasks: [{ id: 'sample-task', kind: 'evaluate', jobId: 'sample-3', status: 'complete', message: 'Finished', createdAt: earlier(3), finishedAt: earlier(3) }], sources: [{ id: 'sample-source', name: 'Harbor Health Network', url: 'https://example.invalid/careers' }],
    conversation: [
      { role: 'assistant', text: 'What’s a project you’re proud of, and what did you personally contribute?', at: earlier(6) },
      { role: 'user', text: 'The food pantry fundraiser. I planned it, recruited 12 volunteers and kept the donor list.', at: earlier(6) },
    ],
    events: [{ at, text: 'This is a fictional workspace to explore the Plainhand experience.' }, { at: earlier(3), text: 'Evaluated Greenline Outfitters — Marketing Coordinator: 4.4/5.' }],
    sourceManifest: [{ id: 'cv', characters: 1520 }, { id: 'profile', characters: 830 }],
    understanding: { approved: true, result: { summary: 'A communications graduate who organizes people well and follows through on details. Your strongest story is the food pantry campaign you planned and ran.', strengths: ['Recruiting and coordinating volunteers', 'Keeping track of many people without dropping anyone'], voice: 'Warm, specific, and quietly confident.', sampleAnswer: 'I’m proudest of the food pantry fundraiser. I planned it and ran 12 volunteers, and learned how much a quick personal thank-you brings people back.', gaps: ['Confirm work authorization before answering eligibility questions.'], questions: [] } },
    claimLineView: { decisions: 4, allowedStretches: [], strict: ['ownership'], keepUnderstated: [], wantsMore: ['results'],
      summary: ['Holds ownership (helped, built, led) to the evidence (chose the closer wording 2 of 2 times).', 'Wants results and numbers stated fully (chose to say more 2 of 2 times).'],
      statements: ['I only say I led something if I was the one making the calls.'] },
    profileStrength: {
      foundation: { level: 'good', present: 4, total: 6, missing: ['the story your resume doesn’t tell', 'a sample of how you write'] },
      depth: { level: 'thin', statements: 1, words: 16, withNumbers: 0 },
      coverage: { level: 'good', evaluated: 3, minimum: 3, average: 0.67, storyEvidenceShare: 0.25, recurringGaps: [{ text: 'No CRM or client database experience shown', roles: 2 }] },
      review: { level: 'strong', status: 'approved', built: 2, approved: 1, approvalRate: 0.5, openQuestions: 1, openQuestionsBefore: 4, firstQuestion: null },
      next: [
        { kind: 'foundation', text: 'Add the story your resume doesn’t tell and a sample of how you write.' },
        { kind: 'depth', text: 'Tell your agent about a project or job you’re proud of: what you did, how, and what came of it.' },
        { kind: 'coverage', text: '2 roles flagged: No CRM or client database experience shown. If you have related experience, tell your agent about it.' },
      ],
    },
    jobs, followUps, answerBank: [], corrections: [], audit: [], usage: null, tracker: '', loginSessions: [], localCaptchaSolver: { installed: false },
    asOf: todayISO(),
  };
}
