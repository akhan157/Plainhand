// Labelled claims for the claim-calibration benchmark. Sources are the fictional
// profile-benchmark personas; each claim cites an exact quote and carries the rating a
// careful human reviewer would give. Several cases need judgment the rule checks can't
// make (scope, causation, frequency, titles, denied experience).
import { personas } from './profile-bench.mjs';

export function sourcesFor(personaId) {
  const p = personas.find(x => x.id === personaId);
  return [
    { id: 'cv', text: p.profile.resume },
    { id: 'interview', text: [...p.facts.flatMap(f => [f.text, f.detail]), ...p.absent.map(a => a.text)].filter(Boolean).join('\n\n') },
  ];
}

const c = (persona, expected, text, quote, note) => ({ persona, expected, text, quote, note });
export const cases = [
  c('mech-grad', 'balanced', 'Cut rear upright weight 18% in a SolidWorks redesign for Formula SAE while passing the same load tests.', 'redesigned the rear upright in SolidWorks and cut its weight by 18%', 'faithful reframing'),
  c('mech-grad', 'undersold', 'Worked on the rear upright for the Formula SAE team.', 'redesigned the rear upright in SolidWorks and cut its weight by 18%', 'drops the redesign ownership and the 18% result'),
  c('mech-grad', 'undersold', 'Some familiarity with SolidWorks.', 'I use SolidWorks every day', 'daily use described as familiarity'),
  c('mech-grad', 'stretched', 'Led the Formula SAE suspension sub-team.', 'I coordinated three sophomores on the suspension sub-team', 'coordinated to led'),
  c('mech-grad', 'stretched', 'Expert in ANSYS finite element analysis.', 'ANSYS for basic FEA', 'basic to expert'),
  c('mech-grad', 'stretched', 'Cut upright weight by nearly 20% through a SolidWorks redesign.', 'redesigned the rear upright in SolidWorks and cut its weight by 18%', 'rounded up'),
  c('mech-grad', 'unsupported', 'Applied production GD&T on a manufacturing line at Example Pumps.', 'I haven’t done production GD&T work, only what we covered in class', 'the candidate said they have not done this'),
  c('career-changer', 'balanced', 'Built a Google Sheets and SQL grade-tracking dashboard that 12 teachers used to spot students falling behind.', 'I built a grade-tracking dashboard in Google Sheets and SQL that 12 teachers at my school used to spot students falling behind', 'faithful'),
  c('career-changer', 'balanced', 'Presented the dashboard results to the district data team.', 'I presented the results to the district data team', 'faithful'),
  c('career-changer', 'undersold', 'Created a spreadsheet to track student grades.', 'I built a grade-tracking dashboard in Google Sheets and SQL that 12 teachers at my school used', 'drops SQL, the 12 teachers and the purpose'),
  c('career-changer', 'stretched', 'Reduced ninth-grade course failures from 14% to 9% with a dashboard I built.', 'After we started using it, course failure rates in ninth grade dropped from 14% to 9% over one year.', 'claims sole causation for a team outcome'),
  c('career-changer', 'stretched', 'Proficient in Python and pandas.', 'I’m learning Python with pandas', 'learning to proficient'),
  c('career-changer', 'unsupported', 'Two years of corporate analytics experience.', 'Six years as a high-school math teacher', 'the candidate said they have not worked in a company'),
  c('quiet-junior', 'balanced', 'Built a TypeScript bus-arrival app used by about 300 people each week.', 'I built a bus-arrival app for my city in TypeScript; about 300 people used it each week last spring', 'faithful'),
  c('quiet-junior', 'balanced', 'Reproduced a daylight-saving timezone bug by faking the system clock in tests, then stored all times in UTC.', 'I reproduced it by faking the system clock in tests, then stored every time in UTC', 'faithful'),
  c('quiet-junior', 'undersold', 'Teaching assistant for intro programming.', 'As a TA I held office hours for 60 students and wrote the debugging guide the course still hands out', 'drops 60 students and the guide'),
  c('quiet-junior', 'stretched', 'Built a bus-arrival app serving 300 daily users.', 'about 300 people used it each week last spring', 'weekly to daily'),
  c('quiet-junior', 'stretched', 'Lead teaching assistant mentoring 60 students.', 'As a TA I held office hours for 60 students', 'TA to lead TA'),
  c('quiet-junior', 'unsupported', 'Maintained production services and joined the on-call rotation.', 'I haven’t worked on a production system at a company yet', 'the candidate said they have not done this'),
  c('fin-analyst', 'balanced', 'Built and maintain the three-statement forecast model for a $240 million business unit in Excel.', 'I built and maintain the three-statement forecast model for a $240 million business unit in Excel', 'faithful'),
  c('fin-analyst', 'balanced', 'Financial Analyst (FP&A), Example Manufacturing Corp: maintain the business unit forecast model.', 'Financial Analyst, Example Manufacturing Corp, 2023 to 2026', 'official title kept, honest functional title in parentheses'),
  c('fin-analyst', 'undersold', 'Helped with monthly reporting.', 'I rebuilt the monthly reporting pack in Power Query, which cut its preparation from 3 days to 1', 'drops the rebuild, the tool and the 3-days-to-1 result'),
  c('fin-analyst', 'stretched', 'Own forecasting for the company.', 'I built and maintain the three-statement forecast model for a $240 million business unit', 'one business unit to the whole company'),
  c('fin-analyst', 'stretched', 'CFA candidate with advanced valuation expertise.', 'I passed CFA Level I in 2024 and I’m registered for Level II', 'Level I passed presented as advanced expertise'),
  c('fin-analyst', 'unsupported', 'Supported two M&A transactions with valuation models.', 'I haven’t worked on M&A deals; my modeling is all internal planning', 'the candidate said they have not done this'),
  c('accountant', 'balanced', 'Own the month-end close for four entities; cut the close from 9 business days to 6.', 'I own the month-end close for four entities and cut the close from 9 business days to 6', 'faithful'),
  c('accountant', 'undersold', 'Assisted with reconciliations.', 'I prepare 45 balance sheet reconciliations each month and cleared a backlog of 120 aged reconciling items', 'drops ownership, the 45 reconciliations and the cleared backlog'),
  c('accountant', 'undersold', 'Supported the annual audit.', 'I am the main contact for our external auditors and prepared the audit schedules for the last two annual audits', 'main contact and preparer described as support'),
  c('accountant', 'stretched', 'Cut the month-end close in half.', 'cut the close from 9 business days to 6', 'a third presented as half'),
  c('accountant', 'unsupported', 'Senior Accountant, Example Logistics Group, 2022 to 2026.', 'Staff Accountant, Example Logistics Group, 2022 to 2026', 'staff accountant presented as senior: verifiable title raised'),
  c('accountant', 'unsupported', 'Prepared 10-K and 10-Q filings.', 'I haven’t done SEC reporting; my company is privately held', 'the candidate said they have not done this'),
  c('scientist', 'balanced', 'Developed a cell-based potency assay that cut turnaround from 5 days to 2, now used across three programs.', 'I developed a cell-based potency assay that cut turnaround from 5 days to 2 and is now used across three programs', 'faithful'),
  c('scientist', 'balanced', 'Wrote 6 flow cytometry SOPs and trained 4 new research associates on them.', 'I wrote 6 SOPs for our flow cytometry workflows and trained 4 new research associates on them', 'faithful'),
  c('scientist', 'undersold', 'Performed data analysis.', 'I built an R pipeline that processes plate-reader data for 30 plates a week and flags failed controls', 'drops the pipeline, the volume and the control checks'),
  c('scientist', 'stretched', 'Cut potency assay turnaround by about 60% with a new cell-based design.', 'cut turnaround from 5 days to 2', 'rounding stated as rounding: a stretch the market norm allows'),
  c('scientist', 'stretched', 'Led CRISPR screening for the cell therapy group.', 'I ran CRISPR knockout screens in primary T cells', 'ran screens to led screening for the group'),
  c('scientist', 'unsupported', 'Three years of GMP manufacturing experience.', 'I haven’t worked in a GMP environment; all my work is research-stage', 'the candidate said they have not done this'),
];
