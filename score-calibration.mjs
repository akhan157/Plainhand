// Score-band calibration from real application outcomes. It refuses to imply
// signal from too few outcomes; the warning is part of the report, not a console note.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MINIMUM = 20;
const OUTCOMES = new Set(['Interview', 'Offer', 'Rejected']);
const bands = score => score >= 4.5 ? '4.5-5.0' : score >= 4.0 ? '4.0-4.4' : score >= 3.5 ? '3.5-3.9' : '<3.5';
const rank = { '<3.5': 0, '3.5-3.9': 1, '4.0-4.4': 2, '4.5-5.0': 3 };

export function calibrate(state, { minimum = DEFAULT_MINIMUM } = {}) {
  const rows = (state.jobs || [])
    .filter(job => job.evaluation && typeof job.evaluation.score === 'number')
    .map(job => ({ id: job.id, company: job.company, title: job.title, score: job.evaluation.score, band: bands(job.evaluation.score), status: job.status || 'Evaluated', applied: Boolean(job.submittedAt) || ['Applied', 'Interview', 'Offer', 'Rejected', 'Responded'].includes(job.status) }));
  const groups = {};
  for (const row of rows) {
    const group = groups[row.band] ||= { band: row.band, evaluated: 0, applied: 0, interviews: 0, offers: 0, rejections: 0, pending: 0 };
    group.evaluated++;
    if (!row.applied) continue;
    group.applied++;
    if (row.status === 'Interview') group.interviews++;
    else if (row.status === 'Offer') group.offers++;
    else if (row.status === 'Rejected') group.rejections++;
    else group.pending++;
  }
  const outcomeRows = rows.filter(row => OUTCOMES.has(row.status));
  const sufficient = outcomeRows.length >= minimum;
  return {
    generatedAt: new Date().toISOString(),
    sufficientData: sufficient,
    minimum,
    outcomesObserved: outcomeRows.length,
    evaluated: rows.length,
    applied: rows.filter(row => row.applied).length,
    warning: sufficient ? null : `Only ${outcomeRows.length} of the ${minimum} required outcomes exist. Treat every rate below as provisional; the system cannot show that score bands predict interviews yet.`,
    // Rates use resolved outcomes only: a pending application is not a rejection.
    bands: Object.values(groups).sort((a, b) => rank[b.band] - rank[a.band]).map(group => {
      const resolved = group.interviews + group.offers + group.rejections;
      return {
        ...group,
        resolved,
        interviewRate: resolved ? +(group.interviews / resolved).toFixed(3) : null,
        offerRate: resolved ? +(group.offers / resolved).toFixed(3) : null,
      };
    }),
    rows: rows.map(({ company, title, score, band, status, applied }) => ({ company, title, score, band, status, applied })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { Workspace } = await import('./plainhand/store.mjs');
  const root = process.argv.includes('--data-root') ? process.argv[process.argv.indexOf('--data-root') + 1] : process.cwd();
  const state = await new Workspace(root).load();
  const report = calibrate(state);
  const directory = path.join('output', 'calibration-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(directory, 'SUMMARY.md'), [
    `# Score-band calibration — ${report.generatedAt}`,
    '',
    report.sufficientData ? 'Enough outcomes to compare bands.' : `**Insufficient data.** ${report.warning}`,
    '',
    `Evaluated: ${report.evaluated} · Applied: ${report.applied} · Outcomes: ${report.outcomesObserved} (minimum ${report.minimum})`,
    '',
    '| Band | Evaluated | Applied | Interviews | Offers | Rejections | Interview rate |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.bands.map(band => `| ${band.band} | ${band.evaluated} | ${band.applied} | ${band.interviews} | ${band.offers} | ${band.rejections} | ${band.interviewRate == null ? '—' : (band.interviewRate * 100).toFixed(0) + '%'} |`),
  ].join('\n'));
  console.log(report.sufficientData ? 'Calibration report written.' : `Insufficient data: ${report.warning}`);
  console.log(`Report: ${directory}`);
}
