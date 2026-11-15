// Rendered-PDF evidence for the evaluation scorer (design §6). The controls drive an
// injected extractor so they are deterministic and need no browser; the positive case
// renders a real packet with the product renderer and really parses the bytes. A skip
// is recorded as a skip, never as a pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pdfEvidence, pdfEvidencePassed, pdfEvidenceSummary } from '../plainhand/evaluation/pdf-evidence.mjs';
import { scorePacket } from '../plainhand/evaluation/score.mjs';
import { renderPacket } from '../plainhand/workflow.mjs';

const profile = { name: 'Riley Chen', email: 'riley@example.invalid', phone: '+1 617 555 0100' };
const job = { company: 'Fictional Robotics Co', title: 'Junior Mechanical Design Engineer', description: 'SYNTHETIC TEST JOB. SolidWorks, FEA and prototyping are central.', reportPath: 'reports/1-fictional-robotics.md' };
const sources = [{ id: 'cv', text: 'Riley Chen built SQL reports and cut weight by 18%. Example Pumps, Jun 2026 to Aug 2026. I ran 40 bench tests and caught two bad batches. Graduating in 2027.' }];
const packet = {
  headline: 'Mechanical engineer',
  resume: [
    { section: 'Experience', heading: { title: 'Engineering Intern', org: 'Example Pumps', location: 'Boston', dates: 'Jun 2026 to Aug 2026' }, text: 'At Example Pumps I wrote a test procedure for impeller wear that the lab still uses.' },
    { section: 'Experience', heading: null, text: 'I ran 40 bench tests on it and caught two bad batches before they shipped.' },
    { section: 'Projects', heading: null, text: 'On Formula SAE I redesigned the rear upright in SolidWorks and cut its weight by 18%.' },
  ],
  answers: [],
  coverLetter: 'I am applying for the junior mechanical design engineer role. I am a mechanical engineering student graduating in 2027. I would like to discuss the role.',
};
// The rendered document: header, then the two heading rows, then the entry lines.
const resumeLines = [
  'Riley Chen',
  'riley@example.invalid · +1 617 555 0100',
  'Example Pumps Boston',
  'Engineering Intern Jun 2026 to Aug 2026',
  packet.resume[0].text,
  packet.resume[1].text,
  'PROJECTS',
  packet.resume[2].text,
];
const coverLines = ['Riley Chen', 'riley@example.invalid', ...packet.coverLetter.match(/[^.!?]+[.!?]/g).map(line => line.trim())];

// A pdfjs-shaped extractor over fixed lines, so each control changes exactly one thing.
function fakePages(lines, { fontSize = 10 } = {}) {
  const box = { x0: 0, y0: 0, x1: 612, y1: 792 };
  const items = [];
  let y = 720;
  for (const line of lines) {
    let x = 72;
    for (const word of String(line).split(/\s+/).filter(Boolean)) {
      const width = Math.max(4, word.length * fontSize * 0.5);
      items.push({ str: word, x, y, width, height: fontSize, hasEOL: false });
      x += width + 4;
    }
    y -= 14;
  }
  return { pages: [{ pageNumber: 1, box, items }] };
}
const input = (overrides = {}) => ({ packet, profile, job, sources, coverBytes: Buffer.from('cover'), ...overrides });
// One response per extractor call: the resume first, then the cover.
const extractor = (...responses) => {
  let call = 0;
  const calls = [];
  const run = async bytes => {
    calls.push(Buffer.from(bytes).toString());
    const response = responses[Math.min(call++, responses.length - 1)];
    if (typeof response === 'function') return response(bytes);
    return response;
  };
  run.calls = calls;
  return run;
};
const check = (evidence, id) => evidence.checks.find(item => item.id === id);

test('PDF control: arbitrary bytes with a caller-supplied header are not a document', async () => {
  const bytes = Buffer.alloc(101, 0x20);
  const evidence = await pdfEvidence(bytes, input());
  assert.equal(evidence.state, 'error');
  assert.equal(check(evidence, 'parse').status, 'fail');
  assert.equal(pdfEvidencePassed(evidence), false);
  // The pre-fix predicate: 101 bytes plus head '%PDF-' used to pass.
  const score = scorePacket({ packet, persona: { profile, facts: [], absent: [], voice: { banned: [], firstPerson: false } }, job: { ...job, requiredFactIds: [], atsTerms: [] }, sources, review: { passed: true, issues: [] }, pdf: { bytes, head: '%PDF-' } });
  assert.equal(score.pdfValid, false);
  assert.equal(score.pdfState, 'absent');
});

