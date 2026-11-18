// Held-out fixtures, set 2 (scorer v3: the role-order gate). Written after the first
// held-out set and the live baseline `00ce1bf` were read, so set 1 is seen. Nothing
// here was tuned on a run of these rows, and no scorer or prompt rule may special-case
// these ids. Everything is synthetic: fictional people, employers and jobs, .invalid
// addresses, 555 numbers.
//
// What set 2 covers, which set 1 could not:
// - old-role tailoring under each roleOrder. Two personas face a job whose required
//   facts sit mostly in an older role but not only there: the newer role is relevant
//   enough to keep, so under `recent` it leads and the old role must not, and under
//   `match` the old role must lead. Each persona runs the same job twice.
// - a newer role with nothing the job needs: it is reduced to one short line (or
//   dropped) instead of leading, and the role that earned the required facts stays.
// - a zero-match Skip and a borderline Investigate with its band.
// - one full journey, from the first profile conversation to a confirmed submission.
//
// Every persona has three or more roles, a credential, and a gap or a stage change.
import { emptyProfile } from '../store.mjs';

const banned = ['passionate', 'leverage', 'cutting-edge', 'synergy', 'robust'];
const contact = (name, email, phone, location) => `${name}\n${location} | ${email} | ${phone}`;

// A controller who came up through audit and revenue systems. The stage change is the
// move from revenue systems back into a division's own close in 2021.
const finFacts = {
  close: 'I cut the month-end close for a $480 million division from 7 days to 4 by rebuilding the close checklist and the intercompany tie-out.',
  controls: 'I run the division internal controls programme and closed two external audits with no significant findings.',
  team: 'I lead 5 accountants across two locations and set the close calendar they work to.',
  revrec: 'I built the revenue recognition process for a subscription freight platform under ASC 606 and automated it in NetSuite.',
  billing: 'I migrated billing and revenue schedules for 9,000 customer contracts onto NetSuite and trained 30 users on the new system.',
  audit: 'I led the first system audit of the revenue engine and wrote the control narratives the auditors tested.',
  recon: 'I owned the balance sheet reconciliations for receivables and deferred revenue and cleared the quarterly review.',
  cert: 'Certified Public Accountant (CPA), Ohio, active since 2015.',
};

// An SRE who moved into developer tooling: the newest role builds the observability
// and template tooling the product teams use.
const sreFacts = {
  observability: 'I built the tracing and metrics pipeline that 200 engineers use to debug production incidents, and it replaced three separate logging tools.',
  cli: 'I wrote the internal command line tool new hires use to create a service from a template, and I maintain it.',
  slo: 'I defined the service level objectives for 12 services and cut the incident rate by about a third over two years.',
  incident: 'I was incident commander for 40 major incidents and wrote the review that changed how we rolled out configuration.',
  oncall: 'I served on the primary on-call rotation for the payments API and ran the follow-the-sun handoff across three regions.',
  ansible: 'I automated server builds with Ansible and cut a machine rebuild from 3 hours to 20 minutes.',
  cert: 'Certified Kubernetes Security Specialist (CKS), 2023.',
};

// A research associate who left the bench for two years and came back through an
// instrument vendor's applications team: a gap and a stage change in one record.
const stemFacts = {
  assay: 'I developed a cell-based potency assay that cut turnaround from 6 days to 2 and is used in three programmes.',
  automation: 'I automated the assay on a liquid-handling robot, which raised plate throughput from 120 to 400 samples a day.',
  lims: 'I connected the assay workflow to our LIMS so every plate was tracked from intake to result.',
  culture: 'I maintained the cell culture lines and ran the weekly quality control panel.',
  demos: 'I run instrument demonstrations and training sessions for customer labs, and I answer their application questions after the sale.',
  cert: 'I earned a Lean Six Sigma Green Belt certification in 2019.',
};

