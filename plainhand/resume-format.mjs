// The candidate's resume format: derived from a PDF of their own resume, edited on the
// profile screen, and used for every resume and cover letter Plainhand renders. Only
// style and section names are kept, never the resume's text.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from './agents.mjs';

export const DEFAULT_FORMAT = {
  source: 'default',
  page: 'letter',
  margins: { top: 0.6, right: 0.7, bottom: 0.6, left: 0.7 },
  font: { family: 'sans', name: 'Arial', size: 10.5, lineHeight: 1.3 },
  name: { size: 22, align: 'left' },
  contact: { separator: ' · ', align: 'left' },
  headings: { case: 'upper', size: 11, rule: true },
  sections: [],
  entry: { datesRight: true, titleItalic: true },
  bullet: '•',
};
const SERIF = /times|garamond|georgia|cambria|book|serif|palatino|minion|baskerville|caslon|didot|charter|libertin|merriweather/i;
const BULLETS = ['•', '▪', '◦', '‣', '–', '-', '*', '●', '■', '○'];
const SEPARATORS = [' | ', ' • ', ' · ', ' ◦ ', ' - ', ' – ', ', '];
const DATE = /\b((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|(19|20)\d{2}|present|current)\)?\s*$/i;
const round = (n, step = 0.5) => +(Math.round(n / step) * step).toFixed(2);
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mode = values => { const counts = new Map(); for (const v of values) counts.set(v, (counts.get(v) || 0) + 1); return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]; };
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// pdftotext -bbox-layout lines: text, position and height (≈ the font's line box).
export function parseBboxLayout(xhtml) {
  const page = xhtml.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  const lines = [];
  for (const m of xhtml.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)) {
    const words = [...m[5].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)].map(w => ({ xMin: +w[1], xMax: +w[3], height: +w[4] - +w[2], text: decode(w[5]) }));
    if (!words.length) continue;
    lines.push({ xMin: +m[1], yMin: +m[2], xMax: +m[3], yMax: +m[4], height: median(words.map(w => w.height)), words, text: words.map(w => w.text).join(' ') });
  }
  return { width: page ? +page[1] : 612, height: page ? +page[2] : 792, lines: lines.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin) };
}

// Line-box height to point size, calibrated on Chromium-rendered PDFs (test-resume-format.mjs).
const PT = 1 / 1.12;

