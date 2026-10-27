import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { deriveFormat, cleanFormat, groupEntries, orderSections, renderResumeHtml, renderLetterHtml, verifyHeadings, DEFAULT_FORMAT } from './plainhand/resume-format.mjs';
import { renderPacket } from './plainhand/workflow.mjs';
import { createPlainhand } from './plainhand-server.mjs';

// Two fictional resumes in deliberately different formats, rendered to real PDFs.
const STYLES = {
  classic: { css: "@page{size:Letter;margin:0.5in}body{font-family:'Times New Roman','Liberation Serif',serif;font-size:11pt;line-height:1.15;margin:0}h1{font-size:20pt;text-align:center;margin:0}.c{text-align:center}h2{font-size:11pt;text-transform:uppercase;border-bottom:1px solid #000;margin:8pt 0 2pt}.r{display:flex;justify-content:space-between}ul{margin:0;padding-left:16pt}", headings: ['Education', 'Experience', 'Projects', 'Skills'], sep: ' | ', right: true },
  modern: { css: "@page{size:A4;margin:0.75in}body{font-family:Arial,'Liberation Sans',sans-serif;font-size:10pt;line-height:1.4;margin:0}h1{font-size:24pt;margin:0}h2{font-size:13pt;margin:10pt 0 3pt}ul{list-style:none;margin:0;padding:0}li::before{content:'– '}", headings: ['Work Experience', 'Education', 'Technical Skills'], sep: ' · ', right: false },
};
async function pdfOf(style) {
  const row = (l, r) => style.right ? `<div class="r"><b>${l}</b><span>${r}</span></div>` : `<div><b>${l}</b> (${r})</div>`;
  const sec = h => `<h2>${h}</h2>${row('Example Organization', 'May 2025 – Present')}<ul><li>Designed and tested a lightweight chassis for the team over two seasons of work.</li><li>Ran forty bench tests and wrote the procedure the lab still uses today.</li></ul>`;
  const html = `<html><head><style>${style.css}</style></head><body><h1>Riley Example</h1><div class="c">riley@example.invalid${style.sep}+1 617 555 0100${style.sep}Boston, MA</div>${style.headings.map(sec).join('')}</body></html>`;
  const browser = await chromium.launch();
  try { const page = await browser.newPage(); await page.setContent(html); return await page.pdf({ preferCSSPageSize: true }); } finally { await browser.close(); }
}

test('a classic serif resume: letter, 0.5in, 11pt Times, centered name and contact, uppercase headings, dates at the right', async () => {
  const f = await deriveFormat(await pdfOf(STYLES.classic));
  assert.deepEqual([f.page, f.margins, f.font.family, f.font.size, f.font.lineHeight], ['letter', { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }, 'serif', 11, 1.15]);
  assert.deepEqual([f.name.size, f.name.align, f.contact.separator, f.contact.align], [20, 'center', ' | ', 'center']);
  assert.deepEqual([f.headings.case, f.headings.size, f.sections], ['upper', 11, ['EDUCATION', 'EXPERIENCE', 'PROJECTS', 'SKILLS']]);
  assert.deepEqual([f.entry.datesRight, f.bullet], [true, '•']);
  assert.equal(f.font.name, 'Liberation Serif', 'font names read as people write them');
});

test('a modern sans resume: A4, 0.75in, 10pt Arial, left name, title-case headings, dates after the title, dash bullets', async () => {
  const f = await deriveFormat(await pdfOf(STYLES.modern));
  assert.deepEqual([f.page, f.margins.left, f.font.family, f.font.size, f.font.lineHeight], ['a4', 0.75, 'sans', 10, 1.4]);
  assert.deepEqual([f.name.size, f.name.align, f.contact.separator], [24, 'left', ' · ']);
  assert.deepEqual([f.headings.case, f.headings.size, f.sections], ['title', 13, ['Work Experience', 'Education', 'Technical Skills']]);
  assert.deepEqual([f.entry.datesRight, f.bullet], [false, '–']);
  assert.ok(!JSON.stringify(f).includes('Riley') && !JSON.stringify(f).includes('617'), 'only style is kept, never the resume text');
});

test('a scanned or empty PDF is refused clearly', async () => {
  const browser = await chromium.launch();
  let pdf; try { const page = await browser.newPage(); await page.setContent('<p>hi</p>'); pdf = await page.pdf(); } finally { await browser.close(); }
  await assert.rejects(deriveFormat(pdf), /too little text/);
});

