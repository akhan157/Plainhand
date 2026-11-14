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
  c('nurse', 'balanced', 'Cared for five to six patients per shift on a 32-bed medical-surgical unit.', 'I care for five to six patients per shift on a 32-bed medical-surgical unit', 'faithful'),
  c('nurse', 'balanced', 'Registered Nurse (Telemetry), Example Regional Hospital: monitored cardiac telemetry for my patients.', 'Registered Nurse, Example Regional Hospital, medical-surgical unit', 'official title kept, honest functional title in parentheses'),
  c('nurse', 'undersold', 'Helped with fall prevention on the unit.', 'I led our unit’s fall-prevention huddle for a year, and patient falls dropped from 9 to 4', 'drops leading the huddle and the 9-to-4 result'),
  c('nurse', 'stretched', 'Led the hospital-wide fall-prevention program.', 'I led our unit’s fall-prevention huddle for a year', 'one unit to the whole hospital'),
  c('nurse', 'stretched', 'Cut patient falls 60% with a fall-prevention program I created.', 'patient falls dropped from 9 to 4 between 2024 and 2025', 'led a huddle to created a program; 56% rounded up'),
  c('nurse', 'unsupported', 'Two years of ICU experience.', 'I haven’t worked in an ICU; my critical care exposure was one clinical rotation', 'the candidate said they have not done this'),
  c('apprentice', 'balanced', 'Bent and ran EMT conduit and pulled wire on commercial jobs; logged 5,600 on-the-job hours.', 'I bend and run EMT conduit and pull wire on commercial jobs, and I have logged 5,600 on-the-job hours', 'faithful'),
  c('apprentice', 'undersold', 'Assisted with electrical work.', 'I helped install and label a 400-amp panel upgrade for a 30-unit apartment building', 'drops the 400-amp panel upgrade and the 30-unit building'),
  c('apprentice', 'undersold', 'Kept safety records for the crew.', 'I keep my crew’s lockout/tagout log, and our crew went 2 years without a recordable injury', 'drops lockout/tagout and two years without a recordable injury'),
  c('apprentice', 'stretched', 'Installed a 400-amp panel upgrade for a 30-unit apartment building.', 'I helped install and label a 400-amp panel upgrade for a 30-unit apartment building, working under a licensed journeyman', 'helped under a journeyman to did it alone'),
  c('apprentice', 'unsupported', 'Electrician, Example Electric Co, 2023 to 2026.', 'Electrical Apprentice, Example Electric Co, 2023 to 2026', 'apprentice presented as an electrician: verifiable title raised'),
  c('apprentice', 'unsupported', 'Licensed journeyman electrician.', 'I do not have my journeyman license yet', 'the candidate said they have not done this'),
  c('retail-lead', 'balanced', 'Ran the evening shift for 14 cashiers and stockers at a store with about $90,000 in weekly sales.', 'I run the evening shift for a team of 14 cashiers and stockers at a store that does about $90,000 in weekly sales', 'faithful'),
  c('retail-lead', 'balanced', 'Trained 20 new hires on register and opening procedures over two years.', 'I trained 20 new hires on the register and opening procedures in the last two years', 'faithful'),
  c('retail-lead', 'undersold', 'Worked on inventory.', 'I reorganized our receiving checklist, and inventory shrink fell from 2.1% to 1.4% over six months', 'drops the checklist redesign and the shrink result'),
  c('retail-lead', 'stretched', 'Cut inventory shrink by about 35% by reorganizing the receiving checklist.', 'inventory shrink fell from 2.1% to 1.4% over six months', 'a third rounded up and stated as rounding: a stretch the market norm allows'),
  c('retail-lead', 'unsupported', 'Managed a $90,000 weekly store budget.', 'a store that does about $90,000 in weekly sales', 'weekly sales presented as a budget the candidate managed'),
  c('retail-lead', 'unsupported', 'Hired and onboarded 20 employees.', 'I haven’t made hiring or firing decisions; the store manager does that', 'the candidate said they have not done this'),
];