export function formatFromLayout(layout, fontNames = []) {
  const { width, height, lines } = layout;
  if (lines.length < 5) throw new Error('This PDF has too little text to read a format from. Use a text PDF of your resume (not a scan).');
  const base = mode(lines.map(l => round(l.height * PT)));
  const top = lines.slice(0, 3);
  const nameLine = top.reduce((a, b) => (b.height > a.height ? b : a));
  const center = l => Math.abs((l.xMin + l.xMax) / 2 - width / 2) < width * 0.04;
  const contactLine = lines.find(l => l !== nameLine && l.yMin > nameLine.yMin && /@|\+?\d[\d\s().-]{7,}|linkedin|https?:/i.test(l.text));
  const separator = contactLine ? (SEPARATORS.map(s => [s, contactLine.text.split(s).length - 1]).sort((a, b) => b[1] - a[1])[0]?.[1] ? SEPARATORS.map(s => [s, contactLine.text.split(s).length - 1]).sort((a, b) => b[1] - a[1])[0][0] : ' · ') : ' · ';
  const afterHeader = lines.filter(l => l.yMin > (contactLine || nameLine).yMax);
  const isHeading = l => {
    const words = l.text.split(/\s+/);
    if (words.length > 4 || /[.,;:]$/.test(l.text) || /\d/.test(l.text) || BULLETS.includes(words[0])) return false;
    const caps = l.text === l.text.toUpperCase() && /[A-Z]{3}/.test(l.text);
    return caps || l.height * PT >= base + 0.75;
  };
  const headings = afterHeader.filter(isHeading);
  const caseOf = t => t === t.toUpperCase() ? 'upper' : t.split(/\s+/).every(w => /^[A-Z&]/.test(w) || w.length <= 3) ? 'title' : 'as-is';
  const right = Math.max(...lines.map(l => l.xMax));
  const dated = afterHeader.filter(l => DATE.test(l.text) && !isHeading(l));
  // A date at the right margin, either split from its line by a wide gap or its own line on the right.
  const rightDated = dated.filter(l => right - l.xMax < 6 && (l.xMin > width * 0.55 || (l.words.length > 1 && (l.words.at(-1).xMin - l.words.at(-2).xMax > 18 || (l.words.length > 2 && l.words.at(-2).xMin - l.words.at(-3).xMax > 18)))));
  const bullets = afterHeader.map(l => l.words[0].text).filter(t => BULLETS.includes(t) || /^[•▪◦‣●■○]/.test(t)).map(t => t[0] === '-' || t[0] === '*' || t[0] === '–' ? t[0] : t[0]);
  const body = afterHeader.filter(l => Math.abs(l.height * PT - base) < 0.6);
  const gaps = body.slice(1).map((l, i) => l.yMin - body[i].yMin).filter(g => g > 0 && g < base * 2.2);
  const family = fontNames.find(Boolean) || '';
  const sizes = { letter: Math.abs(width - 612) < 8 && Math.abs(height - 792) < 8, a4: Math.abs(width - 595) < 8 && Math.abs(height - 842) < 8 };
  const inch = pt => Math.max(0.25, Math.min(1.5, round(pt / 72, 0.05)));
  return {
    source: 'derived',
    page: sizes.a4 ? 'a4' : 'letter',
    // A short or ragged page says nothing about its bottom or right margin: mirror the top and left.
    margins: (() => { const t = inch(Math.min(...lines.map(l => l.yMin))), l = inch(Math.min(...lines.map(x => x.xMin))), b = height - Math.max(...lines.map(x => x.yMax)), r = width - right;
      return { top: t, bottom: b > 2 * 72 ? t : inch(b), left: l, right: r > l * 72 + 36 ? l : inch(r) }; })(),
    font: { family: SERIF.test(family) ? 'serif' : 'sans', name: family.replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Regular|Roman|PSMT|MT|BoldMT|ItalicMT).*$/i, '').replace(/PSMT|MT$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || (SERIF.test(family) ? 'Times New Roman' : 'Arial'), size: base, lineHeight: gaps.length ? Math.max(1, Math.min(1.8, round(median(gaps) / base, 0.05))) : 1.2 },
    name: { size: round(nameLine.height * PT), align: center(nameLine) ? 'center' : 'left' },
    contact: { separator, align: contactLine && center(contactLine) ? 'center' : 'left' },
    headings: { case: headings.length ? mode(headings.map(h => caseOf(h.text))) : 'upper', size: headings.length ? round(median(headings.map(h => h.height * PT))) : base, rule: true },
    sections: [...new Set(headings.map(h => h.text.trim()))].slice(0, 12),
    entry: { datesRight: dated.length ? rightDated.length >= dated.length / 2 : true, titleItalic: true },
    bullet: bullets.length ? mode(bullets) : '•',
  };
}

