import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { deriveFormat, cleanFormat, groupEntries, orderSections, renderResumeHtml, renderLetterHtml, verifyHeadings, parseBboxLayout, DEFAULT_FORMAT, normalizeResume, repairMisplacedAccomplishments, orderRolesNewestFirst } from '../plainhand/resume-format.mjs';
import { renderPacket } from '../plainhand/workflow.mjs';
import { createPlainhand } from '../plainhand-server.mjs';

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

test('Experience leads the supporting sections; a saved candidate format wins over that order', () => {
  const role = { org: 'Example Pensions', title: 'Analyst', location: '', dates: '2020 to 2023' };
  const rows = [
    { section: 'Skills', heading: null, text: 'Excel' },
    { section: 'CFA Progress', heading: null, text: 'Level II candidate' },
    { section: 'Experience', heading: role, text: 'Built the forecast model.' },
    { section: 'Education', heading: { org: 'Example University', title: 'B.S. Finance', location: '', dates: '2020' }, text: '' },
  ];
  assert.deepEqual(normalizeResume(rows).map(entry => entry.section), ['Experience', 'Education', 'CFA Progress', 'Skills'], 'experience first, then the supporting sections');
  assert.deepEqual(normalizeResume(rows, { sections: ['Skills', 'Experience', 'CFA Progress', 'Education'] }).map(entry => entry.section), ['Skills', 'Experience', 'CFA Progress', 'Education'], 'the candidate’s own order is kept');
  // A section invented to explain an unknown employer is Experience, heading null.
  const invented = normalizeResume([{ section: 'Experience — employer and dates not supplied', heading: null, text: 'Built the forecast model.' }]);
  assert.deepEqual(invented.map(entry => [entry.section, entry.heading]), [['Experience', null]]);
  // A real experience section's name is kept and receives the heading-less lines.
  const proper = normalizeResume([{ section: 'Work Experience', heading: role, text: 'Built the model.' }, { section: 'Employment — dates unknown', heading: null, text: 'Ran the close.' }]);
  assert.deepEqual(proper.map(entry => entry.section), ['Work Experience', 'Work Experience']);
});

test('a heading-less accomplishment section moves under the only role; a title repeat is dropped', () => {
  const role = { org: 'Example Bio', title: 'Research Associate II', location: '', dates: '2019 to 2023' };
  const filler = { section: 'Experience', heading: role, text: 'Research Associate II.' };
  const accomplishment = { section: 'Research Accomplishments', heading: null, text: 'Developed a potency assay that cut turnaround from 5 days to 2.' };
  const out = repairMisplacedAccomplishments([filler, accomplishment]);
  assert.deepEqual([out.moved, out.dropped, out.ambiguous], [1, 1, false]);
  assert.deepEqual(out.resume.map(entry => [entry.section, entry.heading?.title, entry.text]), [['Experience', 'Research Associate II', accomplishment.text]]);
  // Two roles: nothing moves, and the caller is told the placement is ambiguous.
  const two = repairMisplacedAccomplishments([filler, { section: 'Experience', heading: { org: 'Example Two', title: 'Scientist', location: '', dates: '2015 to 2019' }, text: 'Ran screens.' }, accomplishment]);
  assert.deepEqual([two.moved, two.ambiguous], [0, true]);
  assert.deepEqual(two.roles.map(heading => heading.org), ['Example Bio', 'Example Two']);
  assert.deepEqual(two.sections, ['Research Accomplishments']);
  // A recognised section (Projects) or a credential-progress section never moves.
  assert.equal(repairMisplacedAccomplishments([filler, { section: 'Projects', heading: null, text: 'Built a dashboard.' }]).moved, 0);
  assert.equal(repairMisplacedAccomplishments([filler, { section: 'CFA Progress', heading: null, text: 'Level II candidate.' }]).moved, 0);
  // An unrecognised section that is not named for accomplishments is its own entry.
  assert.equal(repairMisplacedAccomplishments([filler, { section: 'Selected Projects', heading: null, text: 'Built a dashboard.' }]).moved, 0);
  assert.equal(repairMisplacedAccomplishments([filler, { section: 'Volunteer Leadership', heading: null, text: 'Ran a food bank shift.' }]).moved, 0);
});

test('a scanned or empty PDF is refused clearly', async () => {
  const browser = await chromium.launch();
  let pdf; try { const page = await browser.newPage(); await page.setContent('<p>hi</p>'); pdf = await page.pdf(); } finally { await browser.close(); }
  await assert.rejects(deriveFormat(pdf), /too little text/);
});

