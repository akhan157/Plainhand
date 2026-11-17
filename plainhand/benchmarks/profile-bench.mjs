// Profile-building benchmark: a simulated candidate with hidden facts talks to the
// assistant, and the run is scored on what reached the profile and how faithfully.
// The candidate is deterministic (keyword matching, no model) so runs differ only
// by the assistant. All personas are fictional and span finance, accounting,
// technology, engineering and science, with and without professional licenses.

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
  {
    id: 'fin-analyst',
    profile: { name: 'Priya Raman', location: 'Boston, US', roles: 'Senior financial analyst, FP&A', graduation: 'B.S. Finance, 2023',
      resume: 'B.S. Finance, Example University, 2023. Financial Analyst, Example Manufacturing Corp, 2023 to 2026. Passed CFA Level I.' },
    facts: [
      { id: 'automation', keywords: ['project', 'proud', 'improve', 'change', 'built', 'result'], text: 'I rebuilt the monthly reporting pack in Power Query, which cut its preparation from 3 days to 1.', detail: 'The old pack was 14 linked workbooks pasted by hand; I replaced them with one model that pulls straight from the ledger export.' },
      { id: 'model', keywords: ['job', 'work', 'day', 'current', 'role', 'responsible'], text: 'I built and maintain the three-statement forecast model for a $240 million business unit in Excel.', detail: 'It reforecasts monthly from drivers such as units, price and headcount, so the business can see what a volume change does to cash.' },
      { id: 'mentor', keywords: ['lead', 'led', 'leadership', 'mentor', 'train', 'teach', 'people'], text: 'I trained two new analysts on the forecast model and wrote its user guide.', detail: 'Each of them rebuilt one schedule from scratch with me before touching the live model.' },
      { id: 'cert', keywords: ['certification', 'license', 'credentials', 'tools', 'skills', 'software', 'qualifications'], text: 'I passed CFA Level I in 2024 and I’m registered for Level II; I work in Excel and SQL every day.', detail: 'I use SQL to pull actuals from the data warehouse instead of waiting for exports.' },
      { id: 'goal', keywords: ['looking', 'want', 'goal', 'next', 'kind', 'roles', 'interested', 'environment'], text: 'I want a senior FP&A role where I own the forecast for a product line and work directly with the business.', detail: 'The part I like most is explaining a variance to someone who runs the operation and seeing them change a plan.' },
      { id: 'voice', keywords: ['write', 'writing', 'sound', 'voice', 'tone', 'describe yourself', 'come across'], text: 'I like it precise and plain, with the number and what it changed.', detail: 'If a sentence has no number or decision in it, I would rather cut it.' },
    ],
    absent: [{ id: 'deals', keywords: ['m&a', 'deals', 'transactions', 'investment banking'], text: 'I haven’t worked on M&A deals; my modeling is all internal planning.' }],
  },
  {
    id: 'accountant',
    profile: { name: 'Dana Whitfield', location: 'Denver, US', roles: 'Senior accountant',
      resume: 'B.S. Accounting, Example State University, 2022. Staff Accountant, Example Logistics Group, 2022 to 2026. CPA, Colorado.' },
    facts: [
      { id: 'close', keywords: ['project', 'proud', 'improve', 'change', 'result', 'biggest'], text: 'I own the month-end close for four entities and cut the close from 9 business days to 6.', detail: 'Most of the delay was intercompany entries booked late, so I moved them to a day-2 checklist and automated the eliminations.' },
      { id: 'recs', keywords: ['work', 'day', 'job', 'current', 'role', 'typical'], text: 'I prepare 45 balance sheet reconciliations each month and cleared a backlog of 120 aged reconciling items.', detail: 'Some of those items were over a year old; I traced each one to a source document and wrote off only what the controller approved.' },
      { id: 'audit', keywords: ['lead', 'responsibility', 'trust', 'audit', 'team', 'people'], text: 'I am the main contact for our external auditors and prepared the audit schedules for the last two annual audits.', detail: 'Last year the auditors had no adjusting entries on the accounts I prepared.' },
      { id: 'cert', keywords: ['certification', 'license', 'cpa', 'credentials', 'tools', 'skills', 'software', 'qualifications'], text: 'I have an active Colorado CPA license since 2025, and I work in NetSuite and Excel.', detail: 'I studied for the exam at night over 14 months and passed all four sections on the first attempt.' },
      { id: 'goal', keywords: ['looking', 'want', 'goal', 'next', 'kind', 'roles', 'interested', 'environment'], text: 'I want a senior accountant role where I review other people’s work and improve the close.', detail: 'I already review the junior accountant’s reconciliations informally and I want that to be my job.' },
      { id: 'voice', keywords: ['write', 'writing', 'sound', 'voice', 'tone', 'describe yourself', 'come across'], text: 'I like to keep it short and exact, and say what I own.', detail: 'I want it to read like a clean workpaper: what, how much, and who signed off.' },
    ],
    absent: [{ id: 'sec', keywords: ['sec', '10-k', '10-q', 'public company', 'sox'], text: 'I haven’t done SEC reporting; my company is privately held.' }],
  },
  {
    id: 'scientist',
    profile: { name: 'Lena Fischer', location: 'San Diego, US', roles: 'Scientist, cell therapy research',
      resume: 'M.S. Molecular Biology, Example University, 2021. Research Associate II, Example Biotherapeutics, 2021 to 2026.' },
    facts: [
      { id: 'assay', keywords: ['project', 'proud', 'improve', 'change', 'result', 'developed'], text: 'I developed a cell-based potency assay that cut turnaround from 5 days to 2 and is now used across three programs.', detail: 'The old assay needed a 72-hour co-culture; I switched to a reporter line with a luminescence readout and validated it against the old one on 40 samples.' },
      { id: 'screens', keywords: ['job', 'work', 'day', 'current', 'role', 'experiments'], text: 'I ran CRISPR knockout screens in primary T cells and analyzed the sequencing data in R.', detail: 'The screens covered about 2,000 guides; two of the hits became targets the team is still working on.' },
      { id: 'sops', keywords: ['lead', 'led', 'leadership', 'train', 'teach', 'people', 'mentor', 'team'], text: 'I wrote 6 SOPs for our flow cytometry workflows and trained 4 new research associates on them.', detail: 'Each new associate runs the panel beside me twice before I sign off on their gating.' },
      { id: 'pipeline', keywords: ['tools', 'software', 'skills', 'data', 'technical', 'code'], text: 'I built an R pipeline that processes plate-reader data for 30 plates a week and flags failed controls.', detail: 'Before that, each plate was analyzed by hand in a spreadsheet, about 20 minutes a plate.' },
      { id: 'goal', keywords: ['looking', 'want', 'goal', 'next', 'kind', 'roles', 'interested', 'environment'], text: 'I want a scientist role where I design the experiments, not only run them.', detail: 'On the potency assay I proposed the design myself, and that is the work I want more of.' },
      { id: 'voice', keywords: ['write', 'writing', 'sound', 'voice', 'tone', 'describe yourself', 'come across'], text: 'I like it clear and careful: the method, then the result.', detail: 'I would rather understate a result than have someone ask for data I do not have.' },
    ],
    absent: [{ id: 'gmp', keywords: ['gmp', 'manufacturing', 'clinical production'], text: 'I haven’t worked in a GMP environment; all my work is research-stage.' }],
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
// The role facts the candidate can answer from their own records: each record's title,
// with the dates their resume states for that employer's line. Only what one of those
// sources says; nothing is inferred from a job posting or a question.
function candidateRoles(persona) {
  const lines = String(persona.profile?.resume || '').split('\n').map(line => line.trim()).filter(Boolean);
  const roles = [];
  for (const record of Array.isArray(persona.records) ? persona.records : []) {
    const line = lines.find(item => item.includes(record.employer));
    if (!line) continue;
    const parts = line.split(/\s+[—–]\s+/).map(part => part.trim()).filter(Boolean);
    const dates = parts.length >= 2 && /(?:19|20)\d{2}/.test(parts.at(-1)) ? parts.at(-1) : '';
    roles.push({ employer: record.employer, title: record.title, dates });
  }
  if (roles.length) return roles;
  // A profile-bench persona has no records; a dated line of its own resume still says
  // where and when that work was, so it can be repeated as the answer.
  for (const line of lines) {
    const parts = line.split(/\s+[—–]\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 3 && /(?:19|20)\d{2}/.test(parts.at(-1)) && !/^(?:experience|education|certifications?)$/i.test(parts[0])) roles.push({ employer: parts[0], title: parts[1], dates: parts.at(-1) });
  }
  return roles;
}
// A question about where a role was, what the title was or when it ran is answered from
// the candidate's own record, once per role. "job" alone is not enough: the fixture's
// general "what did you do in your last job" question asks for work, not a heading.
const ROLE_QUESTION = /\b(?:employers?|organi[sz]ations?|job titles?|official titles?|date ranges?|dates?|start(?:ed)? and end|which role|what role)\b/i;

// The role a fact sits under in the candidate's own resume: the nearest dated role
// heading above the fact's line. A real candidate asked "which employer was this at?"
// answers for the work just described, not for whichever role comes to mind next.
function roleOfFact(persona, fact, roles) {
  const lines = String(persona.profile?.resume || '').split('\n').map(line => line.trim());
  const at = lines.findIndex(line => line && fact?.text && line.includes(fact.text.replace(/\.$/, '')));
  if (at < 0) return null;
  for (let index = at - 1; index >= 0; index--) {
    const role = roles.find(item => lines[index].startsWith(item.employer) && /(?:19|20)\d{2}/.test(lines[index]));
    if (role) return role;
    if (/^(?:experience|education|certifications?)$/i.test(lines[index])) break;
  }
  return null;
}
// "I developed a cell-based potency assay that cut ..." -> "I developed a cell-based
// potency assay": the work itself, so the answer names what it is about.
const workOf = text => String(text || '').replace(/\.$/, '').split(/,|\s+(?:that|which|so|and I)\s+/)[0].trim();
const article = title => /^[aeiou]/i.test(title) ? 'an' : 'a';

export function simulatedCandidate(persona) {
  const said = new Set(), detailed = new Set(), messages = [];
  const roles = candidateRoles(persona), saidRoles = new Set(), placedFacts = new Set();
  // A role the seeded profile already states is not the answer to "where was the
  // earlier work": the candidate first names a role the conversation has not heard.
  // The minimal seed always states the most recent role, so its employer is enough.
  const seeded = String(persona.seedProfile?.resume || [persona.employer, persona.title].filter(Boolean).join(' — '));
  let last = null, agreed = false;
  const say = (text, extra) => { messages.push(text); return { text, ...extra }; };
  return {
    messages, said, detailed,
    reply(question) {
      const asks = /\?/.test(question || '');
      const qWords = content(question);
      const overlap = last ? [...content(last.text)].filter(w => qWords.has(w)).length : 0;
      // Only the question actually asked counts: a statement earlier in the message
      // ("I haven't heard which employer this was at, so ...") is not a role question.
      const asked = String(question || '').split(/(?<=[.!])\s+/).filter(part => part.includes('?')).at(-1) || '';
      const roleQuestion = asks && ROLE_QUESTION.test(asked);
      const placed = roleQuestion && last && !placedFacts.has(last.id) ? roleOfFact(persona, last, roles) : null;
      if (placed) {
        placedFacts.add(last.id);
        saidRoles.add(`${placed.employer}|${placed.title}`);
        const dates = placed.dates ? ` (${placed.dates})` : '';
        return say(`${workOf(last.text)} at ${placed.employer} as ${article(placed.title)} ${placed.title}${dates}.`, { factId: null, role: true, onTopic: true });
      }
      const role = roleQuestion
        ? roles.find(item => !saidRoles.has(`${item.employer}|${item.title}`) && !seeded.includes(item.employer))
          || roles.find(item => !saidRoles.has(`${item.employer}|${item.title}`))
        : null;
      if (role) {
        saidRoles.add(`${role.employer}|${role.title}`);
        const dates = role.dates ? ` (${role.dates})` : '';
        return say(`My work was at ${role.employer} as ${article(role.title)} ${role.title}${dates}.`, { factId: null, role: true, onTopic: true });
      }
      if (asks && last?.detail && !detailed.has(last.id) && overlap >= 2) { detailed.add(last.id); return say(last.detail, { factId: last.id, detail: true, onTopic: true }); }
      const absent = persona.absent.find(a => !said.has(a.id) && hits(question, a.keywords));
      const open = persona.facts.filter(f => !said.has(f.id));
      // A question about certifications or licences is answered with the certification
      // the candidate holds, whatever words the persona's keywords happen to use.
      // Only a question about credentials the candidate holds ("Do you hold any
      // certifications or licences?"), never "did you need a driver's licence" or
      // "would you get a certification".
      const credentialAsked = /\b(?:hold|have|earned|held|got)\b[^?]*\b(?:certificat\w*|licen[cs]\w*|credential\w*)\b|\b(?:what|which|any)\s+(?:professional\s+)?(?:certificat\w*|licen[cs]\w*|credential\w*)\b/i.test(asked || question || '')
        && !/\bdriv\w*\s+licen/i.test(asked || question || '');
      const ranked = open.map(f => [hits(question, f.keywords) + (credentialAsked && /certif|licen/i.test(f.section || '') ? 10 : 0), f]).sort((a, b) => b[0] - a[0]);
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