// Reads a format from the candidate's own resume PDF (Poppler tools, local only).
export async function deriveFormat(pdf) {
  const dir = await mkdtemp(path.join(tmpdir(), 'plainhand-format-'));
  try {
    const file = path.join(dir, 'resume.pdf');
    await writeFile(file, pdf, { mode: 0o600 });
    let xhtml, fonts = '';
    try { xhtml = (await runProcess('pdftotext', ['-bbox-layout', '-l', '1', file, '-'], { timeout: 15000 })).stdout; }
    catch (error) { if (error.code === 'ENOENT') throw new Error('Install Poppler (pdftotext) to read your resume format.'); throw error; }
    try { fonts = (await runProcess('pdffonts', ['-l', '1', file], { timeout: 15000 })).stdout; } catch {}
    // pdffonts: two header lines, then "name type encoding ..." rows; the most used is listed first often enough.
    const names = fonts.split('\n').slice(2).map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
    const regular = names.find(n => !/bold|italic|oblique|symbol/i.test(n)) || names[0];
    return formatFromLayout(parseBboxLayout(xhtml), [regular]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// Validates an edited format; anything unknown falls back to the default.
export function cleanFormat(input = {}) {
  const num = (v, lo, hi, d) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : d);
  const d = DEFAULT_FORMAT;
  const m = input.margins || {};
  return {
    source: ['derived', 'edited', 'default'].includes(input.source) ? input.source : 'edited',
    page: input.page === 'a4' ? 'a4' : 'letter',
    margins: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(k => [k, num(m[k], 0.25, 1.5, d.margins[k])])),
    font: { family: input.font?.family === 'serif' ? 'serif' : 'sans', name: String(input.font?.name || (input.font?.family === 'serif' ? 'Times New Roman' : 'Arial')).replace(/[^\w\s-]/g, '').slice(0, 60), size: num(input.font?.size, 8, 13, d.font.size), lineHeight: num(input.font?.lineHeight, 1, 1.8, d.font.lineHeight) },
    name: { size: num(input.name?.size, 12, 36, d.name.size), align: input.name?.align === 'center' ? 'center' : 'left' },
    contact: { separator: SEPARATORS.includes(input.contact?.separator) ? input.contact.separator : d.contact.separator, align: input.contact?.align === 'center' ? 'center' : 'left' },
    headings: { case: ['upper', 'title', 'as-is'].includes(input.headings?.case) ? input.headings.case : 'upper', size: num(input.headings?.size, 8, 18, d.headings.size), rule: input.headings?.rule !== false },
    sections: (Array.isArray(input.sections) ? input.sections : []).map(s => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 12),
    entry: { datesRight: input.entry?.datesRight !== false, titleItalic: input.entry?.titleItalic !== false },
    bullet: [...BULLETS, 'none'].includes(input.bullet) ? input.bullet : '•',
  };
}

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STACKS = { serif: "'Times New Roman', Times, 'Liberation Serif', 'DejaVu Serif', serif", sans: "Arial, Helvetica, 'Liberation Sans', 'DejaVu Sans', sans-serif" };
const fontStack = f => `'${f.name.replace(/'/g, '')}', ${STACKS[f.family]}`;
const headingText = (text, format) => format.headings.case === 'upper' ? text.toUpperCase() : format.headings.case === 'title' ? text.replace(/\b([a-z])/g, c => c.toUpperCase()) : text;

export function formatCss(format) {
  const f = cleanFormat(format), m = f.margins;
  return `@page{size:${f.page === 'a4' ? 'A4' : 'Letter'};margin:${m.top}in ${m.right}in ${m.bottom}in ${m.left}in}*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${fontStack(f.font)};font-size:${f.font.size}pt;line-height:${f.font.lineHeight};color:#000}
h1{font-size:${f.name.size}pt;line-height:1.1;text-align:${f.name.align};margin-bottom:2pt}
.contact{text-align:${f.contact.align};margin-bottom:6pt}
h2{font-size:${f.headings.size}pt;font-weight:700;margin:8pt 0 3pt;${f.headings.rule ? 'border-bottom:1px solid #000;padding-bottom:1pt;' : ''}}
.head{display:flex;justify-content:space-between;gap:12pt;margin-top:4pt}.head .org{font-weight:700}.title{${f.entry.titleItalic ? 'font-style:italic;' : ''}}
.dates,.where{white-space:nowrap}
ul{list-style:none;margin:1pt 0 2pt}li{padding-left:${f.bullet === 'none' ? 0 : 12}pt;position:relative}${f.bullet === 'none' ? '' : `li::before{content:${JSON.stringify(f.bullet)};position:absolute;left:2pt}`}
p.line{margin:1pt 0}.letter p{margin:0 0 9pt}`;
}

// Consecutive entries of a section under the same heading form one block.
export function groupEntries(resume) {
  const sections = [];
  for (const entry of resume) {
    let section = sections.find(s => s.name === entry.section);
    if (!section) sections.push(section = { name: entry.section, blocks: [] });
    const key = JSON.stringify(entry.heading || null), last = section.blocks.at(-1);
    if (last && last.key === key) last.lines.push(entry.text);
    else section.blocks.push({ key, heading: entry.heading || null, lines: [entry.text] });
  }
  return sections;
}

// Sections in the candidate's order, matched by name; others keep their draft order.
export function orderSections(sections, format) {
  const order = (format.sections || []).map(s => s.toLowerCase());
  const rank = name => { const i = order.findIndex(o => o === name.toLowerCase() || o.includes(name.toLowerCase()) || name.toLowerCase().includes(o)); return i < 0 ? 100 : i; };
  return sections.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.name) - rank(b.s.name) || a.i - b.i).map(x => x.s);
}

