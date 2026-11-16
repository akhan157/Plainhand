#!/usr/bin/env node
// Offline re-score of a saved evidence directory with the current scorer (scorer v3).
// Zero model calls, zero PDF renders, and no writes to the evidence it reads: the
// recorded verdict stays exactly as it was produced, and the current one is reported
// beside it.
//
//   node scripts/rescore.mjs output/baseline-00ce1bf
//   node scripts/rescore.mjs output/baseline-00ce1bf --out /tmp/rescore.md
//
// What is re-computed, and what is not:
//   role order       - recomputed from the saved packet. v3 replaced the lead-share
//                      gate with a role-order gate keyed on the run's roleOrder, and a
//                      saved packet still holds every heading and its dates, so the
//                      order is scored again rather than carried. Ordering by
//                      settings.roleOrder arrived with U04, so a run recorded before
//                      that setting existed is re-scored as the product default
//                      (`recent`), and the row says so.
//   evaluation gate  - recomputed when the record lists no matches (the zero-match
//                      Skip rule is the v2 change). Rows that list matches carry their
//                      recorded verdict: the rule for a present match is byte-identical,
//                      and the raw matches and quotes are not saved.
//   resume-coverage  - recomputed from the saved line texts and the saved packet, with
//     reading-order    the same rules pdfEvidence uses. No PDF is parsed again.
//   poppler, cover   - carried from v1 where they passed. Where v1 failed them they are
//                      `unscorable`: their extracted text was not saved, so the same
//                      repeated-wording cause cannot be re-tested offline.
//   everything else  - carried from the recorded verdict and labelled as such (v3
//                      changes the resume gates only, not the profile or the form).
// The job and persona objects come from the corpus at the current commit: that is where
// the Skip band and the posting vocabulary are read from, so a corpus change since the
// run is drift, and the report says so.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scoreEvaluation, scorePacket, SCORER_VERSION } from '../plainhand/evaluation/score.mjs';
import { textLayerChecks } from '../plainhand/evaluation/pdf-evidence.mjs';
import { jobById, personaById } from '../plainhand/evaluation/corpus.mjs';

const argv = process.argv.slice(2);
const flag = name => { const index = argv.indexOf('--' + name); return index < 0 ? null : argv[index + 1]; };
const outFile = flag('out');
const jsonFile = flag('json');
const valueIndexes = new Set(['out', 'json'].map(name => argv.indexOf('--' + name)).filter(index => index >= 0).map(index => index + 1));
const roots = argv.filter((value, index) => !value.startsWith('--') && !valueIndexes.has(index));
if (!roots.length) {
  console.error('Usage: node scripts/rescore.mjs <evidence-dir|root> [--out <file.md>] [--json <file.json>]');
  process.exit(2);
}

const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const label = state => state === 'pass' ? 'pass' : state === 'fail' ? 'FAIL' : state === 'carried' ? 'carried' : state === 'unchanged' ? 'unchanged' : state === 'absent' ? 'absent' : 'UNSCORABLE';
const row = (id, v1, v2, state, note = '') => ({ id, v1, v2, state, note });

// A saved root may hold one run or several (the baseline writes paired/ and smoke/).
async function evidenceDirs(root) {
  if (!(await exists(root))) throw new Error(`No such evidence directory: ${root}`);
  if (await exists(path.join(root, 'results.json'))) return [root];
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (await exists(path.join(dir, 'results.json'))) dirs.push(dir);
  }
  return dirs.sort();
}

const checkOf = (evidence, id) => (evidence?.checks || []).find(check => check.id === id) || null;
const safeJob = id => { try { return id ? jobById(id) : null; } catch { return null; } };
const safePersona = id => { try { return id ? personaById(id) : null; } catch { return null; } };

