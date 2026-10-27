// Profile-building benchmark: a simulated candidate with hidden facts talks to the
// assistant, and the run is scored on what reached the profile and how faithfully.
// The candidate is deterministic (keyword matching, no model) so runs differ only
// by the assistant. All personas are fictional.

export const personas = [
  {
    id: 'mech-grad',
    profile: { name: 'Riley Chen', location: 'Boston, US', roles: 'Mechanical engineer, design engineer', graduation: 'B.S. Mechanical Engineering, 2027',
      resume: 'B.S. Mechanical Engineering, Example University, 2027. Formula SAE team member. Intern, Example Pumps (summer 2026).' },
    facts: [
      { id: 'fsae', keywords: ['project', 'proud', 'team', 'formula', 'design', 'built'], text: 'On Formula SAE I redesigned the rear upright in SolidWorks and cut its weight by 18% while passing the same load tests.', detail: 'The old upright cracked in testing, so I moved to 7075 aluminum and added ribs where the FEA showed stress; I machined two test parts myself.' },
      { id: 'intern', keywords: ['internship', 'intern', 'work', 'job', 'pumps', 'summer'], text: 'At Example Pumps I wrote a test procedure for impeller wear that the lab still uses, and I ran 40 bench tests on it.', detail: 'Wear was being judged by eye, so the procedure added a measured clearance check every 10 hours, which caught two bad batches.' },
      { id: 'lead', keywords: ['lead', 'led', 'leadership', 'manage', 'people', 'team'], text: 'I coordinated three sophomores on the suspension sub-team and ran our weekly design reviews.', detail: 'In each review someone presented a design change and the others had to find one failure mode; it stopped us shipping a bracket that would have fouled the tire.' },
      { id: 'tools', keywords: ['tools', 'software', 'cad', 'skills', 'technical', 'matlab', 'simulation'], text: 'I use SolidWorks every day, ANSYS for basic FEA, and MATLAB to process test data.', detail: 'In ANSYS I mostly do static stress checks on brackets; I check the results against hand calculations before trusting them.' },
      { id: 'goal', keywords: ['looking', 'want', 'goal', 'next', 'kind', 'roles', 'interested', 'environment'], text: 'I want a hands-on design role where I can build and test prototypes, ideally in robotics or medical devices.', detail: 'I like seeing a part go from CAD to a tested prototype within a few weeks, and I’d rather be at a bench than only at a desk.' },
      { id: 'voice', keywords: ['write', 'writing', 'sound', 'voice', 'tone', 'describe yourself', 'come across'], text: 'I like to keep things short and specific, no buzzwords.', detail: 'I write the way I talk in a design review: what the problem was, what I did, what happened.' },
    ],
    absent: [{ id: 'gdt', keywords: ['gd&t', 'tolerancing', 'production', 'manufacturing line'], text: 'I haven’t done production GD&T work, only what we covered in class.' }],
  },
  {
    id: 'career-changer',
    profile: { name: 'Sam Okafor', location: 'Chicago, US', roles: 'Data analyst, business analyst',
      resume: 'Six years as a high-school math teacher. Google Data Analytics certificate (2026). SQL, spreadsheets.' },
    facts: [
      { id: 'dashboard', keywords: ['project', 'proud', 'data', 'built', 'analysis', 'example'], text: 'I built a grade-tracking dashboard in Google Sheets and SQL that 12 teachers at my school used to spot students falling behind.', detail: 'It pulled grades from our gradebook export each week with a SQL query and flagged any student who dropped more than 10 points.' },
      { id: 'impact', keywords: ['result', 'impact', 'outcome', 'difference', 'improve', 'numbers'], text: 'After we started using it, course failure rates in ninth grade dropped from 14% to 9% over one year.', detail: 'Teachers used the flags to schedule tutoring two weeks earlier than before; I presented the results to the district data team.' },
      { id: 'teaching', keywords: ['teaching', 'teacher', 'transfer', 'skills', 'communicate', 'explain', 'background'], text: 'Teaching taught me to explain numbers to people who don’t like numbers, which I did every parent-teacher night.', detail: 'I turned the dashboard into one-page summaries per student so parents could see trends without reading a spreadsheet.' },
      { id: 'why', keywords: ['why', 'change', 'switch', 'move', 'leave', 'looking', 'goal'], text: 'I’m moving into analytics because the dashboard work was the part of my job I looked forward to most.', detail: 'I finished the certificate at night over six months while teaching full time.' },
      { id: 'tools', keywords: ['tools', 'software', 'sql', 'python', 'technical', 'skills', 'tableau'], text: 'I write SQL comfortably, I’m learning Python with pandas, and I’ve made a few Tableau Public dashboards.', detail: 'My best Tableau dashboard compares city bike-share use by weather; it has about 2,000 views.' },
    ],
    absent: [{ id: 'corporate', keywords: ['corporate', 'company', 'stakeholder', 'business experience', 'industry'], text: 'I haven’t worked in a company setting yet, only at the school.' }],
  },
  {
    id: 'quiet-junior',
    profile: { name: 'Jordan Patel', location: 'Austin, US (remote ok)', roles: 'Junior software engineer',
      resume: 'B.S. Computer Science, 2026. Personal projects in TypeScript. Teaching assistant for intro programming.' },
    facts: [
      { id: 'project', keywords: ['project', 'proud', 'built', 'app', 'side', 'code'], text: 'I built a bus-arrival app for my city in TypeScript; about 300 people used it each week last spring.', detail: 'It polls the city\'s GTFS feed every 30 seconds and caches results so it still works on bad connections.' },
      { id: 'ta', keywords: ['teaching', 'assistant', 'help', 'students', 'mentor', 'explain'], text: 'As a TA I held office hours for 60 students and wrote the debugging guide the course still hands out.', detail: 'The guide walks through reading a stack trace in five steps; the instructor said questions about crashes dropped by about half.' },
      { id: 'bug', keywords: ['problem', 'hard', 'challenge', 'difficult', 'bug', 'fix', 'debug'], text: 'The hardest bug I fixed was a timezone error that showed buses an hour late after daylight saving; I added tests for it.', detail: 'I reproduced it by faking the system clock in tests, then stored every time in UTC and converted only for display.' },
      { id: 'goal', keywords: ['looking', 'want', 'goal', 'next', 'team', 'environment', 'interested'], text: 'I want a team that does code review seriously, because that is how I learn fastest.', detail: 'On my app a stranger’s review on GitHub caught a race condition I had missed for months.' },
    ],
    absent: [{ id: 'production', keywords: ['production', 'on-call', 'scale', 'professional', 'industry', 'company'], text: 'I haven’t worked on a production system at a company yet.' }],
  },
];