test('PDF control: a valid parse with a missing resume line fails coverage and names the line', async () => {
  const missing = packet.resume[1].text;
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages(resumeLines.filter(line => line !== missing)), fakePages(coverLines)) }));
  assert.equal(evidence.state, 'issues');
  assert.equal(check(evidence, 'resume-coverage').status, 'fail');
  assert.match(check(evidence, 'resume-coverage').detail, /missing or incomplete/);
  assert.equal(pdfEvidencePassed(evidence), false);
});

test('PDF control: reordered lines within a section fail coverage', async () => {
  const reordered = [...resumeLines];
  const first = reordered.indexOf(packet.resume[0].text), second = reordered.indexOf(packet.resume[1].text);
  [reordered[first], reordered[second]] = [reordered[second], reordered[first]];
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages(reordered), fakePages(coverLines)) }));
  assert.equal(check(evidence, 'resume-coverage').status, 'fail');
  assert.match(check(evidence, 'resume-coverage').detail, /out of order/);
});

test('PDF control: interleaved columns fail reading order', async () => {
  // Two lines whose words are staggered: each line's words are not contiguous.
  const interleaved = [
    'Riley Chen',
    'riley@example.invalid · +1 617 555 0100',
    'At Example I ran 40 On Formula',
    'Example Pumps wrote a bench tests SAE I redesigned',
    packet.resume[0].text.split(' ').slice(0, 5).join(' ') + ' ' + packet.resume[1].text.split(' ').slice(0, 5).join(' '),
    packet.resume[2].text,
  ];
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages(interleaved), fakePages(coverLines)) }));
  assert.equal(evidence.state, 'issues');
  assert.ok(['fail'].includes(check(evidence, 'reading-order').status) || check(evidence, 'resume-coverage').status === 'fail', JSON.stringify(evidence.checks));
  assert.equal(pdfEvidencePassed(evidence), false);
});

test('PDF control: garbled glyphs fail the readable-character check', async () => {
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages([...resumeLines, 'Skills \uFFFD\uFFFD (cid:42)']), fakePages(coverLines)) }));
  assert.equal(check(evidence, 'garbled').status, 'fail');
  assert.equal(evidence.state, 'issues');
});

test('PDF control: missing contact details fail', async () => {
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages(resumeLines.filter(line => !line.includes('riley@example.invalid'))), fakePages(coverLines)) }));
  assert.equal(check(evidence, 'contact').status, 'fail');
});

test('PDF control: a missing cover sentence fails the cover check', async () => {
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages(resumeLines), fakePages(coverLines.slice(0, 2))) }));
  assert.equal(evidence.state, 'issues');
  assert.equal(evidence.cover.required, true);
  assert.equal(evidence.cover.status, 'fail');
  assert.equal(check(evidence, 'cover').status, 'fail');
});

test('PDF control: a cover letter without a cover PDF fails; no cover letter skips', async () => {
  const missing = await pdfEvidence(Buffer.from('resume'), input({ coverBytes: null, extractor: extractor(fakePages(resumeLines)) }));
  assert.equal(missing.cover.required, true);
  assert.equal(missing.cover.status, 'fail');
  const none = await pdfEvidence(Buffer.from('resume'), input({ packet: { ...packet, coverLetter: '' }, coverBytes: null, extractor: extractor(fakePages(resumeLines)) }));
  assert.equal(none.cover.required, false);
  assert.equal(none.cover.status, 'skipped');
});

test('PDF control: an extractor that throws is an error; unavailable and empty text are recorded states, never a pass', async () => {
  const thrown = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(() => { throw new Error('extractor exploded'); }) }));
  assert.equal(thrown.state, 'error');
  assert.equal(pdfEvidencePassed(thrown), false);
  const unavailable = await pdfEvidence(Buffer.from('resume'), input({ extractor: async () => ({ unavailable: 'pdfjs-dist is not installed' }) }));
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(pdfEvidencePassed(unavailable), false);
  const empty = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor({ pages: [{ pageNumber: 1, box: { x0: 0, y0: 0, x1: 612, y1: 792 }, items: [] }] }) }));
  assert.equal(empty.state, 'unavailable');
  assert.equal(check(empty, 'text-layer').status, 'fail');
  assert.equal(pdfEvidencePassed(empty), false);
});

