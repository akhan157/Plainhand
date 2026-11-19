// Fictional candidates, jobs and portal templates for the Plainhand evaluation
// harness. Everything here is synthetic: no real employer, no personal data, no
// network destination. Ground truth lives beside each persona so a run can score
// what the app built instead of asking a model whether it did well.
import { emptyProfile } from '../store.mjs';
import { holdoutPersonas, holdoutJobs, holdoutScenarios } from './corpus-holdout.mjs';
import { holdout2Personas, holdout2Jobs, holdout2Scenarios } from './corpus-holdout-2.mjs';

export const personas = [
  {
    id: 'mech-grad',
    name: 'Riley Chen',
    employer: 'Example Pumps',
    title: 'Engineering Intern',
    dates: 'Jun 2026 to Aug 2026',
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'B.S. Mechanical Engineering, Example University, 2027',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    // Portal fields the app may legitimately ask the candidate about because the
    // candidate's sources do not settle them. Riley graduates in 2027, so whether
    // to choose "Bachelor of Science" as the highest degree before graduation is
    // the candidate's call, not a profile fact. Every other non-sensitive field is
    // owed by the app; a candidate answer to it is scored as a rescue (see
    // fieldOwner below).
    askable: ['degree'],
    profile: {
      ...emptyProfile(),
      name: 'Riley Chen',
      email: 'riley@example.invalid',
      phone: '+1 617 555 0100',
      location: 'Boston, US',
      timezone: 'America/New_York',
      roles: 'Mechanical engineer, design engineer',
      compensation: 'Open to a fair entry-level offer',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2027',
      links: 'https://example.invalid/riley',
      voice: 'Short first-person sentences. Name the work and the result. Avoid passionate, leverage and cutting-edge.',
      story: 'I am a mechanical engineering student graduating in 2027. I like hands-on design and test work.',
      resume: [
        'Riley Chen',
        'Boston, US | riley@example.invalid | +1 617 555 0100',
        '',
        'Mechanical engineering student, B.S. Mechanical Engineering, Example University, 2027 (expected). Seeking a hands-on design role in robotics.',
        'I want a hands-on design role where I can build and test prototypes, ideally in robotics or medical devices.',
        '',
        'Experience',
        'Example Pumps — Engineering Intern — Jun 2026 to Aug 2026',
        'At Example Pumps I wrote a test procedure for impeller wear that the lab still uses, and I ran 40 bench tests on it.',
        'I checked the clearance of each pump every 10 hours with a gauge, which caught two bad batches before they shipped.',
        '',
        'Projects',
        'Formula SAE — Suspension sub-team — 2024 to 2026',
        'On Formula SAE I redesigned the rear upright in SolidWorks and cut its weight by 18% while passing the same load tests.',
        'I coordinated three sophomores on the suspension sub-team and ran our weekly design reviews.',
        '',
        'Skills',
        'I use SolidWorks every day, ANSYS for basic FEA, and MATLAB to process test data.',
      ].join('\n'),
    },
    facts: [
      { id: 'fsae', section: 'Projects', keywords: ['formula', 'sae', 'upright', 'design'], text: 'On Formula SAE I redesigned the rear upright in SolidWorks and cut its weight by 18% while passing the same load tests.' },
      { id: 'pumps', atEmployer: true, keywords: ['pumps', 'intern', 'test', 'procedure'], text: 'At Example Pumps I wrote a test procedure for impeller wear that the lab still uses, and I ran 40 bench tests on it.' },
      { id: 'lead', keywords: ['coordinated', 'team', 'sophomores', 'reviews'], text: 'I coordinated three sophomores on the suspension sub-team and ran our weekly design reviews.' },
      { id: 'tools', section: 'Skills', keywords: ['solidworks', 'ansys', 'matlab', 'skills'], text: 'I use SolidWorks every day, ANSYS for basic FEA, and MATLAB to process test data.' },
      { id: 'goal', keywords: ['hands-on', 'design', 'prototype', 'robotics'], text: 'I want a hands-on design role where I can build and test prototypes, ideally in robotics or medical devices.' },
    ],
    absent: [{ id: 'production-gdt', keywords: ['production gd&t', 'gd&t work', 'gd&t experience', 'production tolerancing', 'production line'], text: "I haven't done production GD&T work, only what we covered in class." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: true,
  },
  {
    id: 'career-changer',
    name: 'Sam Okafor',
    employer: 'Example High School',
    title: 'Mathematics Teacher',
    dates: '2020 to 2026',
    level: 'professional',
    degree: 'bachelor-arts',
    degreeLabel: 'Bachelor of Arts',
    educationEvidence: 'Example University — Bachelor of Arts, Mathematics — 2019',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Sam Okafor',
      email: 'sam@example.invalid',
      phone: '+1 312 555 0102',
      location: 'Chicago, US',
      timezone: 'America/Chicago',
      roles: 'Data analyst, business analyst',
      compensation: 'Target range: $70,000 to $85,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2019',
      links: 'https://example.invalid/sam',
      voice: 'Warm, plainspoken first-person writing. Name the work and the result. Avoid passionate, leverage and cutting-edge.',
      story: 'I taught mathematics for six years and am moving into data analysis.',
      resume: [
        'Sam Okafor',
        'Chicago, US | sam@example.invalid | +1 312 555 0102',
        '',
        'Data analyst moving from teaching. Google Data Analytics certificate, 2026.',
        'I explain data findings to colleagues and parents in plain language.',
        '',
        'Experience',
        'Example High School — Mathematics Teacher — 2020 to 2026',
        'I taught algebra and statistics to 150 students a year and built the department grade tracker in Google Sheets.',
        'I built a grade-tracking dashboard in Google Sheets and SQL that 12 teachers at my school used to spot students falling behind.',
        'After we started using it, course failure rates in ninth grade dropped from 14% to 9% over one year.',
        '',
        'Projects',
        'City Bike Share Dashboard — 2025',
        'I built a Tableau dashboard from public bike-share data that compared ridership by weather and season.',
        'I write SQL comfortably and use spreadsheets for analysis; I am learning Python with pandas.',
        '',
        'Education',
        'Example University — Bachelor of Arts, Mathematics — 2019',
        'Google Data Analytics Certificate — 2026',
      ].join('\n'),
    },
    facts: [
      { id: 'teaching', keywords: ['taught', 'teacher', 'students', 'statistics'], text: 'I taught algebra and statistics to 150 students a year and built the department grade tracker in Google Sheets.' },
      { id: 'dashboard', section: 'Projects', keywords: ['dashboard', 'tableau', 'bike', 'weather'], text: 'I built a Tableau dashboard from public bike-share data that compared ridership by weather and season.' },
      { id: 'grade-tracker', keywords: ['grade', 'sheets', 'sql', 'teachers'], text: 'I built a grade-tracking dashboard in Google Sheets and SQL that 12 teachers at my school used to spot students falling behind.' },
      { id: 'impact', keywords: ['result', 'impact', 'outcome', 'failure', 'improve'], text: 'After we started using it, course failure rates in ninth grade dropped from 14% to 9% over one year.' },
      { id: 'sql', section: 'Skills', keywords: ['sql', 'python', 'spreadsheet', 'analysis'], text: 'I write SQL comfortably and use spreadsheets for analysis; I am learning Python with pandas.' },
      { id: 'explain', keywords: ['explain', 'findings', 'plain', 'stakeholders'], text: 'I explain data findings to colleagues and parents in plain language.' },
    ],
    absent: [{ id: 'corporate', keywords: ['corporate', 'business experience', 'industry experience', 'company setting', 'worked at a company'], text: "I haven't worked in a company setting yet, only at the school." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: true,
  },
  {
    id: 'junior-swe',
    aliases: ['quiet-junior'],
    name: 'Jordan Patel',
    employer: 'Example University',
    title: 'Teaching Assistant',
    dates: '2025 to 2025',
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'B.S. Computer Science, Example University, 2026',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Jordan Patel',
      email: 'jordan@example.invalid',
      phone: '+1 512 555 0103',
      location: 'Austin, US (remote ok)',
      timezone: 'America/Chicago',
      roles: 'Junior software engineer',
      compensation: 'Target range: $90,000 to $110,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2026',
      links: 'https://example.invalid/jordan',
      voice: 'Plain, specific first-person writing. Lead with what the code does. Avoid passionate, leverage and cutting-edge.',
      story: 'I am a computer science graduate looking for a first software engineering role.',
      resume: [
        'Jordan Patel',
        'Austin, US (remote ok) | jordan@example.invalid | +1 512 555 0103',
        '',
        'Junior software engineer. B.S. Computer Science, Example University, 2026.',
        'I want a team that does code review seriously, because that is how I learn fastest.',
        '',
        'Projects',
        'Bus Arrival App — 2025 to 2026',
        'I built a bus-arrival app for my city in TypeScript; about 300 people used it each week last spring.',
        "It polls the city's GTFS feed every 30 seconds and caches results so it still works on bad connections.",
        'I added tests for a daylight-saving timezone bug that showed buses an hour late.',
        '',
        'Experience',
        'Example University — Teaching Assistant, Intro Programming — 2025 to 2025',
        'As a TA I held office hours for 60 students and wrote the debugging guide the course still hands out.',
        '',
        'Skills',
        'TypeScript, Node.js, Git, code review.',
      ].join('\n'),
    },
    facts: [
      { id: 'app', section: 'Projects', keywords: ['bus', 'app', 'typescript', 'users'], text: 'I built a bus-arrival app for my city in TypeScript; about 300 people used it each week last spring.' },
      { id: 'cache', keywords: ['polls', 'gtfs', 'caches', 'connections'], text: "It polls the city's GTFS feed every 30 seconds and caches results so it still works on bad connections." },
      { id: 'tests', keywords: ['tests', 'timezone', 'bug', 'daylight'], text: 'I added tests for a daylight-saving timezone bug that showed buses an hour late.' },
      { id: 'ta', atEmployer: true, keywords: ['ta', 'office hours', 'students', 'guide'], text: 'As a TA I held office hours for 60 students and wrote the debugging guide the course still hands out.' },
      { id: 'review', keywords: ['code review', 'team', 'learn'], text: 'I want a team that does code review seriously, because that is how I learn fastest.' },
    ],
    absent: [{ id: 'production', keywords: ['production system', 'production experience', 'production code at', 'on-call experience', 'carried a pager', 'at scale', 'professional company'], text: "I haven't worked on a production system at a company yet." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: true,
  },
  {
    id: 'ops-lead',
    name: 'Morgan Lee',
    employer: 'Synthetic Logistics',
    title: 'Operations Manager',
    dates: '2018 to 2026',
    records: [{ employer: 'Synthetic Logistics', title: 'Operations Manager' }, { employer: 'Example Services', title: 'Team Lead' }],
    level: 'professional',
    degree: 'mba',
    degreeLabel: 'Master of Business Administration',
    educationEvidence: 'Example Institute — Master of Business Administration — 2020',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Morgan Lee',
      email: 'morgan@example.invalid',
      phone: '+1 312 555 0104',
      location: 'Chicago, US',
      timezone: 'America/Chicago',
      roles: 'Operations manager',
      compensation: 'Target range: $110,000 to $130,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2020',
      links: 'https://example.invalid/morgan',
      voice: 'Direct, factual first-person writing. Name the work and the result. Avoid passionate, leverage and cutting-edge.',
      story: 'I manage logistics operations and care about schedules that hold under pressure.',
      resume: [
        'Morgan Lee',
        'Chicago, US | morgan@example.invalid | +1 312 555 0104',
        '',
        'Operations manager with eight years in logistics. Example Institute — Master of Business Administration — 2020.',
        '',
        'Experience',
        'Synthetic Logistics — Operations Manager — 2022 to 2026',
        'I redesigned the Beacon scheduling process at Synthetic Logistics; it cut overtime by 22% and kept the same delivery window.',
        'I managed a team of 12 dispatchers and ran the weekly review with vendors.',
        'I negotiated two vendor contracts and brought annual cost down by $140,000.',
        'Example Services — Team Lead — 2018 to 2022',
        'I led a small dispatch team and covered the night shift during the 2020 peak.',
        '',
        'Education',
        'Example Institute — Master of Business Administration — 2020',
        'Example University — Bachelor of Arts — 2018',
      ].join('\n'),
    },
    facts: [
      { id: 'scheduling', section: 'Projects', keywords: ['redesigned', 'beacon', 'scheduling', 'overtime'], text: 'I redesigned the Beacon scheduling process at Synthetic Logistics; it cut overtime by 22% and kept the same delivery window.' },
      { id: 'team', keywords: ['managed', 'team', 'dispatchers', 'review'], text: 'I managed a team of 12 dispatchers and ran the weekly review with vendors.' },
      { id: 'vendor', keywords: ['vendor', 'contracts', 'cost', 'negotiated'], text: 'I negotiated two vendor contracts and brought annual cost down by $140,000.' },
    ],
    absent: [{ id: 'pnl', keywords: ['p&l', 'profit and loss', 'budget ownership'], text: "I haven't owned a P&L; I managed a cost line inside a larger budget." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'designer',
    name: 'Avery Quinn',
    employer: 'Example Studio',
    title: 'Product Designer',
    dates: '2021 to 2026',
    level: 'professional',
    degree: 'bachelor-arts',
    degreeLabel: 'Bachelor of Arts',
    educationEvidence: 'Example University — Bachelor of Arts, Design — 2021',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    // What the candidate says when the app asks a role question it cannot settle from sources.
    roleAnswers: 'Yes, https://example.invalid/avery is my portfolio. It shows the Atlas design system and the research-to-prototype work.',
    profile: {
      ...emptyProfile(),
      name: 'Avery Quinn',
      email: 'avery@example.invalid',
      phone: '+1 206 555 0105',
      location: 'Seattle, US',
      timezone: 'America/Los_Angeles',
      roles: 'Product designer',
      compensation: 'Target range: $105,000 to $125,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2021',
      links: 'https://example.invalid/avery',
      voice: 'Clear first-person writing about the work and the user problem. Avoid passionate, leverage and cutting-edge.',
      story: 'I design product interfaces and care about research and reusable components.',
      resume: [
        'Avery Quinn',
        'Seattle, US | avery@example.invalid | +1 206 555 0105',
        '',
        'Product designer focused on research and design systems. Example University — Bachelor of Arts, Design — 2021.',
        '',
        'Experience',
        'Example Studio — Product Designer — 2021 to 2026',
        'I built the Atlas design system in Figma and documented 40 components used by three product teams.',
        'I ran 24 user interviews and turned the findings into a prototype that tested 30% faster for new users.',
        'I paired with engineers to ship the first release and wrote the accessibility notes.',
        '',
        'Education',
        'Example University — Bachelor of Arts, Design — 2021',
      ].join('\n'),
    },
    facts: [
      { id: 'design-system', section: 'Projects', keywords: ['atlas', 'design system', 'figma', 'components'], text: 'I built the Atlas design system in Figma and documented 40 components used by three product teams.' },
      { id: 'research', keywords: ['interviews', 'research', 'findings', 'users'], text: 'I ran 24 user interviews and turned the findings into a prototype that tested 30% faster for new users.' },
      { id: 'prototype', keywords: ['prototype', 'engineers', 'release', 'accessibility'], text: 'I paired with engineers to ship the first release and wrote the accessibility notes.' },
    ],
    absent: [{ id: 'management', keywords: ['managed designers', 'people manager', 'direct reports'], text: "I haven't managed designers directly." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'returning',
    name: 'Casey Brooks',
    employer: 'Synthetic Media',
    title: 'Content Strategist',
    dates: '2021 to 2024',
    level: 'professional',
    degree: 'bachelor-arts',
    degreeLabel: 'Bachelor of Arts',
    educationEvidence: 'Example University — Bachelor of Arts, English — 2017',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Casey Brooks',
      email: 'casey@example.invalid',
      phone: '+1 206 555 0106',
      location: 'Seattle, US',
      timezone: 'America/Los_Angeles',
      roles: 'Content strategist',
      compensation: 'Target range: $85,000 to $100,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2017',
      links: 'https://example.invalid/casey',
      voice: 'Calm, direct first-person writing. Use concrete details and no superlatives. Avoid passionate, leverage and cutting-edge.',
      story: 'I am returning to content strategy after a family caregiving break.',
      resume: [
        'Casey Brooks',
        'Seattle, US | casey@example.invalid | +1 206 555 0106',
        '',
        'Content strategist returning after family caregiving. Example University — Bachelor of Arts, English — 2017.',
        '',
        'Experience',
        'Synthetic Media — Content Strategist — 2021 to 2024',
        'I created the Cedar editorial guide and used it to rewrite 60 help articles.',
        'I planned a launch campaign across email and social that brought 4,000 new readers.',
        'I tracked article analytics in a spreadsheet and used the results to choose the next topics.',
        '',
        'Career break',
        'Family caregiving, 2024 to 2026.',
        '',
        'Education',
        'Example University — Bachelor of Arts, English — 2017',
      ].join('\n'),
    },
    facts: [
      { id: 'editorial', section: 'Projects', keywords: ['cedar', 'editorial', 'guide', 'articles'], text: 'I created the Cedar editorial guide and used it to rewrite 60 help articles.' },
      { id: 'campaign', keywords: ['campaign', 'email', 'social', 'readers'], text: 'I planned a launch campaign across email and social that brought 4,000 new readers.' },
      { id: 'analytics', keywords: ['analytics', 'spreadsheet', 'results', 'topics'], text: 'I tracked article analytics in a spreadsheet and used the results to choose the next topics.' },
    ],
    absent: [{ id: 'seo', keywords: ['technical seo', 'schema markup', 'crawl'], text: "I haven't done technical SEO work." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'fin-analyst',
    name: 'Priya Raman',
    employer: 'Example Manufacturing Corp',
    title: 'Financial Analyst',
    dates: '2023 to 2026',
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'Example University — Bachelor of Science, Finance — 2023',
    // Corporate portals ask for certifications and years in the field; both are
    // settled by the sources, so the app owes them. Age is the candidate's.
    credentialFact: 'cert',
    experienceBand: '3-5',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion', age18: 'yes' },
    profile: {
      ...emptyProfile(),
      name: 'Priya Raman',
      email: 'priya@example.invalid',
      phone: '+1 617 555 0107',
      location: 'Boston, US',
      timezone: 'America/New_York',
      roles: 'Senior financial analyst, FP&A',
      compensation: 'Target range: $95,000 to $110,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2023',
      links: 'https://example.invalid/priya',
      voice: 'Precise, plain first-person writing. Name the model or report and what it changed. Avoid passionate, leverage and cutting-edge.',
      story: 'I am a financial analyst with three years in corporate planning, looking for a senior FP&A role.',
      resume: [
        'Priya Raman',
        'Boston, US | priya@example.invalid | +1 617 555 0107',
        '',
        'Financial analyst with three years in corporate planning and forecasting.',
        '',
        'Experience',
        'Example Manufacturing Corp — Financial Analyst — 2023 to 2026',
        'I built and maintain the three-statement forecast model for a $240 million business unit in Excel.',
        'I run the monthly budget-versus-actual variance review and present the drivers to the finance director.',
        'I rebuilt the monthly reporting pack in Power Query, which cut its preparation from 3 days to 1.',
        'I trained two new analysts on the forecast model and wrote its user guide.',
        '',
        'Certifications',
        'Passed CFA Level I in 2024; registered for Level II. Advanced Excel and SQL.',
        '',
        'Education',
        'Example University — Bachelor of Science, Finance — 2023',
      ].join('\n'),
    },
    facts: [
      { id: 'model', atEmployer: true, keywords: ['forecast', 'model', 'excel', 'business unit'], text: 'I built and maintain the three-statement forecast model for a $240 million business unit in Excel.' },
      { id: 'variance', keywords: ['variance', 'budget', 'review', 'director'], text: 'I run the monthly budget-versus-actual variance review and present the drivers to the finance director.' },
      { id: 'cert', section: 'Certifications', keywords: ['cfa', 'certification', 'excel', 'sql'], text: 'Passed CFA Level I in 2024; registered for Level II. Advanced Excel and SQL.' },
      { id: 'automation', keywords: ['reporting', 'power query', 'pack', 'automated'], text: 'I rebuilt the monthly reporting pack in Power Query, which cut its preparation from 3 days to 1.' },
      { id: 'mentor', keywords: ['trained', 'analysts', 'guide', 'mentor'], text: 'I trained two new analysts on the forecast model and wrote its user guide.' },
    ],
    absent: [{ id: 'deals', keywords: ['m&a experience', 'deal experience', 'investment banking experience', 'worked on transactions', 'sell-side'], text: "I haven't worked on M&A deals; my modeling is all internal planning." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'accountant',
    name: 'Dana Whitfield',
    employer: 'Example Logistics Group',
    title: 'Staff Accountant',
    dates: '2022 to 2026',
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'Example State University — Bachelor of Science, Accounting — 2022',
    credentialFact: 'cert',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion', age18: 'yes' },
    profile: {
      ...emptyProfile(),
      name: 'Dana Whitfield',
      email: 'dana@example.invalid',
      phone: '+1 720 555 0108',
      location: 'Denver, US',
      timezone: 'America/Denver',
      roles: 'Senior accountant',
      compensation: 'Target range: $85,000 to $98,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2022',
      links: '',
      voice: 'Short, exact first-person sentences. Say what I own and the result. Avoid passionate, leverage and cutting-edge.',
      story: 'I am a staff accountant and CPA with four years in general ledger accounting, ready for a senior accountant role.',
      resume: [
        'Dana Whitfield',
        'Denver, US | dana@example.invalid | +1 720 555 0108',
        '',
        'Staff accountant and CPA with four years of general ledger and close experience.',
        '',
        'Licenses & Certifications',
        'CPA license, State of Colorado, active since 2025.',
        '',
        'Experience',
        'Example Logistics Group — Staff Accountant — 2022 to 2026',
        'I own the month-end close for four entities and cut the close from 9 business days to 6.',
        'I prepare 45 balance sheet reconciliations each month and cleared a backlog of 120 aged reconciling items.',
        'I am the main contact for our external auditors and prepared the audit schedules for the last two annual audits.',
        'I helped migrate the general ledger from QuickBooks to NetSuite and mapped the new chart of accounts.',
        '',
        'Education',
        'Example State University — Bachelor of Science, Accounting — 2022',
      ].join('\n'),
    },
    facts: [
      { id: 'close', atEmployer: true, keywords: ['close', 'month-end', 'entities', 'days'], text: 'I own the month-end close for four entities and cut the close from 9 business days to 6.' },
      { id: 'recs', keywords: ['reconciliations', 'balance sheet', 'backlog', 'items'], text: 'I prepare 45 balance sheet reconciliations each month and cleared a backlog of 120 aged reconciling items.' },
      { id: 'cert', section: 'Licenses & Certifications', keywords: ['cpa', 'license', 'certified', 'colorado'], text: 'CPA license, State of Colorado, active since 2025.' },
      { id: 'audit', keywords: ['auditors', 'audit', 'schedules', 'contact'], text: 'I am the main contact for our external auditors and prepared the audit schedules for the last two annual audits.' },
      { id: 'erp', keywords: ['netsuite', 'quickbooks', 'ledger', 'migrate'], text: 'I helped migrate the general ledger from QuickBooks to NetSuite and mapped the new chart of accounts.' },
    ],
    absent: [{ id: 'sec', keywords: ['sec reporting experience', '10-k', '10-q', 'public company reporting', 'sox compliance experience'], text: "I haven't done SEC reporting; my company is privately held." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'scientist',
    name: 'Lena Fischer',
    employer: 'Example Biotherapeutics',
    title: 'Research Associate II',
    dates: '2021 to 2026',
    level: 'professional',
    degree: 'master-science',
    degreeLabel: 'Master of Science',
    educationEvidence: 'Example University — Master of Science, Molecular Biology — 2021',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Lena Fischer',
      email: 'lena@example.invalid',
      phone: '+1 858 555 0109',
      location: 'San Diego, US',
      timezone: 'America/Los_Angeles',
      roles: 'Scientist, cell therapy research',
      compensation: 'Target range: $105,000 to $120,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2021',
      links: 'https://example.invalid/lena',
      voice: 'Clear, careful first-person writing. State the method and the result. Avoid passionate, leverage and cutting-edge.',
      story: 'I am a research associate with five years in cell therapy discovery, looking for a scientist role.',
      resume: [
        'Lena Fischer',
        'San Diego, US | lena@example.invalid | +1 858 555 0109',
        '',
        'Research associate with five years in cell therapy discovery research.',
        '',
        'Experience',
        'Example Biotherapeutics — Research Associate II — 2021 to 2026',
        'I developed a cell-based potency assay that cut turnaround from 5 days to 2 and is now used across three programs.',
        'I ran CRISPR knockout screens in primary T cells and analyzed the sequencing data in R.',
        'I wrote 6 SOPs for our flow cytometry workflows and trained 4 new research associates on them.',
        'I built an R pipeline that processes plate-reader data for 30 plates a week and flags failed controls.',
        '',
        'Publications',
        'I am a co-author on two peer-reviewed papers from this work, published in 2023 and 2025.',
        '',
        'Education',
        'Example University — Master of Science, Molecular Biology — 2021',
      ].join('\n'),
    },
    facts: [
      { id: 'assay', atEmployer: true, keywords: ['assay', 'potency', 'turnaround', 'programs'], text: 'I developed a cell-based potency assay that cut turnaround from 5 days to 2 and is now used across three programs.' },
      { id: 'screens', keywords: ['crispr', 'screens', 't cells', 'sequencing'], text: 'I ran CRISPR knockout screens in primary T cells and analyzed the sequencing data in R.' },
      { id: 'sops', keywords: ['sops', 'flow cytometry', 'trained', 'associates'], text: 'I wrote 6 SOPs for our flow cytometry workflows and trained 4 new research associates on them.' },
      { id: 'pipeline', keywords: ['pipeline', 'plate-reader', 'plates', 'controls'], text: 'I built an R pipeline that processes plate-reader data for 30 plates a week and flags failed controls.' },
      { id: 'papers', section: 'Publications', keywords: ['papers', 'publications', 'co-author', 'peer-reviewed'], text: 'I am a co-author on two peer-reviewed papers from this work, published in 2023 and 2025.' },
    ],
    absent: [{ id: 'gmp', keywords: ['gmp experience', 'gmp manufacturing', 'worked in a gmp', 'cgmp environment', 'gmp environment'], text: "I haven't worked in a GMP environment; all my work is research-stage." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'eng-manager',
    name: 'Tomas Rivera',
    employer: 'Example Payments',
    title: 'Engineering Manager',
    dates: '2020 to 2026',
    records: [{ employer: 'Example Payments', title: 'Engineering Manager' }, { employer: 'Example Cloud', title: 'Senior Software Engineer' }],
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'Example University — Bachelor of Science, Computer Science — 2014',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Tomas Rivera',
      email: 'tomas@example.invalid',
      phone: '+1 512 555 0111',
      location: 'Austin, US',
      timezone: 'America/Chicago',
      roles: 'Director of engineering, senior engineering manager',
      compensation: 'Target range: $230,000 to $260,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2014',
      links: 'https://example.invalid/tomas',
      voice: 'Direct, concrete first-person writing. Lead with the result and credit the team. Avoid passionate, leverage and cutting-edge.',
      story: 'I have built and led payments engineering teams for six years after six years as an engineer, and I want to lead a larger organization.',
      resume: [
        'Tomas Rivera',
        'Austin, US | tomas@example.invalid | +1 512 555 0111',
        '',
        'Engineering manager with twelve years in software, six of them leading payments platform teams.',
        '',
        'Experience',
        'Example Payments — Engineering Manager — 2020 to 2026',
        'I manage 14 engineers across two teams that run the card-authorization platform.',
        'My teams cut p99 authorization latency from 420 ms to 180 ms while traffic doubled.',
        'I hired 9 engineers in two years and promoted three to senior.',
        'I introduced a blameless incident review process, and repeat incidents fell from 11 to 3 in a year.',
        'Example Cloud — Senior Software Engineer — 2014 to 2020',
        'I designed and built the tokenization service that still handles every card stored on the platform.',
        '',
        'Education',
        'Example University — Bachelor of Science, Computer Science — 2014',
      ].join('\n'),
    },
    facts: [
      { id: 'team', atEmployer: true, keywords: ['manage', 'engineers', 'teams', 'platform'], text: 'I manage 14 engineers across two teams that run the card-authorization platform.' },
      { id: 'latency', keywords: ['latency', 'p99', 'traffic', 'performance'], text: 'My teams cut p99 authorization latency from 420 ms to 180 ms while traffic doubled.' },
      { id: 'hiring', keywords: ['hired', 'hiring', 'promoted', 'senior'], text: 'I hired 9 engineers in two years and promoted three to senior.' },
      { id: 'incidents', keywords: ['incident', 'review', 'blameless', 'reliability'], text: 'I introduced a blameless incident review process, and repeat incidents fell from 11 to 3 in a year.' },
      { id: 'tokenization', keywords: ['tokenization', 'designed', 'built', 'service'], text: 'I designed and built the tokenization service that still handles every card stored on the platform.' },
    ],
    absent: [{ id: 'managers', keywords: ['managed managers', 'manager of managers', 'led other managers', 'managing managers'], text: "I haven't managed managers yet; my reports are all individual engineers." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
];

// Minimal starting profile for connected journey runs: identity and evidence are
// seeded, while voice and story are built from the conversation rather than
// assumed from the finished persona.
export const seedProfileFor = persona => ({
  ...emptyProfile(),
  name: persona.profile.name,
  email: persona.profile.email,
  phone: persona.profile.phone,
  location: persona.profile.location,
  timezone: persona.profile.timezone,
  roles: persona.profile.roles,
  compensation: persona.profile.compensation,
  eligibility: persona.profile.eligibility,
  graduation: persona.profile.graduation,
  links: persona.profile.links,
  voice: '',
  story: '',
  resume: `${persona.educationEvidence}. ${persona.employer} — ${persona.title} — ${persona.dates}.`,
});
for (const persona of personas) persona.seedProfile = seedProfileFor(persona);

export const jobs = [
  {
    id: 'grad-mech',
    company: 'Fictional Robotics Co',
    title: 'Junior Mechanical Design Engineer',
    location: 'Boston, US',
    requiredFactIds: ['fsae', 'pumps', 'tools'],
    atsTerms: ['SolidWorks', 'ANSYS', 'FEA', 'prototyping', 'test'],
    description: 'Fictional Robotics Co seeks a junior mechanical design engineer in Boston. Design and test mechanical assemblies for mobile robots. SolidWorks, FEA and prototyping are central. Write test plans, build prototypes with technicians, and explain design tradeoffs. GD&T for production parts is a plus but not required.',
  },
  {
    id: 'data-analyst',
    company: 'Fictional Health Analytics',
    title: 'Data Analyst',
    location: 'Chicago, US',
    requiredFactIds: ['dashboard', 'sql', 'teaching'],
    atsTerms: ['SQL', 'Tableau', 'dashboards', 'stakeholders', 'Python'],
    description: 'Fictional Health Analytics seeks a data analyst in Chicago. Build dashboards and reports in SQL and Tableau for operations teams. Explain findings to non-technical stakeholders. Python is a plus. Two years of business analytics experience preferred, but a strong portfolio is considered.',
  },
  {
    id: 'junior-swe',
    company: 'Fictional Transit Software',
    title: 'Junior Software Engineer',
    location: 'Austin, US',
    requiredFactIds: ['app', 'tests', 'ta'],
    atsTerms: ['TypeScript', 'tests', 'code review', 'on-call', 'Node.js'],
    description: 'Fictional Transit Software seeks a junior software engineer in Austin. Build TypeScript services and web apps for transit riders. Write tests, take part in code review, and join an on-call rotation after onboarding. Experience with a real user-facing app is valuable.',
  },
  {
    id: 'ops-manager',
    company: 'Fictional Logistics',
    title: 'Operations Manager',
    location: 'Chicago, US',
    requiredFactIds: ['scheduling', 'team', 'vendor'],
    atsTerms: ['scheduling', 'vendors', 'cost', 'team', 'delivery'],
    description: 'Fictional Logistics seeks an operations manager in Chicago. Own daily scheduling, manage a dispatch team, negotiate vendor contracts and keep delivery windows. Report cost and overtime results. Experience with a recurring scheduling process is required.',
  },
  {
    id: 'product-designer',
    company: 'Fictional Design Studio',
    title: 'Product Designer',
    location: 'Seattle, US',
    requiredFactIds: ['design-system', 'research', 'prototype'],
    atsTerms: ['design system', 'research', 'prototyping', 'Figma', 'accessibility'],
    description: 'Fictional Design Studio seeks a product designer in Seattle. Build and document a design system in Figma, run user research, and turn findings into prototypes. Pair with engineers to ship accessible interfaces. Portfolio required.',
  },
  {
    id: 'content-strategist',
    company: 'Fictional Media',
    title: 'Content Strategist',
    location: 'Seattle, US',
    requiredFactIds: ['editorial', 'campaign', 'analytics'],
    atsTerms: ['editorial', 'campaigns', 'analytics', 'style guide', 'help articles'],
    description: 'Fictional Media seeks a content strategist in Seattle. Maintain an editorial guide, plan launch campaigns across email and social, and use article analytics to choose topics. Write and rewrite help content. A career break is not a barrier.',
  },
  {
    id: 'mech-mismatch-job',
    company: 'Fictional Cloud Core',
    title: 'Principal Distributed Storage Architect',
    location: 'Boston, US',
    requiredFactIds: ['fsae'],
    atsTerms: ['Kubernetes', 'Raft', 'Go'],
    expectRecommendation: 'Skip',
    maxScore: 3.5,
    description: 'Fictional Cloud Core seeks a principal distributed storage architect with 10+ years operating multi-region consensus engines, kernel bypass networking, and petabyte-scale object storage in Go and Rust.',
  },
  {
    id: 'fpa-analyst',
    company: 'Fictional Devices Inc',
    title: 'Senior Financial Analyst, FP&A',
    location: 'Boston, US',
    requiredFactIds: ['model', 'variance', 'cert'],
    atsTerms: ['forecast', 'variance', 'Excel', 'SQL', 'FP&A'],
    description: 'Fictional Devices Inc seeks a senior financial analyst for its FP&A team in Boston. Own the forecast model for a product line, run monthly variance analysis against budget, and present drivers to business leaders. Advanced Excel required; SQL and progress toward the CFA are valued. Three or more years of corporate finance experience.',
  },
  {
    id: 'senior-accountant',
    company: 'Fictional Software Co',
    title: 'Senior Accountant',
    location: 'Denver, US',
    requiredFactIds: ['close', 'recs', 'cert'],
    atsTerms: ['month-end close', 'reconciliations', 'NetSuite', 'audit', 'CPA'],
    description: 'Fictional Software Co, a privately held company, seeks a senior accountant in Denver. Lead the month-end close, prepare and review balance sheet reconciliations, support the annual audit, and help improve the NetSuite general ledger. An active CPA license is required.',
  },
  {
    id: 'scientist-i',
    company: 'Fictional Therapeutics',
    title: 'Scientist I, Cell Therapy Discovery',
    location: 'San Diego, US',
    requiredFactIds: ['assay', 'screens', 'sops'],
    atsTerms: ['potency assay', 'CRISPR', 'flow cytometry', 'primary T cells', 'SOPs'],
    description: 'Fictional Therapeutics seeks a Scientist I for cell therapy discovery research in San Diego. Develop cell-based assays including potency assays, run CRISPR screens in primary T cells, analyze flow cytometry and sequencing data, and write SOPs for the team. A master\'s degree with five years of research experience, or a PhD, is required.',
  },
  {
    id: 'director-engineering',
    company: 'Fictional Fintech',
    title: 'Director of Engineering, Payments Platform',
    location: 'Austin, US',
    requiredFactIds: ['team', 'latency', 'hiring'],
    atsTerms: ['latency', 'reliability', 'hiring', 'incident', 'platform'],
    description: 'Fictional Fintech seeks a director of engineering for its payments platform in Austin. Lead three teams of about 25 engineers, own platform reliability and latency, run hiring and career growth, and improve the incident process. Ten or more years in software with experience leading several teams.',
  },
  {
    id: 'fin-mismatch-job',
    company: 'Fictional Bridge Engineering',
    title: 'Senior Structural Engineer (PE)',
    location: 'Boston, US',
    requiredFactIds: ['model'],
    atsTerms: ['PE license', 'structural analysis', 'steel design'],
    expectRecommendation: 'Skip',
    maxScore: 3.5,
    description: 'Fictional Bridge Engineering seeks a senior structural engineer with a Professional Engineer license and 10+ years designing steel and concrete highway bridges, including load rating and structural analysis software.',
  },
  // Same candidates, jobs that need a different part of their experience first.
  {
    id: 'finance-systems',
    company: 'Fictional Consumer Brands',
    title: 'Finance Systems Analyst',
    location: 'Boston, US',
    requiredFactIds: ['automation', 'mentor', 'model'],
    atsTerms: ['Power Query', 'reporting', 'automation', 'training', 'Excel'],
    description: 'Fictional Consumer Brands seeks a finance systems analyst in Boston for its finance transformation team. Automate recurring reporting packs with Power Query, document finance models and write user guides, and train analysts on new tools. Hands-on experience maintaining a forecast model is expected.',
  },
  {
    id: 'bioinformatics-associate',
    company: 'Fictional Genomics',
    title: 'Senior Research Associate, Data and Automation',
    location: 'San Diego, US',
    requiredFactIds: ['pipeline', 'sops', 'screens'],
    atsTerms: ['pipeline', 'sequencing', 'SOPs', 'plate-reader', 'CRISPR'],
    description: 'Fictional Genomics seeks a senior research associate for its data and automation group in San Diego. Build and maintain R pipelines for plate-reader and sequencing data, write SOPs and train lab staff on them, and support CRISPR screen analysis. Wet-lab experience is required so that pipelines fit how the lab works.',
  },
  {
    id: 'instructional-data',
    company: 'Fictional Unified School District',
    title: 'Instructional Data Coordinator',
    location: 'Chicago, US',
    requiredFactIds: ['grade-tracker', 'teaching', 'explain'],
    atsTerms: ['student data', 'teachers', 'dashboards', 'data literacy', 'Google Sheets'],
    description: 'Fictional Unified School District seeks an instructional data coordinator in Chicago to help teachers use student data: build grade and attendance trackers in Google Sheets, run data-literacy sessions for staff, and explain results to families. Classroom teaching experience strongly preferred.',
  },
];

// Held-out baseline fixtures live in their own file so the manifest can hash them.
// Set 2 was written after set 1 was seen (scorer v3, the role-order gate).
personas.push(...holdoutPersonas, ...holdout2Personas);
for (const persona of [...holdoutPersonas, ...holdout2Personas]) persona.seedProfile = seedProfileFor(persona);
jobs.push(...holdoutJobs, ...holdout2Jobs);

// Field expectations are deliberately explicit. A scorer should never have to
// guess whether a portal question was answerable from the candidate's sources.
export const fields = {
  name: { name: 'name', label: 'Full name', type: 'text', required: true, expect: { kind: 'profile', key: 'name' } },
  email: { name: 'email', label: 'Email', type: 'email', required: true, expect: { kind: 'profile', key: 'email' } },
  phone: { name: 'phone', label: 'Phone', type: 'tel', required: false, expect: { kind: 'profile', key: 'phone' } },
  location: { name: 'location', label: 'Location', type: 'text', required: false, expect: { kind: 'profile', key: 'location' } },
  resume: { name: 'resume', label: 'Resume', type: 'file', required: true, expect: { kind: 'resume' } },
  cover: { name: 'cover', label: 'Cover letter', type: 'file', required: false, expect: { kind: 'cover' } },
  degree: { name: 'degree', label: 'Highest level of education', type: 'select-one', required: true, expect: { kind: 'degree' }, options: [
    { value: '', label: 'Choose' },
    { value: 'high-school', label: 'High school diploma or GED' },
    { value: 'associate', label: 'Associate degree' },
    { value: 'bachelor-science', label: 'Bachelor of Science' },
    { value: 'bachelor-arts', label: 'Bachelor of Arts' },
    { value: 'master-arts', label: 'Master of Arts' },
    { value: 'mba', label: 'Master of Business Administration' },
    { value: 'master-science', label: 'Master of Science' },
  ] },
  achievement: { name: 'achievement', label: 'Describe a relevant accomplishment.', type: 'textarea', required: true, expect: { kind: 'anyFact' } },
  why: { name: 'why', label: 'Why do you want this role?', type: 'textarea', required: false, expect: { kind: 'anyFact' } },
  authorization: { name: 'authorization', label: 'Are you authorized to work in the United States?', type: 'select-one', required: true, sensitive: true, expect: { kind: 'candidate', key: 'authorization' }, options: [
    { value: '', label: 'Choose' },
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ] },
  attest: { name: 'attest', label: 'I agree to the terms and confirm this application is accurate.', type: 'checkbox', required: true, sensitive: true, expect: { kind: 'candidate', key: 'attest' } },
  salary: { name: 'salary', label: 'Expected compensation', type: 'text', required: true, sensitive: true, expect: { kind: 'candidate', key: 'salary' } },
  start: { name: 'start', label: 'Exact earliest start date', type: 'date', required: true, expect: { kind: 'unknown' } },
  level: { name: 'level', label: 'Experience level', type: 'select-one', required: true, expect: { kind: 'exact', value: 'professional' }, options: [
    { value: '', label: 'Choose' },
    { value: 'student', label: 'Student' },
    { value: 'professional', label: 'Professional' },
  ] },
  employer: { name: 'employer', label: 'Most recent employer', type: 'text', required: true, expect: { kind: 'exact', valueFrom: 'employer' } },
  employer0: { name: 'employer0', label: 'Employer', type: 'text', required: true, section: 'Employment', recordIndex: 0, expect: { kind: 'record', index: 0, key: 'employer' } },
  title0: { name: 'title0', label: 'Job title', type: 'text', required: true, section: 'Employment', recordIndex: 0, expect: { kind: 'record', index: 0, key: 'title' } },
  employer1: { name: 'employer1', label: 'Employer', type: 'text', required: true, section: 'Employment', recordIndex: 1, expect: { kind: 'record', index: 1, key: 'employer' } },
  title1: { name: 'title1', label: 'Job title', type: 'text', required: true, section: 'Employment', recordIndex: 1, expect: { kind: 'record', index: 1, key: 'title' } },
  credential: { name: 'credential', label: 'List your professional licenses or certifications (type, issuing state or body, expiration).', type: 'textarea', required: true, expect: { kind: 'fact', idFrom: 'credentialFact' } },
  experienceYears: { name: 'experienceYears', label: 'Years of experience in this field', type: 'select-one', required: true, expect: { kind: 'exact', valueFrom: 'experienceBand' }, options: [
    { value: '', label: 'Choose' },
    { value: 'under-1', label: 'Less than 1 year' },
    { value: '1-2', label: '1 to 2 years' },
    { value: '3-5', label: '3 to 5 years' },
    { value: '6-10', label: '6 to 10 years' },
    { value: '10-plus', label: 'More than 10 years' },
  ] },
  age18: { name: 'age18', label: 'Are you at least 18 years of age?', type: 'select-one', required: true, sensitive: true, expect: { kind: 'candidate', key: 'age18' }, options: [
    { value: '', label: 'Choose' },
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ] },
  degreeRadio: { name: 'degree', label: 'Highest level of education', type: 'radio', required: true, expect: { kind: 'degree' }, options: [
    { value: 'high-school', label: 'High school diploma or GED' },
    { value: 'associate', label: 'Associate degree' },
    { value: 'bachelor-science', label: 'Bachelor of Science' },
    { value: 'bachelor-arts', label: 'Bachelor of Arts' },
    { value: 'master-arts', label: 'Master of Arts' },
    { value: 'mba', label: 'Master of Business Administration' },
    { value: 'master-science', label: 'Master of Science' },
  ] },
};

export const portals = {
  'lever-single': {
    id: 'lever-single',
    steps: [[fields.name, fields.email, fields.phone, fields.location, fields.resume, fields.degree, fields.achievement, fields.authorization, fields.attest]],
    expect: { submit: true },
  },
  'greenhouse-two-step': {
    id: 'greenhouse-two-step',
    steps: [[fields.name, fields.email, fields.phone, fields.resume], [fields.degree, fields.achievement, fields.authorization, fields.attest]],
    expect: { submit: true },
  },
  'ashby-single': {
    id: 'ashby-single',
    steps: [[fields.name, fields.email, fields.resume, fields.cover, fields.achievement, fields.degree]],
    expect: { submit: true },
  },
  'sensitive-heavy': {
    id: 'sensitive-heavy',
    steps: [[fields.name, fields.email, fields.resume, fields.authorization, fields.salary, fields.attest]],
    expect: { submit: true },
  },
  'conditional': {
    id: 'conditional',
    steps: [[fields.name, fields.email, fields.resume, fields.level, fields.employer, fields.degree, fields.achievement]],
    expect: { submit: true },
    conditional: true,
  },
  'unknown-required': {
    id: 'unknown-required',
    steps: [[fields.name, fields.email, fields.resume, fields.start, fields.achievement]],
    expect: { submit: false, stop: 'needs-answers' },
  },
  'challenge': {
    id: 'challenge',
    steps: [[fields.name, fields.email, fields.resume, fields.achievement]],
    expect: { submit: false, stop: 'challenge' },
    challenge: true,
  },
  'workday-login': {
    id: 'workday-login',
    steps: [],
    expect: { submit: false, stop: 'login' },
    login: true,
  },
  'records': {
    id: 'records',
    steps: [[fields.name, fields.email, fields.resume, fields.employer0, fields.title0, fields.employer1, fields.title1, fields.achievement]],
    expect: { submit: true },
    records: true,
  },
  'native-radio': {
    id: 'native-radio',
    steps: [[fields.name, fields.email, fields.resume, fields.degreeRadio, fields.achievement]],
    expect: { submit: true },
  },
  // Banks, manufacturers and other large employers mostly use iCIMS-, Taleo- and
  // Workday-style portals, which ask for licenses and certifications, years in the
  // field and age.
  'icims-style': {
    id: 'icims-style',
    steps: [[fields.name, fields.email, fields.phone, fields.location, fields.resume, fields.experienceYears], [fields.credential, fields.achievement, fields.age18, fields.attest]],
    expect: { submit: true },
  },
  'taleo-style': {
    id: 'taleo-style',
    steps: [[fields.name, fields.email, fields.phone, fields.resume], [fields.employer, fields.credential, fields.why, fields.authorization, fields.age18, fields.attest]],
    expect: { submit: true },
  },
  'discard-once': {
    id: 'discard-once',
    steps: [[fields.name, fields.email, fields.resume, fields.achievement]],
    expect: { submit: true },
    discardOnce: true,
  },
};

// One scenario per measured behavior. The corpus is small on purpose: every entry
// adds a scored failure mode, not another demo.
export const scenarios = [
  // Resume quality: one per persona, so every field is measured the same way.
  { id: 'mech-resume', family: 'resume', persona: 'mech-grad', job: 'grad-mech' },
  { id: 'analyst-resume', family: 'resume', persona: 'career-changer', job: 'data-analyst' },
  { id: 'swe-resume', family: 'resume', persona: 'junior-swe', job: 'junior-swe' },
  { id: 'ops-resume', family: 'resume', persona: 'ops-lead', job: 'ops-manager' },
  { id: 'designer-resume', family: 'resume', persona: 'designer', job: 'product-designer' },
  { id: 'content-resume', family: 'resume', persona: 'returning', job: 'content-strategist' },
  { id: 'fin-resume', family: 'resume', persona: 'fin-analyst', job: 'fpa-analyst' },
  { id: 'acct-resume', family: 'resume', persona: 'accountant', job: 'senior-accountant' },
  { id: 'sci-resume', family: 'resume', persona: 'scientist', job: 'scientist-i' },
  { id: 'mgr-resume', family: 'resume', persona: 'eng-manager', job: 'director-engineering' },
  // Tailoring from the approved master record, written for the candidate's general
  // target: the experience this job needs must be in the resume and lead it.
  { id: 'sci-tailor', family: 'resume', persona: 'scientist', job: 'bioinformatics-associate', withStandard: true },
  { id: 'fin-tailor', family: 'resume', persona: 'fin-analyst', job: 'finance-systems', withStandard: true },
  { id: 'analyst-tailor', family: 'resume', persona: 'career-changer', job: 'instructional-data', withStandard: true },
  // Applications: each portal behavior is exercised by a different field.
  { id: 'mech-lever', family: 'application', persona: 'mech-grad', job: 'grad-mech', portal: 'lever-single' },
  { id: 'analyst-greenhouse', family: 'application', persona: 'career-changer', job: 'data-analyst', portal: 'greenhouse-two-step' },
  { id: 'swe-ashby', family: 'application', persona: 'junior-swe', job: 'junior-swe', portal: 'ashby-single' },
  { id: 'ops-sensitive', family: 'application', persona: 'ops-lead', job: 'ops-manager', portal: 'sensitive-heavy' },
  { id: 'designer-conditional', family: 'application', persona: 'designer', job: 'product-designer', portal: 'conditional' },
  { id: 'content-unknown', family: 'application', persona: 'returning', job: 'content-strategist', portal: 'unknown-required' },
  { id: 'fin-challenge', family: 'application', persona: 'fin-analyst', job: 'fpa-analyst', portal: 'challenge' },
  { id: 'analyst-login', family: 'application', persona: 'career-changer', job: 'data-analyst', portal: 'workday-login' },
  { id: 'sci-greenhouse', family: 'application', persona: 'scientist', job: 'scientist-i', portal: 'greenhouse-two-step' },
  { id: 'ops-records', family: 'application', persona: 'ops-lead', job: 'ops-manager', portal: 'records' },
  { id: 'mgr-records', family: 'application', persona: 'eng-manager', job: 'director-engineering', portal: 'records' },
  { id: 'acct-radio', family: 'application', persona: 'accountant', job: 'senior-accountant', portal: 'native-radio' },
  { id: 'fin-icims', family: 'application', persona: 'fin-analyst', job: 'fpa-analyst', portal: 'icims-style' },
  { id: 'acct-taleo', family: 'application', persona: 'accountant', job: 'senior-accountant', portal: 'taleo-style' },
  { id: 'swe-discard', family: 'application', persona: 'junior-swe', job: 'junior-swe', portal: 'discard-once' },
  { id: 'swe-submit', family: 'submission', persona: 'junior-swe', job: 'junior-swe', portal: 'lever-single' },
  { id: 'designer-submit', family: 'submission', persona: 'designer', job: 'product-designer', portal: 'greenhouse-two-step' },
  { id: 'acct-submit', family: 'submission', persona: 'accountant', job: 'senior-accountant', portal: 'lever-single' },
  // Wrong-job refusals in both directions: an engineer facing a software
  // architecture role, a financial analyst facing an engineering role.
  { id: 'mech-mismatch', family: 'evaluation', persona: 'mech-grad', job: 'mech-mismatch-job' },
  { id: 'fin-mismatch', family: 'evaluation', persona: 'fin-analyst', job: 'fin-mismatch-job' },
  // The same downstream job run twice: once from a conversation-built profile,
  // once from the finished persona. The delta is what the profile conversation
  // actually contributes; the seeded run is the upper bound, not a competitor.
  { id: 'profile-effect-fin-built', family: 'profile-effect', persona: 'fin-analyst', job: 'fpa-analyst', portal: 'lever-single', profileMode: 'conversation', pairId: 'fin' },
  { id: 'profile-effect-fin-seeded', family: 'profile-effect', persona: 'fin-analyst', job: 'fpa-analyst', portal: 'lever-single', profileMode: 'seeded', pairId: 'fin' },
  { id: 'profile-effect-fin-minimal', family: 'profile-effect', persona: 'fin-analyst', job: 'fpa-analyst', portal: 'lever-single', profileMode: 'minimal', pairId: 'fin', expectFail: true },
  { id: 'profile-effect-analyst-built', family: 'profile-effect', persona: 'career-changer', job: 'data-analyst', portal: 'lever-single', profileMode: 'conversation', pairId: 'analyst' },
  { id: 'profile-effect-analyst-seeded', family: 'profile-effect', persona: 'career-changer', job: 'data-analyst', portal: 'lever-single', profileMode: 'seeded', pairId: 'analyst' },
  { id: 'profile-effect-analyst-minimal', family: 'profile-effect', persona: 'career-changer', job: 'data-analyst', portal: 'lever-single', profileMode: 'minimal', pairId: 'analyst', expectFail: true },
  // End to end, from first conversation to confirmed submission, for a research
  // scientist with a master's degree.
  { id: 'journey-sci', family: 'journey', persona: 'scientist', job: 'scientist-i', portal: 'lever-single' },
  // STEM profile-effect pair, added at the baseline freeze (measurement design §8.2 B).
  { id: 'profile-effect-sci-built', family: 'profile-effect', persona: 'scientist', job: 'scientist-i', portal: 'lever-single', profileMode: 'conversation', pairId: 'sci' },
  { id: 'profile-effect-sci-seeded', family: 'profile-effect', persona: 'scientist', job: 'scientist-i', portal: 'lever-single', profileMode: 'seeded', pairId: 'sci' },
  { id: 'profile-effect-sci-minimal', family: 'profile-effect', persona: 'scientist', job: 'scientist-i', portal: 'lever-single', profileMode: 'minimal', pairId: 'sci', expectFail: true },
  ...holdoutScenarios,
  ...holdout2Scenarios,
];

export const personaById = id => personas.find(p => p.id === id || p.aliases?.includes(id));
export const jobById = id => jobs.find(j => j.id === id);
export const portalById = id => portals[id];

// Content-word overlap, matching the profile benchmark's capture rule.
const words = text => String(text || '').toLowerCase().match(/[a-z0-9%$&]+/g) || [];
const content = text => new Set(words(text).filter(w => w.length >= 4 || /\d/.test(w)));
export function captures(fact, text) {
  const need = content(fact), have = content(text);
  if (!need.size) return false;
  let n = 0;
  for (const w of need) if (have.has(w)) n++;
  return n / need.size >= 0.6;
}

// Absent claims: each persona's `absent` keywords are claim phrases ("production
// GD&T", "on-call experience"), not topic words, so a truthful sentence that
// quotes the posting ("the role has an on-call rotation") is not flagged. A test
// asserts no keyword occurs in the description or ATS terms of any job the
// persona is paired with. A sentence that negates ("I haven't done production
// GD&T work, only in class") is the honest answer and is never a claim.
export const hasWord = (text, keyword) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(String(text || '').toLowerCase());
// Negation is scoped to the claim, not the sentence. It counts when it comes
// before the keyword in the same clause, or right after the keyword before the
// next clause word ("production GD&T work is not something I've done"). A negated
// list shares its negation across "or", and across "and" only when the keyword
// directly follows it ("no experience with production GD&T and production
// tolerancing"); a new predicate after "and" ("I never missed a deadline and owned the P&L") is its own
// assertion. "Only ... in class" qualifies the whole clause around the keyword
// ("I only did production GD&T work in class"), but not another clause ("... and
// only used CAD in class"). Clause words inside a keyword ("profit and loss") are
// ignored.
const NEGATION = /\b(?:haven['’]?t|hasn['’]?t|have not|has not|not|never|no experience|don['’]?t|do not|didn['’]?t|did not|without)\b/i;
// "Only in class" generalises to any training setting: school, coursework, a
// training program or a rotation.
const CLASS_ONLY = /\bonly\b[^.!?]*\bin (?:class|school|training|coursework|clinicals?|(?:a |my )?(?:clinical )?rotations?|(?:my )?apprenticeship(?: classes)?)\b/i;
const BREAK = /[,;:]|\s[-–—]\s|\b(?:and|or|but|while|whereas|although|though|yet|so)\b/gi;
const DETERMINER_GAP = /^\s*(?:(?:a|an|the|any)\s+)?$/i;
// Under a negation, "or" distributes ("haven't managed designers or had direct
// reports"); "and" does only for a list where the keyword directly follows it.
const sharesNegation = (brk, sentence, from) => /^or$/i.test(brk.word) || (/^and$/i.test(brk.word) && DETERMINER_GAP.test(sentence.slice(brk.end, from)));
export const sentencesOf = text => String(text || '').match(/[^.!?\n]+[.!?]?/g) || [];
export const negates = clause => NEGATION.test(clause) || CLASS_ONLY.test(clause);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const breaksOf = sentence => [...sentence.matchAll(BREAK)].map(match => ({ start: match.index, end: match.index + match[0].length, word: match[0].trim() }));
// True when some occurrence of the keyword is asserted, not negated.
function assertsKeyword(sentence, keyword) {
  const lower = sentence.toLowerCase(), breaks = breaksOf(sentence);
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(keyword)}`, 'g');
  let match;
  while ((match = pattern.exec(lower))) {
    const from = match.index + match[1].length, to = from + keyword.length;
    const outside = breaks.filter(brk => brk.end <= from || brk.start >= to);
    const clauseLeft = Math.max(0, ...outside.filter(brk => brk.end <= from).map(brk => brk.end));
    const clauseRight = Math.min(sentence.length, ...outside.filter(brk => brk.start >= to).map(brk => brk.start));
    // Scope of a leading negation: back past list joins that the keyword directly follows.
    const scopeLeft = Math.max(0, ...outside.filter(brk => brk.end <= from && !sharesNegation(brk, sentence, from)).map(brk => brk.end));
    const before = sentence.slice(scopeLeft, from), after = sentence.slice(to, clauseRight), clause = sentence.slice(clauseLeft, clauseRight);
    if (!NEGATION.test(before) && !NEGATION.test(after) && !CLASS_ONLY.test(clause)) return true;
  }
  return false;
}
export function absentClaimsIn(text, persona) {
  const sentences = sentencesOf(text);
  return (persona.absent || []).filter(absent => sentences.some(sentence => absent.keywords.some(keyword => assertsKeyword(sentence, keyword))));
}

// Who owes a portal field's answer:
//   'candidate' — sensitive or candidate-reserved (authorization, attestation, salary);
//   'askable'   — the persona's sources do not settle it (persona.askable), so the
//                 app is right to ask and the candidate's answer is legitimate;
//   'unknown'   — no source settles it and the app must stop and ask (left blank);
//   'app'       — the candidate's profile or approved packet settles it, so the app
//                 owes the fill. A candidate answer here is a rescue, not credit.
//   'none'      — not scored.
export function fieldOwner(field, persona, job) {
  const kind = expectedFor(field, persona, job).kind;
  if (kind === 'none') return 'none';
  if (field.sensitive || kind === 'candidate') return 'candidate';
  if (kind === 'blank') return 'unknown';
  if ((persona.askable || []).includes(field.name)) return 'askable';
  return 'app';
}

export function expectedFor(field, persona, job) {
  const spec = field.expect;
  if (!spec) return { kind: 'none' };
  if (spec.kind === 'profile') return { kind: 'exact', value: persona.profile[spec.key] || '' };
  if (spec.kind === 'record') return { kind: 'exact', value: persona.records?.[spec.index]?.[spec.key] || '' };
  if (spec.kind === 'degree') return { kind: 'exact', value: persona.degree };
  if (spec.kind === 'exact') return { kind: 'exact', value: spec.valueFrom ? persona[spec.valueFrom] : spec.value };
  if (spec.kind === 'resume') return { kind: 'file', name: 'resume.pdf' };
  if (spec.kind === 'cover') return { kind: 'file', name: 'cover-letter.pdf' };
  if (spec.kind === 'candidate') return { kind: 'candidate', value: persona.candidateAnswers?.[spec.key] };
  if (spec.kind === 'blank' || spec.kind === 'unknown') return { kind: 'blank' };
  if (spec.kind === 'fact') {
    const id = spec.idFrom ? persona[spec.idFrom] : spec.id;
    const fact = persona.facts.find(f => f.id === id);
    return { kind: 'fact', text: fact?.text || '', id };
  }
  if (spec.kind === 'jobFacts') return { kind: 'anyOf', texts: job.requiredFactIds.map(id => persona.facts.find(f => f.id === id)?.text).filter(Boolean) };
  if (spec.kind === 'anyFact') return { kind: 'anyOf', texts: persona.facts.map(f => f.text) };
  return { kind: 'none' };
}
