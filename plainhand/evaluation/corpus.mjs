// Fictional candidates, jobs and portal templates for the Plainhand evaluation
// harness. Everything here is synthetic: no real employer, no personal data, no
// network destination. Ground truth lives beside each persona so a run can score
// what the app built instead of asking a model whether it did well.
import { emptyProfile } from '../store.mjs';

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
    id: 'nurse',
    name: 'Jamie Alvarez',
    employer: 'Example Regional Hospital',
    title: 'Registered Nurse, Medical-Surgical',
    dates: '2023 to 2026',
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'Example University — Bachelor of Science in Nursing — 2023',
    // Hospital and trade portals ask for licenses and years in the field; both are
    // settled by the sources, so the app owes them. Shift and age are the candidate's.
    credentialFact: 'license',
    experienceBand: '3-5',
    // Shift availability is not in the sources; the app is right to ask.
    shiftPreference: 'nights',
    askable: ['shift'],
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion', age18: 'yes' },
    profile: {
      ...emptyProfile(),
      name: 'Jamie Alvarez',
      email: 'jamie@example.invalid',
      phone: '+1 614 555 0107',
      location: 'Columbus, US',
      timezone: 'America/New_York',
      roles: 'Registered nurse, cardiac or step-down',
      compensation: 'Target range: $38 to $45 an hour',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2023',
      links: '',
      voice: 'Plain, caring first-person writing. Say what I did for the patient and what changed. Avoid passionate, leverage and cutting-edge.',
      story: 'I am a med-surg nurse with three years at the bedside, moving toward cardiac care.',
      resume: [
        'Jamie Alvarez',
        'Columbus, US | jamie@example.invalid | +1 614 555 0107',
        '',
        'Registered nurse with three years on a medical-surgical unit, moving toward cardiac step-down care.',
        '',
        'Licenses & Certifications',
        'Registered Nurse license, State of Ohio, active through 2027. BLS and ACLS certified.',
        '',
        'Experience',
        'Example Regional Hospital — Registered Nurse, Medical-Surgical — 2023 to 2026',
        'I care for five to six patients per shift on a 32-bed medical-surgical unit.',
        'I monitor cardiac telemetry for my patients and escalate rhythm changes to the rapid response team.',
        "I led our unit's fall-prevention huddle for a year, and patient falls dropped from 9 to 4 between 2024 and 2025.",
        'I have precepted four new graduate nurses through their 12-week orientation.',
        '',
        'Education',
        'Example University — Bachelor of Science in Nursing — 2023',
      ].join('\n'),
    },
    facts: [
      { id: 'patients', atEmployer: true, keywords: ['patients', 'shift', 'unit', 'care'], text: 'I care for five to six patients per shift on a 32-bed medical-surgical unit.' },
      { id: 'telemetry', keywords: ['telemetry', 'cardiac', 'rhythm', 'escalate'], text: 'I monitor cardiac telemetry for my patients and escalate rhythm changes to the rapid response team.' },
      { id: 'license', section: 'Licenses & Certifications', keywords: ['license', 'certified', 'acls', 'bls'], text: 'Registered Nurse license, State of Ohio, active through 2027. BLS and ACLS certified.' },
      { id: 'falls', keywords: ['falls', 'prevention', 'huddle', 'safety'], text: "I led our unit's fall-prevention huddle for a year, and patient falls dropped from 9 to 4 between 2024 and 2025." },
      { id: 'precept', keywords: ['precepted', 'new graduate', 'orientation', 'mentor'], text: 'I have precepted four new graduate nurses through their 12-week orientation.' },
    ],
    absent: [{ id: 'icu', keywords: ['icu experience', 'critical care experience', 'intensive care experience', 'worked in the icu', 'worked in an icu', 'ccrn'], text: "I haven't worked in an ICU; my critical care exposure was one clinical rotation." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'apprentice',
    name: 'Marcus Bell',
    employer: 'Example Electric Co',
    title: 'Electrical Apprentice',
    dates: '2023 to 2026',
    level: 'professional',
    degree: 'high-school',
    degreeLabel: 'High school diploma or GED',
    educationEvidence: 'Example High School — High School Diploma — 2021',
    credentialFact: 'cert',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion', age18: 'yes' },
    profile: {
      ...emptyProfile(),
      name: 'Marcus Bell',
      email: 'marcus@example.invalid',
      phone: '+1 720 555 0108',
      location: 'Denver, US',
      timezone: 'America/Denver',
      roles: 'Commercial electrician apprentice',
      compensation: 'Target: $26 an hour or the posted apprentice scale',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2021',
      links: '',
      voice: 'Short, plain first-person sentences. Say the job and what got done. Avoid passionate, leverage and cutting-edge.',
      story: 'I am a third-year electrical apprentice looking for more commercial work.',
      resume: [
        'Marcus Bell',
        'Denver, US | marcus@example.invalid | +1 720 555 0108',
        '',
        'Third-year electrical apprentice with commercial and multifamily experience.',
        '',
        'Certifications',
        'OSHA 30 card, 2024. State-registered electrical apprenticeship, year 3 of 4, 576 classroom hours completed.',
        '',
        'Experience',
        'Example Electric Co — Electrical Apprentice — 2023 to 2026',
        'I bend and run EMT conduit and pull wire on commercial jobs, and I have logged 5,600 on-the-job hours.',
        'I helped install and label a 400-amp panel upgrade for a 30-unit apartment building, working under a licensed journeyman.',
        'I read electrical blueprints and mark up as-built changes for the foreman at the end of each day.',
        "I keep my crew's lockout/tagout log, and our crew went 2 years without a recordable injury.",
        '',
        'Education',
        'Example High School — High School Diploma — 2021',
      ].join('\n'),
    },
    facts: [
      { id: 'conduit', atEmployer: true, keywords: ['conduit', 'wire', 'commercial', 'hours'], text: 'I bend and run EMT conduit and pull wire on commercial jobs, and I have logged 5,600 on-the-job hours.' },
      { id: 'blueprints', keywords: ['blueprints', 'as-built', 'foreman', 'drawings'], text: 'I read electrical blueprints and mark up as-built changes for the foreman at the end of each day.' },
      { id: 'cert', section: 'Certifications', keywords: ['osha', 'apprenticeship', 'classroom', 'certification'], text: 'OSHA 30 card, 2024. State-registered electrical apprenticeship, year 3 of 4, 576 classroom hours completed.' },
      { id: 'panel', keywords: ['panel', '400-amp', 'apartment', 'install'], text: 'I helped install and label a 400-amp panel upgrade for a 30-unit apartment building, working under a licensed journeyman.' },
      { id: 'safety', keywords: ['lockout', 'tagout', 'safety', 'injury'], text: "I keep my crew's lockout/tagout log, and our crew went 2 years without a recordable injury." },
    ],
    absent: [{ id: 'license', keywords: ['journeyman license', 'licensed electrician', 'master electrician', 'electrical license'], text: "I don't have my journeyman license yet; I can sit for the exam after year four." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'retail-lead',
    name: 'Rosa Delgado',
    employer: 'Example Grocery',
    title: 'Shift Lead',
    dates: '2019 to 2026',
    level: 'professional',
    degree: 'high-school',
    degreeLabel: 'High school diploma or GED',
    educationEvidence: 'Example High School — High School Diploma — 2017',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Rosa Delgado',
      email: 'rosa@example.invalid',
      phone: '+1 602 555 0109',
      location: 'Phoenix, US',
      timezone: 'America/Phoenix',
      roles: 'Assistant store manager, retail operations',
      compensation: 'Target range: $50,000 to $58,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2017',
      links: '',
      voice: 'Friendly, direct first-person writing. Say what I handled and the result. Avoid passionate, leverage and cutting-edge.',
      story: 'I have run evening shifts at a grocery store for seven years and want to move into store management.',
      resume: [
        'Rosa Delgado',
        'Phoenix, US | rosa@example.invalid | +1 602 555 0109',
        '',
        'Grocery shift lead with seven years of retail experience, ready for an assistant store manager role.',
        '',
        'Experience',
        'Example Grocery — Shift Lead — 2019 to 2026',
        'I run the evening shift for a team of 14 cashiers and stockers at a store that does about $90,000 in weekly sales.',
        'I reorganized our receiving checklist, and inventory shrink fell from 2.1% to 1.4% over six months.',
        'I trained 20 new hires on the register and opening procedures in the last two years.',
        'I handle customer complaints that get escalated past the register and close out the cash office each night.',
        "I build the weekly schedule for my shift in the store's scheduling software and cover call-outs.",
        '',
        'Education',
        'Example High School — High School Diploma — 2017',
      ].join('\n'),
    },
    facts: [
      { id: 'shifts', atEmployer: true, keywords: ['shift', 'team', 'cashiers', 'sales'], text: 'I run the evening shift for a team of 14 cashiers and stockers at a store that does about $90,000 in weekly sales.' },
      { id: 'shrink', keywords: ['inventory', 'shrink', 'receiving', 'checklist'], text: 'I reorganized our receiving checklist, and inventory shrink fell from 2.1% to 1.4% over six months.' },
      { id: 'training', keywords: ['trained', 'new hires', 'register', 'training'], text: 'I trained 20 new hires on the register and opening procedures in the last two years.' },
      { id: 'customers', keywords: ['customer', 'complaints', 'cash office', 'escalated'], text: 'I handle customer complaints that get escalated past the register and close out the cash office each night.' },
      { id: 'schedule', keywords: ['schedule', 'scheduling', 'call-outs', 'weekly'], text: "I build the weekly schedule for my shift in the store's scheduling software and cover call-outs." },
    ],
    absent: [{ id: 'hiring', keywords: ['hiring decisions', 'hiring authority', 'fired employees', 'terminated employees', 'hired staff'], text: "I haven't made hiring or firing decisions; the store manager does that." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'public-admin',
    name: 'Leah Thompson',
    employer: "Example County Clerk's Office",
    title: 'Administrative Specialist II',
    dates: '2020 to 2026',
    level: 'professional',
    degree: 'associate',
    degreeLabel: 'Associate degree',
    educationEvidence: 'Example Community College — Associate of Applied Science, Office Administration — 2019',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Leah Thompson',
      email: 'leah@example.invalid',
      phone: '+1 916 555 0110',
      location: 'Sacramento, US',
      timezone: 'America/Los_Angeles',
      roles: 'Program coordinator, records coordinator',
      compensation: 'Target: the posted state pay range for the classification',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2019',
      links: '',
      voice: 'Clear, precise first-person writing. Name the process and the result. Avoid passionate, leverage and cutting-edge.',
      story: 'I have handled public records and front-counter service in county government for six years.',
      resume: [
        'Leah Thompson',
        'Sacramento, US | leah@example.invalid | +1 916 555 0110',
        '',
        'County administrative specialist with six years in public records and resident services. Bilingual in English and Spanish.',
        '',
        'Experience',
        "Example County Clerk's Office — Administrative Specialist II — 2020 to 2026",
        'I process about 300 public records requests a month and track each one against the 10-day legal deadline.',
        'I cleared a backlog of 1,100 unscanned permits by setting up a scanning schedule with two part-time clerks.',
        'I rewrote the office procedures manual for records requests after the state changed its retention rules.',
        'I answer questions from residents at the front counter and by phone, in English and Spanish.',
        '',
        'Education',
        'Example Community College — Associate of Applied Science, Office Administration — 2019',
      ].join('\n'),
    },
    facts: [
      { id: 'records', atEmployer: true, keywords: ['records', 'requests', 'deadline', 'public'], text: 'I process about 300 public records requests a month and track each one against the 10-day legal deadline.' },
      { id: 'backlog', keywords: ['backlog', 'permits', 'scanning', 'clerks'], text: 'I cleared a backlog of 1,100 unscanned permits by setting up a scanning schedule with two part-time clerks.' },
      { id: 'procedures', keywords: ['procedures', 'manual', 'retention', 'rules'], text: 'I rewrote the office procedures manual for records requests after the state changed its retention rules.' },
      { id: 'residents', keywords: ['residents', 'counter', 'phone', 'spanish'], text: 'I answer questions from residents at the front counter and by phone, in English and Spanish.' },
    ],
    absent: [{ id: 'supervision', keywords: ['supervised staff', 'supervisory experience', 'direct reports', 'managed a team', 'supervised employees'], text: "I haven't supervised staff; I set the part-time clerks' scanning schedule and nothing more." }],
    voice: { banned: ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'], firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'director',
    name: 'Elena Marsh',
    employer: 'Example Food Bank',
    title: 'Director of Development',
    dates: '2018 to 2026',
    records: [{ employer: 'Example Food Bank', title: 'Director of Development' }, { employer: 'Example Arts Council', title: 'Development Manager' }],
    level: 'professional',
    degree: 'master-arts',
    degreeLabel: 'Master of Arts',
    educationEvidence: 'Example University — Master of Arts, Nonprofit Management — 2012',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion' },
    profile: {
      ...emptyProfile(),
      name: 'Elena Marsh',
      email: 'elena@example.invalid',
      phone: '+1 612 555 0111',
      location: 'Minneapolis, US',
      timezone: 'America/Chicago',
      roles: 'Vice president of development, chief development officer',
      compensation: 'Target range: $160,000 to $185,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2012',
      links: 'https://example.invalid/elena',
      voice: 'Confident, concise first-person writing. Lead with the result and the team behind it. Avoid passionate, leverage and cutting-edge.',
      story: 'I have led fundraising at two nonprofits for 14 years and want to lead development at a larger health organization.',
      resume: [
        'Elena Marsh',
        'Minneapolis, US | elena@example.invalid | +1 612 555 0111',
        '',
        'Nonprofit fundraising leader with 14 years in development.',
        '',
        'Experience',
        'Example Food Bank — Director of Development — 2018 to 2026',
        'I led a $12 million capital campaign that closed six months early and funded a new 60,000-square-foot warehouse.',
        'I manage a development team of seven, including two major-gifts officers and a grants manager.',
        'Our grant revenue grew from $1.8 million to $3.1 million over four years under my direction.',
        'I staff the board development committee and prepare quarterly fundraising reports for 18 board members.',
        'Example Arts Council — Development Manager — 2012 to 2018',
        'I ran the annual fund and grew individual donors from 900 to 2,300.',
        '',
        'Education',
        'Example University — Master of Arts, Nonprofit Management — 2012',
      ].join('\n'),
    },
    facts: [
      { id: 'campaign', atEmployer: true, keywords: ['campaign', 'capital', 'million', 'warehouse'], text: 'I led a $12 million capital campaign that closed six months early and funded a new 60,000-square-foot warehouse.' },
      { id: 'team', keywords: ['manage', 'team', 'officers', 'gifts'], text: 'I manage a development team of seven, including two major-gifts officers and a grants manager.' },
      { id: 'grants', keywords: ['grant', 'revenue', 'million', 'grew'], text: 'Our grant revenue grew from $1.8 million to $3.1 million over four years under my direction.' },
      { id: 'board', keywords: ['board', 'committee', 'reports', 'quarterly'], text: 'I staff the board development committee and prepare quarterly fundraising reports for 18 board members.' },
      { id: 'annual', keywords: ['annual fund', 'donors', 'individual', 'grew'], text: 'I ran the annual fund and grew individual donors from 900 to 2,300.' },
    ],
    absent: [{ id: 'federal', keywords: ['federal grants', 'federal grant management', 'government contracts', 'federal funding'], text: "I haven't managed federal grants; our funding comes from private donors and foundations." }],
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
    description: 'SYNTHETIC TEST JOB. Fictional Robotics Co seeks a junior mechanical design engineer in Boston. Design and test mechanical assemblies for mobile robots. SolidWorks, FEA and prototyping are central. Write test plans, build prototypes with technicians, and explain design tradeoffs. GD&T for production parts is a plus but not required.',
  },
  {
    id: 'data-analyst',
    company: 'Fictional Health Analytics',
    title: 'Data Analyst',
    location: 'Chicago, US',
    requiredFactIds: ['dashboard', 'sql', 'teaching'],
    atsTerms: ['SQL', 'Tableau', 'dashboards', 'stakeholders', 'Python'],
    description: 'SYNTHETIC TEST JOB. Fictional Health Analytics seeks a data analyst in Chicago. Build dashboards and reports in SQL and Tableau for operations teams. Explain findings to non-technical stakeholders. Python is a plus. Two years of business analytics experience preferred, but a strong portfolio is considered.',
  },
  {
    id: 'junior-swe',
    company: 'Fictional Transit Software',
    title: 'Junior Software Engineer',
    location: 'Austin, US',
    requiredFactIds: ['app', 'tests', 'ta'],
    atsTerms: ['TypeScript', 'tests', 'code review', 'on-call', 'Node.js'],
    description: 'SYNTHETIC TEST JOB. Fictional Transit Software seeks a junior software engineer in Austin. Build TypeScript services and web apps for transit riders. Write tests, take part in code review, and join an on-call rotation after onboarding. Experience with a real user-facing app is valuable.',
  },
  {
    id: 'ops-manager',
    company: 'Fictional Logistics',
    title: 'Operations Manager',
    location: 'Chicago, US',
    requiredFactIds: ['scheduling', 'team', 'vendor'],
    atsTerms: ['scheduling', 'vendors', 'cost', 'team', 'delivery'],
    description: 'SYNTHETIC TEST JOB. Fictional Logistics seeks an operations manager in Chicago. Own daily scheduling, manage a dispatch team, negotiate vendor contracts and keep delivery windows. Report cost and overtime results. Experience with a recurring scheduling process is required.',
  },
  {
    id: 'product-designer',
    company: 'Fictional Design Studio',
    title: 'Product Designer',
    location: 'Seattle, US',
    requiredFactIds: ['design-system', 'research', 'prototype'],
    atsTerms: ['design system', 'research', 'prototyping', 'Figma', 'accessibility'],
    description: 'SYNTHETIC TEST JOB. Fictional Design Studio seeks a product designer in Seattle. Build and document a design system in Figma, run user research, and turn findings into prototypes. Pair with engineers to ship accessible interfaces. Portfolio required.',
  },
  {
    id: 'content-strategist',
    company: 'Fictional Media',
    title: 'Content Strategist',
    location: 'Seattle, US',
    requiredFactIds: ['editorial', 'campaign', 'analytics'],
    atsTerms: ['editorial', 'campaigns', 'analytics', 'style guide', 'help articles'],
    description: 'SYNTHETIC TEST JOB. Fictional Media seeks a content strategist in Seattle. Maintain an editorial guide, plan launch campaigns across email and social, and use article analytics to choose topics. Write and rewrite help content. A career break is not a barrier.',
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
    description: 'SYNTHETIC TEST JOB. Fictional Cloud Core seeks a principal distributed storage architect with 10+ years operating multi-region consensus engines, kernel bypass networking, and petabyte-scale object storage in Go and Rust.',
  },
  {
    id: 'rn-stepdown',
    company: 'Fictional Heart Institute',
    title: 'Registered Nurse, Cardiac Step-Down',
    location: 'Columbus, US',
    requiredFactIds: ['telemetry', 'patients', 'license'],
    atsTerms: ['telemetry', 'ACLS', 'step-down', 'patient education', 'precepting'],
    description: 'SYNTHETIC TEST JOB. Fictional Heart Institute seeks a registered nurse for a 28-bed cardiac step-down unit in Columbus. Monitor telemetry, titrate drips per protocol, educate patients and families before discharge, and work three 12-hour shifts including every third weekend. Active state RN license and ACLS required. Med-surg nurses with telemetry exposure are encouraged to apply; prior critical care work is welcome but not required.',
  },
  {
    id: 'electrician-apprentice',
    company: 'Fictional Electrical Contractors',
    title: 'Commercial Electrician Apprentice (Year 3+)',
    location: 'Denver, US',
    requiredFactIds: ['conduit', 'blueprints', 'cert'],
    atsTerms: ['conduit', 'blueprints', 'OSHA 30', 'commercial', 'panel'],
    description: 'SYNTHETIC TEST JOB. Fictional Electrical Contractors seeks a third- or fourth-year apprentice for commercial tenant-improvement work in Denver. Bend and install EMT conduit, pull wire, read blueprints and keep as-builts current, and follow lockout/tagout on every job. Must be enrolled in a state-registered apprenticeship and hold an OSHA 30 card. Reliable transportation required.',
  },
  {
    id: 'assistant-store-manager',
    company: 'Fictional Market',
    title: 'Assistant Store Manager',
    location: 'Phoenix, US',
    requiredFactIds: ['shifts', 'shrink', 'training'],
    atsTerms: ['inventory', 'scheduling', 'cash office', 'training', 'customer service'],
    description: 'SYNTHETIC TEST JOB. Fictional Market seeks an assistant store manager for a high-volume grocery store in Phoenix. Run shifts, build schedules, control inventory and shrink, train new team members, resolve customer service issues and balance the cash office. Two years leading retail shifts required; a degree is not required. Nights and weekends.',
  },
  {
    id: 'records-coordinator',
    company: 'Fictional State Agency',
    title: 'Records Program Coordinator',
    location: 'Sacramento, US',
    requiredFactIds: ['records', 'backlog', 'procedures'],
    atsTerms: ['public records', 'retention', 'deadlines', 'procedures', 'bilingual'],
    description: 'SYNTHETIC TEST JOB. Fictional State Agency seeks a records program coordinator in Sacramento. Coordinate public records requests against statutory deadlines, maintain retention schedules, write and update procedures, and answer questions from the public. Bilingual English and Spanish preferred. This is a non-supervisory classification.',
  },
  {
    id: 'vp-development',
    company: 'Fictional Health Foundation',
    title: 'Vice President of Development',
    location: 'Minneapolis, US',
    requiredFactIds: ['campaign', 'team', 'grants'],
    atsTerms: ['capital campaign', 'major gifts', 'board', 'grants', 'fundraising'],
    description: 'SYNTHETIC TEST JOB. Fictional Health Foundation seeks a vice president of development in Minneapolis to lead a team of 12. Plan and run a capital campaign, grow major gifts and foundation grants, and work closely with the board and CEO. Ten or more years of nonprofit fundraising leadership required.',
  },
  {
    id: 'nurse-mismatch-job',
    company: 'Fictional Bridge Engineering',
    title: 'Senior Structural Engineer (PE)',
    location: 'Columbus, US',
    requiredFactIds: ['patients'],
    atsTerms: ['PE license', 'structural analysis', 'steel design'],
    expectRecommendation: 'Skip',
    maxScore: 3.5,
    description: 'SYNTHETIC TEST JOB. Fictional Bridge Engineering seeks a senior structural engineer with a Professional Engineer license and 10+ years designing steel and concrete highway bridges, including load rating and structural analysis software.',
  },
  // Same candidates, jobs that need a different part of their experience first.
  {
    id: 'training-coordinator',
    company: 'Fictional Grocers Co',
    title: 'Store Training Coordinator',
    location: 'Phoenix, US',
    requiredFactIds: ['training', 'customers', 'schedule'],
    atsTerms: ['training', 'onboarding', 'customer service', 'scheduling', 'coaching'],
    description: 'SYNTHETIC TEST JOB. Fictional Grocers Co seeks a store training coordinator in Phoenix to onboard and train new cashiers and stockers across three stores, coach staff on customer service and complaint handling, and schedule training sessions around shift coverage. Retail experience required; a degree is not required.',
  },
  {
    id: 'nurse-educator',
    company: 'Fictional Community Hospital',
    title: 'Clinical Nurse Educator, Medical-Surgical',
    location: 'Columbus, US',
    requiredFactIds: ['precept', 'falls', 'license'],
    atsTerms: ['orientation', 'preceptor', 'patient safety', 'fall prevention', 'education'],
    description: 'SYNTHETIC TEST JOB. Fictional Community Hospital seeks a clinical nurse educator for its medical-surgical units in Columbus. Design and run orientation for new graduate nurses, support preceptors, and lead unit patient-safety work such as fall prevention. Active RN license and BSN required; bedside med-surg experience preferred.',
  },
  {
    id: 'instructional-data',
    company: 'Fictional Unified School District',
    title: 'Instructional Data Coordinator',
    location: 'Chicago, US',
    requiredFactIds: ['grade-tracker', 'teaching', 'explain'],
    atsTerms: ['student data', 'teachers', 'dashboards', 'data literacy', 'Google Sheets'],
    description: 'SYNTHETIC TEST JOB. Fictional Unified School District seeks an instructional data coordinator in Chicago to help teachers use student data: build grade and attendance trackers in Google Sheets, run data-literacy sessions for staff, and explain results to families. Classroom teaching experience strongly preferred.',
  },
];

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
  shift: { name: 'shift', label: 'Which shift are you available to work?', type: 'select-one', required: true, expect: { kind: 'exact', valueFrom: 'shiftPreference' }, options: [
    { value: '', label: 'Choose' },
    { value: 'days', label: 'Days' },
    { value: 'evenings', label: 'Evenings' },
    { value: 'nights', label: 'Nights' },
    { value: 'rotating', label: 'Rotating' },
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
  // Hospital and trade employers mostly use iCIMS- and Taleo-style portals, which
  // ask for licenses, years in the field, shift availability and age.
  'icims-style': {
    id: 'icims-style',
    steps: [[fields.name, fields.email, fields.phone, fields.location, fields.resume, fields.experienceYears], [fields.credential, fields.achievement, fields.shift, fields.age18, fields.attest]],
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
  { id: 'nurse-resume', family: 'resume', persona: 'nurse', job: 'rn-stepdown' },
  { id: 'apprentice-resume', family: 'resume', persona: 'apprentice', job: 'electrician-apprentice' },
  { id: 'retail-resume', family: 'resume', persona: 'retail-lead', job: 'assistant-store-manager' },
  { id: 'admin-resume', family: 'resume', persona: 'public-admin', job: 'records-coordinator' },
  { id: 'director-resume', family: 'resume', persona: 'director', job: 'vp-development' },
  // Tailoring from an approved standard written for the candidate's general target:
  // the experience this job needs must be in the resume and lead it.
  { id: 'retail-tailor', family: 'resume', persona: 'retail-lead', job: 'training-coordinator', withStandard: true },
  { id: 'nurse-tailor', family: 'resume', persona: 'nurse', job: 'nurse-educator', withStandard: true },
  { id: 'analyst-tailor', family: 'resume', persona: 'career-changer', job: 'instructional-data', withStandard: true },
  // Applications: each portal behavior is exercised by a different field.
  { id: 'mech-lever', family: 'application', persona: 'mech-grad', job: 'grad-mech', portal: 'lever-single' },
  { id: 'analyst-greenhouse', family: 'application', persona: 'career-changer', job: 'data-analyst', portal: 'greenhouse-two-step' },
  { id: 'swe-ashby', family: 'application', persona: 'junior-swe', job: 'junior-swe', portal: 'ashby-single' },
  { id: 'ops-sensitive', family: 'application', persona: 'ops-lead', job: 'ops-manager', portal: 'sensitive-heavy' },
  { id: 'designer-conditional', family: 'application', persona: 'designer', job: 'product-designer', portal: 'conditional' },
  { id: 'content-unknown', family: 'application', persona: 'returning', job: 'content-strategist', portal: 'unknown-required' },
  { id: 'nurse-challenge', family: 'application', persona: 'nurse', job: 'rn-stepdown', portal: 'challenge' },
  { id: 'analyst-login', family: 'application', persona: 'career-changer', job: 'data-analyst', portal: 'workday-login' },
  { id: 'retail-greenhouse', family: 'application', persona: 'retail-lead', job: 'assistant-store-manager', portal: 'greenhouse-two-step' },
  { id: 'admin-lever', family: 'application', persona: 'public-admin', job: 'records-coordinator', portal: 'lever-single' },
  { id: 'ops-records', family: 'application', persona: 'ops-lead', job: 'ops-manager', portal: 'records' },
  { id: 'director-records', family: 'application', persona: 'director', job: 'vp-development', portal: 'records' },
  { id: 'apprentice-radio', family: 'application', persona: 'apprentice', job: 'electrician-apprentice', portal: 'native-radio' },
  { id: 'nurse-icims', family: 'application', persona: 'nurse', job: 'rn-stepdown', portal: 'icims-style' },
  { id: 'apprentice-taleo', family: 'application', persona: 'apprentice', job: 'electrician-apprentice', portal: 'taleo-style' },
  { id: 'swe-discard', family: 'application', persona: 'junior-swe', job: 'junior-swe', portal: 'discard-once' },
  { id: 'swe-submit', family: 'submission', persona: 'junior-swe', job: 'junior-swe', portal: 'lever-single' },
  { id: 'designer-submit', family: 'submission', persona: 'designer', job: 'product-designer', portal: 'greenhouse-two-step' },
  { id: 'apprentice-submit', family: 'submission', persona: 'apprentice', job: 'electrician-apprentice', portal: 'lever-single' },
  // Wrong-job refusals in both directions: an engineer facing a software
  // architecture role, a nurse facing an engineering role.
  { id: 'mech-mismatch', family: 'evaluation', persona: 'mech-grad', job: 'mech-mismatch-job' },
  { id: 'nurse-mismatch', family: 'evaluation', persona: 'nurse', job: 'nurse-mismatch-job' },
  // The same downstream job run twice: once from a conversation-built profile,
  // once from the finished persona. The delta is what the profile conversation
  // actually contributes; the seeded run is the upper bound, not a competitor.
  { id: 'profile-effect-nurse-built', family: 'profile-effect', persona: 'nurse', job: 'rn-stepdown', portal: 'lever-single', profileMode: 'conversation', pairId: 'nurse' },
  { id: 'profile-effect-nurse-seeded', family: 'profile-effect', persona: 'nurse', job: 'rn-stepdown', portal: 'lever-single', profileMode: 'seeded', pairId: 'nurse' },
  { id: 'profile-effect-nurse-minimal', family: 'profile-effect', persona: 'nurse', job: 'rn-stepdown', portal: 'lever-single', profileMode: 'minimal', pairId: 'nurse', expectFail: true },
  { id: 'profile-effect-analyst-built', family: 'profile-effect', persona: 'career-changer', job: 'data-analyst', portal: 'lever-single', profileMode: 'conversation', pairId: 'analyst' },
  { id: 'profile-effect-analyst-seeded', family: 'profile-effect', persona: 'career-changer', job: 'data-analyst', portal: 'lever-single', profileMode: 'seeded', pairId: 'analyst' },
  { id: 'profile-effect-analyst-minimal', family: 'profile-effect', persona: 'career-changer', job: 'data-analyst', portal: 'lever-single', profileMode: 'minimal', pairId: 'analyst', expectFail: true },
  // End to end, from first conversation to confirmed submission, for an applicant
  // with no degree.
  { id: 'journey-retail', family: 'journey', persona: 'retail-lead', job: 'assistant-store-manager', portal: 'lever-single' },
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
// "Only in class" generalises to any training setting: school, coursework, clinical
// rotations, an apprenticeship's classroom hours.
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