const words = text => String(text || '').toLowerCase().match(/[a-z0-9%$&]+/g) || [];
const content = text => new Set(words(text).filter(w => w.length >= 4 || /\d/.test(w)));
// Keywords match at a word start, so "project" matches "projects" but "ta" never matches "that".
const hits = (question, keywords) => keywords.filter(k => new RegExp('(^|[^a-z])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(String(question || '').toLowerCase())).length;

// Answers the assistant's latest message: a follow-up about the story just told gets
// that story's detail; otherwise the best-matching fact not yet said; a question about
// something the candidate lacks gets an honest "haven't"; an offer of a next step
// without a question gets one "yes, go ahead".
export function simulatedCandidate(persona) {
  const said = new Set(), detailed = new Set(), messages = [];
  let last = null, agreed = false;
  const say = (text, extra) => { messages.push(text); return { text, ...extra }; };
  return {
    messages, said, detailed,
    reply(question) {
      const asks = /\?/.test(question || '');
      const qWords = content(question);
      const overlap = last ? [...content(last.text)].filter(w => qWords.has(w)).length : 0;
      if (asks && last?.detail && !detailed.has(last.id) && overlap >= 2) { detailed.add(last.id); return say(last.detail, { factId: last.id, detail: true, onTopic: true }); }
      const absent = persona.absent.find(a => !said.has(a.id) && hits(question, a.keywords));
      const open = persona.facts.filter(f => !said.has(f.id));
      const ranked = open.map(f => [hits(question, f.keywords), f]).sort((a, b) => b[0] - a[0]);
      const pick = absent || (ranked[0]?.[0] > 0 ? ranked[0][1] : asks ? open[0] : null);
      if (pick) { said.add(pick.id); last = persona.facts.includes(pick) ? pick : null; return say(pick.text, { factId: pick.id, onTopic: Boolean(absent || ranked[0]?.[0] > 0) }); }
      if (!agreed && !asks) { agreed = true; return say('Yes, go ahead.', { factId: null, agreed: true, onTopic: false }); }
      return say('That’s everything I can think of for now.', { factId: null, done: true, onTopic: false });
    },
  };
}

// A saved story captures a fact when most of the fact's content words are in it.
export function captured(fact, saved) {
  const need = content(fact.text);
  return saved.some(text => { const have = content(text); let n = 0; for (const w of need) if (have.has(w)) n++; return n / (need.size || 1) >= 0.6; });
}

export function scoreRun({ persona, candidateMessages, saved, updates, turns, revealed, detailsRevealed = new Set() }) {
  // A fact reaches the profile as a saved story or as a profile field update (voice, preferences).
  const kept = [...saved, ...updates.map(u => u.value)];
  const revealedFacts = persona.facts.filter(f => revealed.has(f.id));
  const detailFacts = persona.facts.filter(f => detailsRevealed?.has(f.id));
  const detailsCaptured = detailFacts.filter(f => captured({ text: f.detail }, kept)).length;
  const capturedFacts = revealedFacts.filter(f => captured(f, kept));
  const said = candidateMessages.join('\n').toLowerCase();
  const notVerbatim = saved.filter(text => !said.includes(String(text).trim().toLowerCase()));
  // An update is unsupported when under half of its content words appear in anything
  // the candidate said or already entered in their profile.
  const saidWords = content(said + '\n' + Object.values(persona.profile).join('\n'));
  const unsupportedUpdates = updates.filter(({ value }) => { const w = [...content(value)]; return w.length && w.filter(x => saidWords.has(x)).length / w.length < 0.5; });
  const absentSaved = persona.absent.filter(a => revealed.has(a.id) && saved.some(text => a.keywords.some(k => text.toLowerCase().includes(k)) && !/haven.t|not|never|only/i.test(text)));
  const questions = turns.map(t => (String(t.say || '').match(/\?/g) || []).length);
  const asked = turns.filter((t, i) => questions[i] > 0);
  return {
    persona: persona.id,
    facts: persona.facts.length, revealed: revealedFacts.length, captured: capturedFacts.length,
    captureRate: revealedFacts.length ? Math.round(capturedFacts.length / revealedFacts.length * 100) / 100 : null,
    coverageOfAllFacts: Math.round(capturedFacts.length / persona.facts.length * 100) / 100,
    followUps: detailFacts.length, detailsCaptured,
    notVerbatim: notVerbatim.length, unsupportedUpdates: unsupportedUpdates.map(u => u.field + ': ' + u.value), absentClaimsSaved: absentSaved.map(a => a.id),
    turns: turns.length, turnsAsking: asked.length, oneQuestionTurns: questions.filter(n => n === 1).length,
    onTopicQuestions: turns.filter(t => t.onTopic).length,
    failedTurns: turns.filter(t => t.status === 'failed').length,
  };
}