// What the packet verdict rests on now, including the gate that changed in v3. The
// order is read from the saved packet, never from the recorded summary, and the
// recorded lead share is kept beside it so the old expectation stays visible.
function packetNote(packet, record) {
  const tailoring = packet.tailoring || {};
  const parts = [
    `fact coverage ${packet.factCoverage}`,
    `review ${packet.reviewPassed}`,
    `numbers ${packet.unsupportedNumbers.length} unsupported`,
    `pdf ${packet.pdfState}`,
    `role order ${tailoring.roleOrderOk ? 'ok' : tailoring.roleOrderReason} (${tailoring.roleOrder || 'recent'})`,
    `kept roles ${(tailoring.roles || []).map(role => role.start ?? '?').join(' > ') || 'none'}`,
    `lead share recorded/now ${record.packet.leadShare ?? 'n/a'}/${tailoring.leadShare ?? 'n/a'}`,
  ];
  if (tailoring.droppedRequiredRoles?.length) parts.push(`dropped a role holding a required fact: ${tailoring.droppedRequiredRoles.map(role => role.heading).join('; ')}`);
  if (tailoring.unparseableRoles?.length) parts.push(`${tailoring.unparseableRoles.length} role heading(s) with unreadable dates`);
  return parts.join(', ');
}

// The v2 PDF verdict, from the saved extraction. The rendered bytes are not saved, so
// the parse is not repeated; the line-order rules are.
async function rescorePdf(dir, id, scenario, record) {
  if (!record.packet) return null;
  const evidence = await readJson(path.join(dir, `${id}.pdf-evidence.json`));
  const packetFile = await readJson(path.join(dir, `${id}.packet.json`));
  if (!evidence || !Array.isArray(evidence.lines)) return { checks: [row('rendered-pdf', 'unknown', 'unscorable', 'no saved extraction')], visible: false };
  if (!packetFile?.packet) return { checks: [row('rendered-pdf', evidence.state ?? 'unknown', 'unscorable', 'no saved packet')], visible: false };
  const v2 = textLayerChecks({ packet: packetFile.packet, lines: evidence.lines });
  const coverageOk = v2.coverage.ok;
  const orderOk = v2.order.ok && !v2.interleaved.length && v2.coverage.reordered.length === 0;
  // The checks v2 does not change keep their v1 status, so a row whose only v1 failure
  // was the line order can still be reported as a pass.
  const carried = ['parse', 'text-layer', 'garbled', 'contact', 'layout', 'ats'].map(checkId => checkOf(evidence, checkId)).filter(Boolean);
  const poppler = checkOf(evidence, 'poppler-cross-check');
  const cover = checkOf(evidence, 'cover');
  const unscorable = [];
  if (poppler?.status === 'fail') unscorable.push('poppler-cross-check (its extracted text was not saved)');
  if (cover?.status === 'fail') unscorable.push('cover (its extracted text was not saved)');
  // A synthesized v2 evidence object: recomputed line checks, carried others, and no
  // unscorable check, so scorePacket answers "what if the unscorable tier passes".
  const checks = [
    ...carried.map(check => ({ ...check })),
    { id: 'resume-coverage', label: 'Resume coverage', status: coverageOk ? 'pass' : 'fail', detail: coverageOk ? `Every visible resume line is in the text layer, in order (lowest coverage ${v2.coverage.lowestCoverage}).` : [...v2.coverage.missing, ...v2.coverage.reordered].join('; ') },
    { id: 'reading-order', label: 'Reading order', status: orderOk ? 'pass' : 'fail', detail: `${v2.order.detail}${v2.interleaved.length ? ` Interleaved lines: ${v2.interleaved.join('; ')}.` : ''}${v2.coverage.reordered.length ? ` Reordered within a section: ${v2.coverage.reordered.join('; ')}.` : ''}` },
    ...(poppler?.status === 'pass' ? [poppler] : []),
    ...(cover && cover.status !== 'fail' ? [cover] : []),
  ];
  const synthesized = { ...evidence, checks };
  // The packet verdict comes from the real scorePacket, with the synthesized evidence.
  const job = safeJob(scenario.job);
  const persona = safePersona(scenario.persona);
  const packet = job && persona ? scorePacket({
    packet: packetFile.packet,
    persona,
    job,
    sources: Array.isArray(packetFile.sources) ? packetFile.sources : [],
    review: { passed: record.packet.reviewPassed === true, issues: [] },
    calibration: record.packet.calibration,
    pdf: { evidence: synthesized, bytes: null, head: null },
    packetQuestionsAsked: record.packet.questionsAsked || [],
    roleAnswered: Boolean(record.packet.roleAnswered),
    expectTailoring: Boolean(scenario.withStandard),
    roleOrder: scenario.roleOrder,
  }) : null;
  return {
    checks: [
      ...carried.map(check => row(check.id, check.status, check.status === 'pass' ? 'carried' : 'fail')),
      row('resume-coverage', checkOf(evidence, 'resume-coverage')?.status, coverageOk ? 'pass' : 'fail'),
      row('reading-order', checkOf(evidence, 'reading-order')?.status, orderOk ? 'pass' : 'fail'),
      row('poppler-cross-check', poppler?.status ?? 'absent', !poppler ? 'unscorable' : poppler.status === 'fail' ? 'unscorable' : 'carried', poppler?.status === 'fail' ? 'text not saved' : ''),
      row('cover', cover?.status ?? 'absent', !cover ? 'unscorable' : cover.status === 'fail' ? 'unscorable' : 'carried', cover?.status === 'fail' ? 'text not saved' : ''),
      packet ? row('packet (all gates)', record.packet.pass ? 'pass' : 'fail', packet.pass ? 'pass' : 'fail', 'recomputed', packetNote(packet, record)) : row('packet (all gates)', record.packet.pass ? 'pass' : 'fail', 'unscorable', 'unscorable', 'the persona or job is no longer in the corpus'),
    ],
    unscorable,
  };
}