test('headings are verified against the sources; unverifiable parts are left out', () => {
  const resume = [{ section: 'Experience', heading: { org: 'Example Pumps', title: 'Senior Engineer', location: 'Boston', dates: 'Summer 2026' }, text: 'x' }, { section: 'Skills', heading: 'nonsense', text: 'y' }];
  const dropped = verifyHeadings(resume, 'Intern, Example Pumps (summer 2026), Boston. Engineer.');
  assert.equal(dropped, 1, 'Senior is not in the sources');
  assert.deepEqual(resume[0].heading, { org: 'Example Pumps', title: '', location: 'Boston', dates: 'Summer 2026' });
  assert.equal(resume[1].heading, null);
});

test('lines group under their heading, sections follow the candidate’s order, and the HTML follows the format', () => {
  const h = { org: 'Example Pumps', title: 'Engineering Intern', location: 'Boston, MA', dates: 'Summer 2026' };
  const resume = [{ section: 'Skills', heading: null, text: 'SolidWorks' }, { section: 'Experience', heading: h, text: 'Wrote a test procedure' }, { section: 'Experience', heading: h, text: 'Ran 40 tests' }];
  const sections = groupEntries(resume);
  assert.deepEqual(sections.map(s => [s.name, s.blocks.length, s.blocks[0].lines.length]), [['Skills', 1, 1], ['Experience', 1, 2]]);
  const format = cleanFormat({ font: { family: 'serif', name: 'Garamond', size: 11 }, headings: { case: 'upper' }, sections: ['Experience', 'Skills'], entry: { datesRight: true }, bullet: '▪', page: 'a4' });
  assert.deepEqual(orderSections(sections, format).map(s => s.name), ['Experience', 'Skills']);
  const html = renderResumeHtml(format, { name: 'Riley Example', email: 'r@example.invalid', location: 'Boston' }, { resume });
  assert.match(html, /size:A4/); assert.match(html, /'Garamond', 'Times New Roman'/); assert.match(html, /content:"▪"/);
  assert.ok(html.indexOf('EXPERIENCE') < html.indexOf('SKILLS'));
  assert.match(html, /<span class="title">Engineering Intern<\/span><span class="dates">Summer 2026<\/span>/);
  assert.equal((html.match(/<li>/g) || []).length, 2);
  const letter = renderLetterHtml(format, { name: 'Riley Example' }, { title: 'Engineer' }, 'Dear team,\n\nI build test rigs.');
  assert.equal((letter.match(/<p>/g) || []).length, 2);
  assert.deepEqual(cleanFormat({ bullet: '<script>', font: { size: 99 } }).bullet, '•');
  assert.equal(cleanFormat({ font: { size: 99 } }).font.size, DEFAULT_FORMAT.font.size);
});

test('the format is the candidate’s to save; packets render in it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-format-'));
  const app = await createPlainhand({ root });
  try {
    await assert.rejects(app.registry.run('format.save', { format: { font: { family: 'serif' } } }, { actor: 'agent', confirmed: true }), e => e.code === 'candidate_only');
    await app.registry.run('format.save', { format: { font: { family: 'serif', name: 'Georgia', size: 11 }, sections: ['Experience'], page: 'a4' } }, { actor: 'ui' });
    const state = await app.workspace.load();
    assert.equal(state.resumeFormat.font.name, 'Georgia');
    state.profile = { ...state.profile, name: 'Riley Example', email: 'r@example.invalid' };
    const job = { id: 'j1', company: 'Acme', title: 'Engineer', url: 'https://jobs.lever.co/acme/1', description: 'Role.', reportPath: 'reports/hl-test.md' };
    const packet = { resume: [{ section: 'Experience', heading: { org: 'Example Pumps', title: 'Intern', location: '', dates: '2026' }, text: 'Ran 40 tests', evidence: [] }], coverLetter: 'Hello.', answers: [] };
    const out = await renderPacket(app.workspace, state, job, packet);
    const html = await app.workspace.read(out.pdf.replace(/\.pdf$/, '.html'));
    assert.match(html, /'Georgia'/); assert.match(html, /size:A4/);
    await app.registry.run('format.save', { reset: true }, { actor: 'ui' });
    assert.equal((await app.workspace.load()).resumeFormat, undefined);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