test('PDF control: an injected extractor is recorded, and Poppler is a skipped tier, not a pass', async () => {
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages(resumeLines), fakePages(coverLines)) }));
  assert.equal(evidence.state, 'passed', JSON.stringify(evidence.checks.filter(item => item.status === 'fail')));
  assert.equal(evidence.atsParseTier, 'injected');
  assert.equal(check(evidence, 'poppler-cross-check').status, 'skipped');
  assert.equal(pdfEvidencePassed(evidence), true);
  const summary = pdfEvidenceSummary(evidence);
  assert.equal(summary.state, 'passed');
  assert.equal(summary.checks.some(item => item.id === 'resume-coverage'), true);
  assert.equal(Object.hasOwn(summary, 'lines'), false, 'the summary does not carry extracted text');
});

test('PDF control: the packet passes only with the passed evidence, and reports it', async () => {
  const evidence = await pdfEvidence(Buffer.from('resume'), input({ extractor: extractor(fakePages(resumeLines), fakePages(coverLines)) }));
  const persona = { profile, facts: [{ id: 'f', text: 'Riley Chen built SQL reports and cut weight by 18%.' }], absent: [], voice: { banned: [], firstPerson: true } };
  const scoringJob = { ...job, requiredFactIds: ['f'], atsTerms: [] };
  const packetWithFact = { ...packet, resume: [{ section: 'Projects', text: 'Riley Chen built SQL reports and cut weight by 18%.' }, ...packet.resume] };
  const scored = scorePacket({ packet: packetWithFact, persona, job: scoringJob, sources, review: { passed: true, issues: [] }, pdf: { bytes: Buffer.from('resume'), evidence } });
  assert.equal(scored.pdfValid, true);
  assert.equal(scored.pdfState, 'passed');
  assert.equal(scored.pdfPageCount, 1);
  assert.equal(scored.pdfAtsParseTier, 'injected');
  assert.equal(scored.pass, true, JSON.stringify({ unsupported: scored.unsupportedNumbers, checks: scored.pdfEvidence?.checks }));
});

test('PDF positive: a real Chromium-rendered packet parses with pdfjs and matches the Poppler cross-check', async t => {
  if (spawnSync('pdftotext', ['-v']).error) return t.skip('pdftotext is not installed, so the Poppler tier cannot be claimed');
  let browser;
  try { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); await browser.close(); browser = null; }
  catch { return t.skip('Chromium is not installed, so the real-render tier cannot be claimed'); }
  const dir = await mkdtemp(path.join(tmpdir(), 'plainhand-pdf-evidence-'));
  try {
    const files = new Map();
    const workspace = { write: async (p, c) => files.set(p, Buffer.from(c)), read: async () => null, readBinary: async p => files.get(p) };
    const art = await renderPacket(workspace, { profile }, job, packet);
    const resumeBytes = files.get(art.pdf);
    const coverBytes = files.get(art.artifacts.find(file => /cover-letter.*\.pdf$/.test(file)));
    await writeFile(path.join(dir, 'resume.pdf'), resumeBytes);
    const evidence = await pdfEvidence(resumeBytes, { packet, profile, job, sources, coverBytes });
    assert.equal(evidence.state, 'passed', JSON.stringify(evidence.checks.filter(item => item.status === 'fail')));
    assert.equal(evidence.extractor.name, 'pdfjs-dist');
    assert.match(String(evidence.extractor.version), /^\d+\.\d+\.\d+/);
    assert.ok(evidence.pageCount >= 1);
    assert.ok(evidence.textLength > 100);
    assert.equal(evidence.atsParseTier, 'pdfjs+poppler');
    assert.equal(evidence.popplerCrossCheck.available, true);
    assert.equal(check(evidence, 'poppler-cross-check').status, 'pass', JSON.stringify(evidence.popplerCrossCheck));
    assert.equal(evidence.cover.required, true);
    assert.equal(evidence.cover.status, 'pass');
    assert.equal(pdfEvidencePassed(evidence), true);
    // The extracted text really contains the packet's entry lines.
    for (const entry of packet.resume) assert.match(evidence.lines.map(line => line.text).join(' '), new RegExp(entry.text.split(' ').slice(0, 4).join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // Without Poppler the packet can still pass Tier A, but the ATS-parse claim is
    // recorded as pdfjs-only, never as a full cross-check.
    const noPoppler = await pdfEvidence(resumeBytes, { packet, profile, job, sources, coverBytes, poppler: false });
    assert.equal(noPoppler.atsParseTier, 'pdfjs-only');
    assert.equal(check(noPoppler, 'poppler-cross-check').status, 'skipped');
    assert.equal(noPoppler.state, 'passed');
  } finally { await browser?.close(); await rm(dir, { recursive: true, force: true }); }
});