async function rescoreScenario(dir, record) {
  const scenario = record.scenario || {};
  const checks = [];
  // 1. The evaluation gate. v2 changes the zero-match Skip rule only.
  const recorded = record.evaluation;
  if (recorded) {
    const matchCount = Number.isInteger(recorded.matches) ? recorded.matches : null;
    if (matchCount !== 0) {
      checks.push(row('evaluation', recorded.pass ? 'pass' : 'fail', recorded.pass ? 'carried' : 'fail', `score ${recorded.score ?? 'n/a'}, ${recorded.recommendation ?? 'n/a'}, ${matchCount ?? 'unknown'} match(es); the zero-match rule cannot apply and the matches were not saved`));
    } else {
      const job = safeJob(scenario.job);
      const v2 = job ? scoreEvaluation({ evaluation: { score: recorded.score, recommendation: recorded.modelRecommendation ?? recorded.recommendation, matches: [], gaps: recorded.gaps }, sources: [], job, prepareRefusedWithoutOverride: recorded.prepareRefusedWithoutOverride }) : null;
      checks.push(v2
        ? row('evaluation', recorded.pass ? 'pass' : 'fail', v2.pass ? 'pass' : 'fail', `score ${v2.score ?? 'n/a'}, ${v2.recommendation ?? 'n/a'}, 0 matches, evidence ${v2.evidenceValid ? 'valid' : 'invalid'}${v2.honestZeroMatchSkip ? ' (honest zero-match Skip)' : ''}`)
        : row('evaluation', recorded.pass ? 'pass' : 'fail', 'unscorable', 'the job is no longer in the corpus'));
    }
  }
  // 2. The rendered-PDF line order, recomputed from the saved extraction.
  const pdf = await rescorePdf(dir, scenario.id, scenario, record);
  if (pdf) checks.push(...pdf.checks);
  // 3. The profile gate, when the run built its profile in conversation (a seeded or
  // minimal run has no profile stage and none is invented here).
  if (record.profile) checks.push(row('profile', record.profile.pass ? 'pass' : 'fail', record.profile.pass ? 'carried' : 'fail', `capture ${record.profile.captureRate ?? 'n/a'}, coverage of all facts ${record.profile.coverageOfAllFacts ?? 'n/a'}; v3 does not touch profile scoring`));
  // 4. The application stage: v3 does not score it differently.
  if (record.application) checks.push(row('application', record.application.pass ? 'pass' : 'fail', record.application.pass ? 'carried' : 'fail', 'v3 does not touch application scoring'));
  // A decidable failure decides; then a pass; the saved evidence settles nothing.
  const failed = checks.some(check => check.v2 === 'fail');
  const unscorable = checks.some(check => check.v2 === 'unscorable');
  const v1 = record.pass ? 'PASS' : record.expectedFail ? 'EXPECTED FAIL' : 'FAIL';
  const v2 = failed ? 'fail' : unscorable ? 'unscorable' : 'pass';
  // Only a flip between pass and fail is a change; an expected-fail control that stays
  // failed is not one, and an unscorable row is unknown rather than changed.
  const changed = (v2 === 'pass' && !record.pass) || (v2 === 'fail' && Boolean(record.pass));
  return { id: scenario.id, family: scenario.family || null, v1, v2, changed, checks };
}