function header(profile, format) {
  const f = cleanFormat(format);
  const contact = [profile.email, profile.phone, profile.location, profile.links].filter(Boolean).map(esc).join(esc(f.contact.separator));
  return `<h1>${esc(profile.name)}</h1><div class="contact">${contact}</div>`;
}

export function renderResumeHtml(format, profile, packet, title = 'Resume') {
  const f = cleanFormat(format);
  const blocks = orderSections(groupEntries(packet.resume), f).map(section => `<h2>${esc(headingText(section.name, f))}</h2>` + section.blocks.map(block => {
    const h = block.heading;
    const head = h ? (f.entry.datesRight
      ? `<div class="head"><span class="org">${esc(h.org || h.title || '')}</span><span class="where">${esc(h.location || '')}</span></div>${h.org && h.title ? `<div class="head"><span class="title">${esc(h.title)}</span><span class="dates">${esc(h.dates || '')}</span></div>` : h.dates ? `<div class="head"><span></span><span class="dates">${esc(h.dates)}</span></div>` : ''}`
      : `<div class="head"><span><span class="org">${esc(h.org || '')}</span>${h.title ? `, <span class="title">${esc(h.title)}</span>` : ''}${h.location ? `, ${esc(h.location)}` : ''}${h.dates ? ` (${esc(h.dates)})` : ''}</span></div>`) : '';
    const lines = h || block.lines.length > 1 ? `<ul>${block.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : `<p class="line">${esc(block.lines[0])}</p>`;
    return head + lines;
  }).join('')).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(profile.name)} — ${esc(title)}</title><style>${formatCss(f)}</style></head><body>${header(profile, f)}${blocks}</body></html>`;
}

export function renderLetterHtml(format, profile, job, letter) {
  const f = cleanFormat(format);
  const paragraphs = String(letter).split(/\n\s*\n|\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(profile.name)} — ${esc(job.title)}</title><style>${formatCss(f)}</style></head><body>${header(profile, f)}<div class="letter">${paragraphs}</div></body></html>`;
}

// A heading's organization, title, location and dates are verifiable facts: each must
// appear (word for word, any case) in the candidate's sources, or it is left out.
export function verifyHeadings(resume, sourceText) {
  const words = new Set(String(sourceText).toLowerCase().match(/[a-z0-9]+/g) || []);
  const found = value => (String(value).toLowerCase().match(/[a-z0-9]+/g) || []).every(w => words.has(w));
  let dropped = 0;
  for (const entry of resume) {
    const h = entry.heading;
    if (!h || typeof h !== 'object') { entry.heading = null; continue; }
    const clean = {};
    for (const key of ['org', 'title', 'location', 'dates']) {
      const value = typeof h[key] === 'string' ? h[key].trim().slice(0, 200) : '';
      if (value && !found(value)) { dropped++; continue; }
      clean[key] = value;
    }
    entry.heading = Object.values(clean).some(Boolean) ? { org: clean.org || '', title: clean.title || '', location: clean.location || '', dates: clean.dates || '' } : null;
  }
  return dropped;
}