export const holdout2Personas = [
  {
    id: 'holdout2-fin-close',
    name: 'Bettina Marsh',
    employer: 'Example Instruments Group',
    title: 'Divisional Controller',
    dates: '2021 to 2026',
    records: [
      { employer: 'Example Instruments Group', title: 'Divisional Controller' },
      { employer: 'Example Freight Systems', title: 'Revenue Systems Manager' },
      { employer: 'Example Distribution Co', title: 'Senior Accountant' },
    ],
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'Example University — Bachelor of Science, Accounting — 2013',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion', age18: 'yes' },
    credentialFact: 'cert',
    experienceBand: '10-plus',
    profile: {
      ...emptyProfile(),
      name: 'Bettina Marsh',
      email: 'bettina@example.invalid',
      phone: '+1 614 555 0161',
      location: 'Columbus, US',
      timezone: 'America/New_York',
      roles: 'Divisional controller, revenue accounting systems',
      compensation: 'Target range: $155,000 to $175,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2013',
      links: 'https://example.invalid/bettina',
      voice: 'Plain, exact first-person writing. Name the system and what changed. Avoid passionate, leverage and cutting-edge.',
      story: 'I trained in accounting, spent five years on revenue systems, and since 2021 I have run a division close as controller.',
      resume: [
        contact('Bettina Marsh', 'bettina@example.invalid', '+1 614 555 0161', 'Columbus, US'),
        '',
        'Divisional controller with twelve years in accounting, revenue systems and close.',
        '',
        'Experience',
        'Example Instruments Group — Divisional Controller — 2021 to 2026',
        finFacts.close,
        finFacts.controls,
        finFacts.team,
        'Example Freight Systems — Revenue Systems Manager — 2016 to 2021',
        finFacts.revrec,
        finFacts.billing,
        finFacts.audit,
        'Example Distribution Co — Senior Accountant — 2012 to 2016',
        finFacts.recon,
        '',
        'Certifications',
        finFacts.cert,
        '',
        'Education',
        'Example University — Bachelor of Science, Accounting — 2013',
      ].join('\n'),
    },
    facts: [
      { id: 'close', keywords: ['close', 'month-end', 'day', 'division'], text: finFacts.close },
      { id: 'controls', keywords: ['controls', 'audits', 'findings', 'programme'], text: finFacts.controls },
      { id: 'team', keywords: ['lead', 'accountants', 'locations', 'calendar'], text: finFacts.team },
      { id: 'revrec', keywords: ['revenue', 'asc 606', 'netsuite', 'recognition'], text: finFacts.revrec },
      { id: 'billing', keywords: ['billing', 'contracts', 'migration', 'netsuite'], text: finFacts.billing },
      { id: 'audit', keywords: ['audit', 'narratives', 'controls', 'system'], text: finFacts.audit },
      { id: 'recon', keywords: ['reconciliations', 'receivables', 'deferred', 'quarterly'], text: finFacts.recon },
      { id: 'cert', section: 'Certifications', keywords: ['cpa', 'certified', 'ohio', 'license'], text: finFacts.cert },
    ],
    absent: [{ id: 'public-accounting', keywords: ['big 4 experience', 'public accounting experience', 'audit firm experience', 'worked at an audit firm'], text: "I haven't worked in public accounting; all my roles have been in industry." }],
    voice: { banned, firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'holdout2-sre-observability',
    name: 'Dmitri Halloway',
    employer: 'Example Media Cloud',
    title: 'Staff Software Engineer, Developer Experience',
    dates: '2022 to 2026',
    records: [
      { employer: 'Example Media Cloud', title: 'Staff Software Engineer, Developer Experience' },
      { employer: 'Example Payments Network', title: 'Site Reliability Engineer' },
      { employer: 'Example Hosting Works', title: 'Linux Systems Administrator' },
    ],
    level: 'professional',
    degree: 'bachelor-science',
    degreeLabel: 'Bachelor of Science',
    educationEvidence: 'Example University — Bachelor of Science, Computer Engineering — 2012',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion', age18: 'yes' },
    credentialFact: 'cert',
    experienceBand: '10-plus',
    profile: {
      ...emptyProfile(),
      name: 'Dmitri Halloway',
      email: 'dmitri@example.invalid',
      phone: '+1 512 555 0162',
      location: 'Austin, US',
      timezone: 'America/Chicago',
      roles: 'Site reliability engineer, platform and developer tooling',
      compensation: 'Target range: $185,000 to $205,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2012',
      links: 'https://example.invalid/dmitri',
      voice: 'Direct first-person writing. Name the system and the measured result. Avoid passionate, leverage and cutting-edge.',
      story: 'I ran payments reliability for five years and have built developer and observability tooling since 2022.',
      resume: [
        contact('Dmitri Halloway', 'dmitri@example.invalid', '+1 512 555 0162', 'Austin, US'),
        '',
        'Infrastructure engineer: reliability first, developer tooling since 2022.',
        '',
        'Experience',
        'Example Media Cloud — Staff Software Engineer, Developer Experience — 2022 to 2026',
        sreFacts.observability,
        sreFacts.cli,
        'Example Payments Network — Site Reliability Engineer — 2017 to 2022',
        sreFacts.slo,
        sreFacts.incident,
        sreFacts.oncall,
        'Example Hosting Works — Linux Systems Administrator — 2013 to 2017',
        sreFacts.ansible,
        '',
        'Certifications',
        sreFacts.cert,
        '',
        'Education',
        'Example University — Bachelor of Science, Computer Engineering — 2012',
      ].join('\n'),
    },
    facts: [
      { id: 'observability', keywords: ['observability', 'tracing', 'metrics', 'incidents'], text: sreFacts.observability },
      { id: 'cli', keywords: ['tool', 'template', 'developers', 'maintain'], text: sreFacts.cli },
      { id: 'slo', keywords: ['slo', 'service level objectives', 'incident rate', 'services'], text: sreFacts.slo },
      { id: 'incident', keywords: ['incident commander', 'incidents', 'review', 'rollout'], text: sreFacts.incident },
      { id: 'oncall', keywords: ['on-call', 'payments', 'handoff', 'regions'], text: sreFacts.oncall },
      { id: 'ansible', keywords: ['ansible', 'automated', 'rebuild', 'servers'], text: sreFacts.ansible },
      { id: 'cert', section: 'Certifications', keywords: ['cks', 'kubernetes', 'certified', 'security'], text: sreFacts.cert },
    ],
    absent: [{ id: 'model-training', keywords: ['trained production models', 'model training experience', 'published ml research', 'research scientist experience'], text: "I haven't trained models myself; I build the platform teams use." }],
    voice: { banned, firstPerson: true },
    allowNoNumber: false,
  },
  {
    id: 'holdout2-stem-assay',
    name: 'Hana Szabo',
    employer: 'Example Bioinstruments',
    title: 'Applications Scientist',
    dates: '2025 to 2026',
    records: [
      { employer: 'Example Bioinstruments', title: 'Applications Scientist' },
      { employer: 'Example Genomics Lab', title: 'Senior Research Associate' },
      { employer: 'Example Cell Analysis', title: 'Research Technician' },
    ],
    level: 'professional',
    degree: 'master-science',
    degreeLabel: 'Master of Science',
    educationEvidence: 'Example University — Master of Science, Molecular Biology — 2012',
    candidateAnswers: { authorization: 'yes', attest: true, salary: 'Open to discussion', age18: 'yes' },
    credentialFact: 'cert',
    experienceBand: '6-10',
    profile: {
      ...emptyProfile(),
      name: 'Hana Szabo',
      email: 'hana@example.invalid',
      phone: '+1 919 555 0163',
      location: 'Raleigh, US',
      timezone: 'America/New_York',
      roles: 'Assay development scientist, lab automation',
      compensation: 'Target range: $130,000 to $145,000',
      eligibility: 'Authorized to work in the United States without sponsorship',
      graduation: '2012',
      links: 'https://example.invalid/hana',
      voice: 'Careful, specific first-person writing. Say what was measured and what changed. Avoid passionate, leverage and cutting-edge.',
      // No bare year here: the journey row builds its profile in conversation, so the
      // sources hold the seeded CV, not this sentence. A number only this sentence states
      // could not be grounded, and that failure would measure the fixture, not the app.
      story: 'I spent a decade at the bench developing assays, took two years away for family care, and now support customers from an instrument vendor.',
      resume: [
        contact('Hana Szabo', 'hana@example.invalid', '+1 919 555 0163', 'Raleigh, US'),
        '',
        'Assay development scientist who came up through cell biology and lab automation.',
        '',
        'Experience',
        'Example Bioinstruments — Applications Scientist — 2025 to 2026',
        stemFacts.demos,
        'Example Genomics Lab — Senior Research Associate — 2016 to 2023',
        stemFacts.assay,
        stemFacts.automation,
        stemFacts.lims,
        'Example Cell Analysis — Research Technician — 2012 to 2016',
        stemFacts.culture,
        '',
        'Certifications',
        stemFacts.cert,
        '',
        'Education',
        'Example University — Master of Science, Molecular Biology — 2012',
      ].join('\n'),
    },
    facts: [
      { id: 'assay', keywords: ['assay', 'potency', 'turnaround', 'programmes'], text: stemFacts.assay },
      { id: 'automation', keywords: ['automated', 'liquid-handling', 'throughput', 'robot'], text: stemFacts.automation },
      { id: 'lims', keywords: ['lims', 'tracked', 'plate', 'workflow'], text: stemFacts.lims },
      { id: 'culture', keywords: ['cell culture', 'quality control', 'panel', 'lines'], text: stemFacts.culture },
      { id: 'demos', keywords: ['demonstrations', 'training', 'customers', 'applications'], text: stemFacts.demos },
      { id: 'cert', section: 'Certifications', keywords: ['six sigma', 'green belt', 'lean'], text: stemFacts.cert },
    ],
    absent: [{ id: 'gmp', keywords: ['gmp manufacturing experience', 'worked in a gmp facility', 'gmp batch release experience', 'validated a gmp process'], text: "I haven't worked in a GMP manufacturing facility; my labs have been research and early development." }],
    voice: { banned, firstPerson: true },
    allowNoNumber: false,
  },
];

export const holdout2Jobs = [
  // Old-role tailoring, run under both roleOrder settings. Two required facts sit in
  // the older revenue systems role and one in the current controller role, so the
  // newer role is worth keeping: `recent` puts it first on purpose, `match` puts the
  // role that holds more of the required facts first.
  {
    id: 'holdout2-job-fin-revenue',
    company: 'Fictional Brokerage Cloud',
    title: 'Revenue Systems Manager',
    location: 'Columbus, US',
    requiredFactIds: ['revrec', 'audit', 'close'],
    retainFactIds: ['recon'],
    atsTerms: ['ASC 606', 'revenue recognition', 'NetSuite', 'month-end close', 'reconciliation'],
    description: 'Fictional Brokerage Cloud seeks a revenue systems manager in Columbus to own revenue recognition under ASC 606, run the NetSuite revenue configuration, and shorten the month-end close. The role partners with the external audit team, and the monthly close still includes balance sheet reconciliations. CPA required.',
  },
  // The same shape in infrastructure: two required facts in the older SRE role, one
  // in the newer developer-experience role.
  {
    id: 'holdout2-job-tech-observability',
    company: 'Fictional Ticket Marketplace',
    title: 'Senior Site Reliability Engineer, Observability',
    location: 'Austin, US',
    requiredFactIds: ['slo', 'incident', 'observability'],
    retainFactIds: ['oncall'],
    atsTerms: ['SLOs', 'incident command', 'tracing', 'on-call', 'Kubernetes'],
    description: 'Fictional Ticket Marketplace seeks a senior site reliability engineer for its observability team in Austin. Define SLOs for the ticketing services, act as incident commander, and improve the tracing and metrics pipelines the product teams rely on. Share on-call across regions; Kubernetes experience is a plus.',
  },
  // The newer role has nothing this job needs. It is dropped, or kept as one short
  // line when dropping it would leave the dates unexplained (2023 to 2025 here).
  {
    id: 'holdout2-job-stem-assay',
    company: 'Fictional Biologics',
    title: 'Senior Assay Development Scientist',
    location: 'Raleigh, US',
    requiredFactIds: ['assay', 'automation', 'lims'],
    atsTerms: ['assay development', 'automation', 'LIMS', 'throughput', 'Six Sigma'],
    description: 'Fictional Biologics seeks a senior assay development scientist in Raleigh. Develop and validate cell-based potency assays, automate sample handling to raise throughput, and connect the workflow to the laboratory information management system. Process improvement training such as Six Sigma is valued.',
  },
  // Zero-match Skip: nothing in this persona's field is behind the posting.
  {
    id: 'holdout2-job-skip-aero',
    company: 'Fictional Aero Structures',
    title: 'Senior Stress Analysis Engineer',
    location: 'Wichita, US',
    requiredFactIds: ['close'],
    atsTerms: ['finite element analysis', 'airframe', 'CATIA', 'damage tolerance'],
    expectRecommendation: 'Skip',
    maxScore: 3.5,
    description: 'Fictional Aero Structures seeks a senior stress analysis engineer in Wichita. Perform finite element analysis of airframe structures, build CATIA models, and support structural certification with damage tolerance assessments.',
  },
  // Borderline (partial evidence): one required fact this persona does not have at all.
  {
    id: 'holdout2-job-borderline-gmp',
    company: 'Fictional Sterile Manufacturing',
    title: 'Senior Scientist, GMP Analytical Development',
    location: 'Raleigh, US',
    requiredFactIds: ['assay', 'automation', 'gmp'],
    atsTerms: ['cell-based potency assay', 'automation', 'release testing', 'quality management system'],
    expectRecommendation: 'Investigate',
    scoreBand: { min: 3.0, max: 3.9 },
    description: 'Fictional Sterile Manufacturing seeks a senior scientist for analytical development in Raleigh. Develop and validate cell-based potency assays, automate sample handling, and support release testing under a quality management system. Experience in a regulated manufacturing environment is required.',
  },
];

export const holdout2Scenarios = [
  // The same job twice per persona: the order the candidate set is the only difference,
  // so a verdict that flips between these two rows is the order gate and nothing else.
  { id: 'holdout2-oldrole-fin-recent', family: 'resume', persona: 'holdout2-fin-close', job: 'holdout2-job-fin-revenue', withStandard: true, holdout: true, holdoutSet: 2, roleOrder: 'recent', evaluationGate: false },
  { id: 'holdout2-oldrole-fin-match', family: 'resume', persona: 'holdout2-fin-close', job: 'holdout2-job-fin-revenue', withStandard: true, holdout: true, holdoutSet: 2, roleOrder: 'match', evaluationGate: false },
  { id: 'holdout2-oldrole-tech-recent', family: 'resume', persona: 'holdout2-sre-observability', job: 'holdout2-job-tech-observability', withStandard: true, holdout: true, holdoutSet: 2, roleOrder: 'recent', evaluationGate: false },
  { id: 'holdout2-oldrole-tech-match', family: 'resume', persona: 'holdout2-sre-observability', job: 'holdout2-job-tech-observability', withStandard: true, holdout: true, holdoutSet: 2, roleOrder: 'match', evaluationGate: false },
  // A newer role with nothing the job needs.
  { id: 'holdout2-newer-unrelated-stem', family: 'resume', persona: 'holdout2-stem-assay', job: 'holdout2-job-stem-assay', withStandard: true, holdout: true, holdoutSet: 2, roleOrder: 'recent', evaluationGate: false },
  // Decisions: an honest Skip with no matches, and a borderline Investigate in band.
  { id: 'holdout2-skip-aero', family: 'evaluation', persona: 'holdout2-fin-close', job: 'holdout2-job-skip-aero', holdout: true, holdoutSet: 2 },
  { id: 'holdout2-borderline-gmp', family: 'evaluation', persona: 'holdout2-stem-assay', job: 'holdout2-job-borderline-gmp', holdout: true, holdoutSet: 2 },
  // End to end, from the first conversation to a confirmed submission.
  { id: 'holdout2-journey-stem', family: 'journey', persona: 'holdout2-stem-assay', job: 'holdout2-job-stem-assay', portal: 'lever-single', holdout: true, holdoutSet: 2, roleOrder: 'recent' },
];