async function rescoreDir(dir) {
  const report = await readJson(path.join(dir, 'results.json'));
  if (!report) return null;
  const v1Version = report.scorer?.version ?? report.results?.find(item => item.scorerVersion)?.scorerVersion ?? 1;
  const rows = [];
  for (const record of report.results || []) rows.push(await rescoreScenario(dir, record));
  return { dir, v1Version, rows };
}

const cells = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function table(result) {
  const head = `### ${result.dir}\n\nRecorded scorer version: v${result.v1Version}. Re-scored with v${SCORER_VERSION}.\n\n| Scenario | recorded | v${SCORER_VERSION} rescore | Checks (recorded → v${SCORER_VERSION}) |\n|---|---|---|---|\n`;
  const body = result.rows.map(item => {
    const checks = item.checks.map(check => `${check.id} ${check.v1} → ${label(check.v2)}`).join('<br>');
    return `| ${cells(item.id)} | ${item.v1} | ${item.v2 === 'unscorable' ? 'UNSCORABLE' : item.v2.toUpperCase()} | ${checks} |`;
  }).join('\n');
  return head + body + '\n';
}

function summaryOf(results) {
  const rows = results.flatMap(result => result.rows);
  const count = state => rows.filter(item => item.v2 === state).length;
  return {
    scenarios: rows.length,
    v1Passed: rows.filter(item => item.v1 === 'PASS').length,
    v1ExpectedFail: rows.filter(item => item.v1 === 'EXPECTED FAIL').length,
    v2Passed: count('pass'),
    v2Failed: count('fail'),
    v2Unscorable: count('unscorable'),
    changed: rows.filter(item => item.changed).length,
    changedIds: rows.filter(item => item.changed).map(item => `${item.id} (${item.v1} → ${item.v2 === 'unscorable' ? 'UNSCORABLE' : item.v2.toUpperCase()})`),
  };
}

const inEvidenceDir = (file, dirs) => dirs.some(dir => path.resolve(file).startsWith(path.resolve(dir) + path.sep));
const main = async () => {
  const dirs = [];
  for (const root of roots) dirs.push(...await evidenceDirs(root));
  if (!dirs.length) throw new Error(`No results.json under: ${roots.join(', ')}`);
  // The evidence is never overwritten, and the report is never written into it.
  for (const file of [outFile, jsonFile].filter(Boolean)) {
    if (inEvidenceDir(file, dirs) || dirs.some(dir => path.resolve(file) === path.resolve(dir))) throw new Error(`Refusing to write into the evidence directory: ${file}`);
  }
  const results = [];
  for (const dir of dirs) results.push(await rescoreDir(dir));
  const summary = summaryOf(results);
  const markdown = `# Offline re-score with scorer v${SCORER_VERSION}\n\nZero model calls. The recorded evidence is read only; nothing is overwritten. Where the saved\nitems do not settle a check, it is reported as unscorable rather than assumed. Job and\npersona definitions come from the corpus at this commit, not from the recorded run.\n\n${results.map(table).join('\n')}\n## Summary\n\n| | Count |\n|---|---|\n| Scenarios | ${summary.scenarios} |\n| Recorded pass | ${summary.v1Passed} (plus ${summary.v1ExpectedFail} expected-failure controls) |\n| v${SCORER_VERSION} rescore pass | ${summary.v2Passed} |\n| v${SCORER_VERSION} rescore fail | ${summary.v2Failed} |\n| v${SCORER_VERSION} unscorable | ${summary.v2Unscorable} |\n| Rows whose verdict changed | ${summary.changed} |\n\n${summary.changedIds.length ? summary.changedIds.map(id => `- ${id}`).join('\n') + '\n' : ''}`;
  console.log(markdown);
  if (outFile) await writeFile(outFile, markdown);
  if (jsonFile) await writeFile(jsonFile, JSON.stringify({ scorerVersion: SCORER_VERSION, dirs: results.map(result => result.dir), sources: roots, summary, results }, null, 2));
  return { summary, results };
};

try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
