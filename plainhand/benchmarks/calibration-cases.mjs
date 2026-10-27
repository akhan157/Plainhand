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
  c('mech-grad', 'balanced', 'Wrote an impeller-wear test procedure at Example Pumps that the lab still uses; ran 40 bench tests on it.', 'I wrote a test procedure for impeller wear that the lab still uses, and I ran 40 bench tests on it', 'faithful'),
  c('mech-grad', 'balanced', 'Coordinated three sophomores on the Formula SAE suspension sub-team and ran weekly design reviews.', 'I coordinated three sophomores on the suspension sub-team and ran our weekly design reviews', 'faithful'),
  c('mech-grad', 'undersold', 'Worked on the rear upright for the Formula SAE team.', 'redesigned the rear upright in SolidWorks and cut its weight by 18%', 'drops the redesign ownership and the 18% result'),
  c('mech-grad', 'undersold', 'Helped with test procedures at Example Pumps.', 'I wrote a test procedure for impeller wear that the lab still uses', 'wrote it and it is still used; "helped" undersells'),
  c('mech-grad', 'undersold', 'Some familiarity with SolidWorks.', 'I use SolidWorks every day', 'daily use described as familiarity'),
  c('mech-grad', 'stretched', 'Led the Formula SAE suspension sub-team.', 'I coordinated three sophomores on the suspension sub-team', 'coordinated to led'),
  c('mech-grad', 'stretched', 'Expert in ANSYS finite element analysis.', 'ANSYS for basic FEA', 'basic to expert'),
  c('mech-grad', 'stretched', 'Wrote the impeller-wear test procedure adopted across Example Pumps’ labs.', 'I wrote a test procedure for impeller wear that the lab still uses', 'one lab to all labs'),
  c('mech-grad', 'stretched', 'Cut upright weight by nearly 20% through a SolidWorks redesign.', 'redesigned the rear upright in SolidWorks and cut its weight by 18%', 'rounded up'),
  c('mech-grad', 'unsupported', 'Managed a $50,000 Formula SAE budget.', 'On Formula SAE I redesigned the rear upright', 'invented responsibility and number'),
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
  c('mech-grad', 'balanced', 'Engineering Intern (Test Engineering), Example Pumps, summer 2026: wrote an impeller-wear test procedure.', 'Intern, Example Pumps (summer 2026)', 'official title kept, honest functional title in parentheses'),
  c('mech-grad', 'unsupported', 'Test Engineer, Example Pumps, 2026.', 'Intern, Example Pumps (summer 2026)', 'intern presented as an engineer: verifiable title raised'),
  c('mech-grad', 'stretched', 'Cut rear upright weight by about 20% through a SolidWorks redesign.', 'redesigned the rear upright in SolidWorks and cut its weight by 18%', 'rounding stated as rounding: a stretch the market norm allows'),
  c('quiet-junior', 'unsupported', 'Maintained production services and joined the on-call rotation.', 'I haven’t worked on a production system at a company yet', 'the candidate said they have not done this'),
];