test('PDF text entities are decoded once, so an escaped entity stays escaped', () => {
  const word = '&amp;lt;tag&amp;gt; &amp;amp;';
  const xhtml = `<page width="612" height="792"><line xMin="0" yMin="0" xMax="10" yMax="10"><word xMin="0" yMin="0" xMax="10" yMax="10">${word}</word></line></page>`;
  assert.equal(parseBboxLayout(xhtml).lines[0].text, '&lt;tag&gt; &amp;');
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
  const html = renderResumeHtml(format, { name: 'Riley Example', email: 'r@example.invalid', phone: '+1 617 555 0100', location: 'Boston' }, { resume });
  assert.match(html, /size:A4/); assert.match(html, /'Garamond', 'Times New Roman'/); assert.match(html, /content:"▪"/);
  assert.ok(html.includes('r@example.invalid') && html.includes('+1 617 555 0100'), 'the contact header renders email and phone locally');
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

test('newest-first ordering moves whole roles by date and keeps everything else in place', () => {
  const role = (org, dates) => ({ org, title: 'Scientist', location: '', dates });
  const resume = [
    { section: 'Summary', heading: null, text: 'Summary line.' },
    { section: 'Experience', heading: role('Genomics', '2016 to 2023'), text: 'G1.' },
    { section: 'Experience', heading: role('Genomics', '2016 to 2023'), text: 'G2.' },
    { section: 'Experience', heading: role('Bioinstruments', '2025 to 2026'), text: 'B1.' },
    { section: 'Experience', heading: role('Cell', '2012 to 2016'), text: 'C1.' },
    { section: 'Experience', heading: role('Startup', '2024 to present'), text: 'S1.' },
    { section: 'Education', heading: role('University', '2012'), text: '' },
  ];
  assert.deepEqual(orderRolesNewestFirst(resume).map(entry => entry.text || entry.section), ['Summary line.', 'B1.', 'S1.', 'G1.', 'G2.', 'C1.', 'Education']);
});

test('hyphenated words render unbroken so extractors read them whole', () => {
  const html = renderResumeHtml({}, { name: 'A' }, { resume: [{ section: 'Summary', heading: null, text: 'Built liquid-handling automation & cell-based assays.' }] });
  assert.match(html, /<span class="nobreak">liquid-handling<\/span>/);
  assert.match(html, /&amp;/);
  assert.match(html, /\.nobreak\{white-space:nowrap\}/);
});

test('review 23931b5: newest first by start date; passing drafts, undated roles and loose lines stay put', () => {
  const role = (org, dates) => ({ org, title: 'T', location: '', dates });
  const row = (org, dates, text, section = 'Experience') => ({ section, heading: org ? role(org, dates) : null, text });
  const order = rows => orderRolesNewestFirst(rows).map(entry => entry.text);
  // Already newest first by start: untouched, even with an ongoing older role or overlap.
  assert.deepEqual(order([row('A', '2020 to 2023', 'a'), row('B', '2018 to present', 'b')]), ['a', 'b']);
  assert.deepEqual(order([row('A', '2020 to 2021', 'a'), row('B', '2016 to 2023', 'b')]), ['a', 'b']);
  // An undated role keeps its slot.
  assert.deepEqual(order([row('Cur', 'Summer 2025', 'cur'), row('Old', '2016 to 2023', 'old'), row('New', '2024 to 2025', 'new')]), ['cur', 'new', 'old']);
  // The candidate's own section name counts.
  assert.deepEqual(order([row('Old', '2016 to 2023', 'old', 'Professional History'), row('New', '2025 to 2026', 'new', 'Professional History')]), ['new', 'old']);
  // A heading-less line travels with the role above it.
  assert.deepEqual(order([row('Old', '2016 to 2023', 'old'), row(null, '', 'loose'), row('New', '2025 to 2026', 'new')]), ['new', 'old', 'loose']);
});

test('review 97f3a7e: roles are ordered across experience sections, and candidate names like Professional Roles count', () => {
  const role = (org, dates) => ({ org, title: 'T', location: '', dates });
  const row = (org, dates, text, section = 'Experience') => ({ section, heading: role(org, dates), text });
  const out = orderRolesNewestFirst([{ section: 'Summary', heading: null, text: 's' }, row('A', '2016 to 2020', 'a'), row('B', '2025 to 2026', 'b'), row('C', '2019 to 2021', 'c', 'Work History')]);
  assert.deepEqual(out.map(entry => `${entry.text}:${entry.section}`), ['s:Summary', 'b:Experience', 'c:Experience', 'a:Experience']);
  assert.deepEqual(orderRolesNewestFirst([row('Old', '2016 to 2020', 'old', 'Professional Roles'), row('New', '2025 to 2026', 'new', 'Professional Roles')]).map(entry => entry.text), ['new', 'old']);
});

test('review 983c762: volunteer and board sections are never merged; apart employment sections stay in place', () => {
  const role = (org, dates) => ({ org, title: 'T', location: '', dates });
  const out = orderRolesNewestFirst([{ section: 'Experience', heading: role('Acme', '2016 to 2020'), text: 'a' }, { section: 'Volunteer Roles', heading: role('Food bank', '2025 to present'), text: 'v' }]);
  assert.deepEqual(out.map(entry => `${entry.text}:${entry.section}`), ['a:Experience', 'v:Volunteer Roles']);
  const apart = orderRolesNewestFirst([{ section: 'Summary', heading: null, text: 's' }, { section: 'Experience', heading: role('A', '2016 to 2020'), text: 'a' }, { section: 'Education', heading: role('U', '2012'), text: 'u' }, { section: 'Professional Roles', heading: role('B', '2025 to 2026'), text: 'b' }]);
  assert.deepEqual(apart.map(entry => `${entry.text}:${entry.section}`), ['s:Summary', 'a:Experience', 'u:Education', 'b:Professional Roles']);
});
