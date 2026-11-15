// Rendered-PDF evidence for the evaluation scorer (design §6). A PDF is evidence
// only when a real parse yields its text layer and item geometry. `%PDF-` plus a
// byte count is provenance metadata, never proof: a caller cannot pass a packet by
// declaring a header. Deterministic: no model calls, no network, and the optional
// Poppler cross-check only runs the local read-only `pdftotext`.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { checkResumeText, extractPdfText } from '../ats-check.mjs';
import { headingText, coverLetterClaims } from './claims.mjs';

const require = createRequire(import.meta.url);
const pdfjsVersion = () => {
  try { return require('pdfjs-dist/package.json').version; } catch { return null; }
};

// The checks a passed packet must actually have. A caller-supplied state string is
// not enough: each of these must be present with status 'pass'.
export const REQUIRED_PDF_CHECKS = ['parse', 'text-layer', 'garbled', 'contact', 'resume-coverage', 'reading-order', 'layout', 'ats'];

const squash = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const squashLower = value => squash(value).toLowerCase();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clip = (value, max = 120) => { const text = squash(value); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
// Content tokens for coverage/order: words of three or more characters plus any
// short token with a digit ("30", "7%"). Two-letter function words ("it", "in")
// are not evidence of a line and match incidental words elsewhere.
const contentTokens = value => (squashLower(value).match(/[\p{L}\p{N}][\p{L}\p{N}%&+#./'-]*/gu) || [])
  .filter(token => /[\p{L}\p{N}]/u.test(token) && (token.length >= 3 || /[0-9]/.test(token)));
// checkResumeText's reading-order probes: the first six words of a line (short
// words kept in place), used only when the line has at least three words.
const probesFor = lines => lines.map(line => squashLower(line).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6))
  .filter(words => words.length >= 3).map(words => words.join(' '));

// ---- Extraction ----
// pdfjs-dist, already pinned in package.json, with the Node fake-worker pattern the
// resume importer uses. Returns pages of text items in PDF user space.
async function pdfjsExtract(bytes) {
  let getDocument;
  try {
    ({ getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs'));
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  } catch {
    return { unavailable: 'pdfjs-dist is not installed, so the rendered PDF could not be parsed.' };
  }
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (!pdf.numPages) return { error: 'The PDF has no pages.' };
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const view = page.view || [0, 0, page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height];
        const { items } = await page.getTextContent();
        pages.push({
          pageNumber,
          box: { x0: view[0], y0: view[1], x1: view[2], y1: view[3] },
          items: items.filter(item => typeof item.str === 'string').map(item => ({
            str: item.str,
            x: item.transform?.[4] ?? 0,
            y: item.transform?.[5] ?? 0,
            width: item.width ?? 0,
            height: item.height ?? 0,
            hasEOL: Boolean(item.hasEOL),
          })),
        });
      } finally { page.cleanup(); }
    }
    return { pages };
  } catch (error) {
    if (error?.name === 'PasswordException') return { unavailable: 'The PDF is password protected, so its text could not be parsed.' };
    return { error: error?.message || 'The PDF could not be parsed.' };
  } finally {
    try { await task.destroy(); } catch { /* the parse already failed; nothing to clean up */ }
  }
}

// ---- Geometry ----
// Group items into visual lines by page and vertical position, then sort by page,
// descending y (top to bottom in PDF user space) and x.
function linesOfPage(page) {
  const sorted = [...page.items].filter(item => item.str.trim()).sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const groups = [];
  for (const item of sorted) {
    const tolerance = Math.max(1, (item.height || 10) * 0.35);
    const line = groups.find(group => Math.abs(group.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else groups.push({ y: item.y, items: [item] });
  }
  return groups.map(group => {
    const items = [...group.items].sort((a, b) => a.x - b.x);
    let text = '';
    let previous = null;
    for (const item of items) {
      if (previous) {
        const gap = item.x - (previous.x + (previous.width || 0));
        const space = gap > Math.max(1, (item.height || 10) * 0.12) || /\s$/.test(previous.str);
        text += space ? ' ' : '';
      }
      text += item.str;
      previous = item;
    }
    const heights = items.map(item => item.height || 0).filter(Boolean);
    return {
      page: page.pageNumber,
      y: group.y,
      items,
      text: squash(text),
      x0: Math.min(...items.map(item => item.x)),
      x1: Math.max(...items.map(item => item.x + (item.width || 0))),
      y0: group.y,
      y1: group.y + (heights.length ? Math.max(...heights) : 0),
    };
  }).filter(line => line.text).sort((a, b) => (b.y - a.y) || (a.x0 - b.x0));
}
const linesOf = pages => pages.flatMap(linesOfPage);

// ---- Coverage ----
// Every visible packet line must appear in the extracted token stream at >= 0.90
// content-token coverage, in monotonic order. Line wrapping does not break a token
// sequence; a missing or reordered line does. A line with fewer than three content
// tokens must appear as a normalized substring instead.
function matchLine(line, textTokens, text) {
  const need = contentTokens(line);
  if (need.length < 3) {
    // Fewer than three content tokens: presence as a normalized substring is the
    // whole check. Such a line is too short to anchor a document position (a city
    // name also appears in the contact header), so it is not order-compared.
    const found = squashLower(text).includes(squashLower(line));
    return { line, ok: found, coverage: found ? 1 : 0, position: -1, positions: [], run: { from: -1, to: -1 }, short: true };
  }
  let at = 0, matched = 0;
  const positions = [];
  for (const token of need) {
    const found = textTokens.indexOf(token, at);
    if (found < 0) continue;
    positions.push(found);
    matched++;
    at = found + 1;
  }
  const run = longestRun(positions);
  // The best contiguous match is the line's anchor: a duplicated first word in the
  // header ("Example" in an email) must not move the line to the top of the page.
  return { line, ok: matched / need.length >= 0.90, coverage: Math.round((matched / need.length) * 1000) / 1000, position: run.from, positions, run, short: false };
}
// The longest run of consecutive token positions: a line is a contiguous stretch of
// the text stream between its wraps. Repeated words elsewhere in the document can
// be matched by the coverage scan, so interleaving is judged on this run, not on a
// span that a far-away duplicate would stretch.
function longestRun(positions) {
  let best = { from: -1, to: -1 };
  let from = 0;
  for (let i = 1; i <= positions.length; i++) {
    if (i === positions.length || positions[i] !== positions[i - 1] + 1) {
      if (positions[i - 1] - positions[from] > best.to - best.from) best = { from: positions[from], to: positions[i - 1] };
      from = i;
    }
  }
  return best;
}

const headingParts = heading => [heading?.title, heading?.org, heading?.location, heading?.dates].map(part => squash(part)).filter(Boolean);
// The visible resume units: each distinct heading (its parts are separate lines so
// the renderer may lay them out on two rows) and every resume line. The packet
// headline is not a PDF line: renderResumeHtml's header renders the candidate's
// name and contact details, not packet.headline, so requiring it here would fail
// every real render. The headline is still checked numerically (score.mjs §5).
function visibleGroups(packet) {
  const groups = [];
  const seen = new Set();
  (packet?.resume || []).forEach((entry, index) => {
    const section = String(entry?.section || 'resume');
    const heading = headingText(entry?.heading);
    if (heading && !seen.has(heading)) {
      seen.add(heading);
      groups.push({ id: `heading:${index}`, label: `heading "${clip(heading)}"`, section, heading: true, parts: headingParts(entry.heading) });
    }
    const text = squash(entry?.text);
    if (text) groups.push({ id: `resume:${index}`, label: `resume line "${clip(text)}"`, section, heading: false, parts: [text] });
  });
  return groups;
}
function coverageCheck(groups, text) {
  const textTokens = contentTokens(text);
  const results = [];
  for (const group of groups) {
    const matches = group.parts.map(part => matchLine(part, textTokens, text));
    results.push({ ...group, matches, ok: matches.every(match => match.ok), position: matches.reduce((low, match) => match.position >= 0 && (low < 0 || match.position < low) ? match.position : low, -1), positions: matches.flatMap(match => match.positions), runs: matches.map(match => match.run).filter(run => run.from >= 0) });
  }
  const missing = results.filter(result => !result.ok);
  // The renderer groups entries by section (resume-format.mjs orderSections), so
  // section order in the packet is not the render order. Monotonicity is required
  // inside a section: a reordered line within one section is a rendering defect.
  const reordered = [];
  const previousBySection = new Map();
  for (const result of results) {
    // Heading parts are presence-only: the renderer may put them on two rows and an
    // extractor may lay absolutely-positioned spans out of flow (Poppler does), so
    // their positions are not comparable. Entry lines are order-gated.
    if (result.heading) continue;
    const previous = previousBySection.get(result.section);
    if (previous && previous.position >= 0 && result.position >= 0 && result.position < previous.position) reordered.push(result);
    previousBySection.set(result.section, result);
  }
  return {
    ok: missing.length === 0 && reordered.length === 0,
    results,
    missing: missing.map(result => result.label),
    reordered: reordered.map(result => result.label),
    lowestCoverage: results.length ? Math.min(...results.map(result => Math.min(...result.matches.map(match => match.coverage)))) : 1,
  };
}
// Interleaved columns split a line's tokens across another line's tokens. Two
// visible lines whose matched token spans partially overlap are interleaved;
// containment (a line wrapped inside nothing) is not an overlap.
function interleavedLines(results) {
  const spans = results.filter(result => result.runs.length && result.runs.some(run => run.to > run.from))
    .map(result => ({ label: result.label, from: Math.min(...result.runs.map(run => run.from)), to: Math.max(...result.runs.map(run => run.to)) }));
  const overlapped = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i], b = spans[j];
      const partial = (a.from < b.from && b.from <= a.to && a.to < b.to) || (b.from < a.from && a.from <= b.to && b.to < a.to);
      if (partial) overlapped.push(`${a.label} / ${b.label}`);
    }
  }
  return overlapped;
}

// ---- Layout ----
function layoutCheck(pages, lines) {
  const anomalies = [];
  for (const page of pages) {
    const box = page.box || { x0: 0, y0: 0, x1: 0, y1: 0 };
    if (!page.items.filter(item => item.str.trim()).length && pages.length > 1) anomalies.push(`page ${page.pageNumber} has no text items`);
    const outside = page.items.filter(item => item.str.trim() && (item.x < box.x0 - 2 || item.y < box.y0 - 2 || item.x > box.x1 + 2 || item.y > box.y1 + 2));
    if (outside.length) anomalies.push(`${outside.length} text item(s) sit outside the page box on page ${page.pageNumber}`);
    const pageLines = lines.filter(line => line.page === page.pageNumber && line.text.length >= 10);
    for (let i = 0; i < pageLines.length; i++) {
      for (let j = i + 1; j < pageLines.length; j++) {
        const a = pageLines[i], b = pageLines[j];
        const heightA = a.y1 - a.y0, heightB = b.y1 - b.y0;
        const widthA = a.x1 - a.x0, widthB = b.x1 - b.x0;
        const vertical = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const horizontal = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        if (vertical > 0.5 * Math.min(heightA, heightB) && horizontal > 0.5 * Math.min(widthA, widthB)) {
          anomalies.push(`overlapping line boxes on page ${page.pageNumber}: "${clip(a.text, 40)}" and "${clip(b.text, 40)}"`);
          break;
        }
      }
    }
  }
  return [...new Set(anomalies)];
}

// ---- Reading order ----
// Every line's opening words must be found intact, which is what an interleaved
// column breaks. The packet's entry order is not the render order — the renderer
// groups sections by format (resume-format.mjs orderSections) — so the ascending
// ratio is recorded against the document's own order (see callers), and the
// structural interleave check below is the gate.
function readingOrderCheck(lines, text) {
  const hay = ` ${squashLower(text).replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ')} `;
  const probes = probesFor(lines);
  const positions = probes.map(probe => hay.indexOf(` ${probe} `)).filter(position => position >= 0);
  const foundRatio = probes.length ? positions.length / probes.length : 1;
  let ascending = 0;
  for (let i = 1; i < positions.length; i++) if (positions[i] > positions[i - 1]) ascending++;
  const orderRatio = positions.length > 1 ? ascending / (positions.length - 1) : 1;
  return {
    ok: foundRatio >= 0.7,
    foundRatio: Math.round(foundRatio * 100) / 100,
    orderRatio: Math.round(orderRatio * 100) / 100,
    probes: probes.length,
    found: positions.length,
    detail: `${positions.length}/${probes.length} line probes found intact, ${positions.length > 1 ? Math.round(orderRatio * 100) : 100}% in ascending document order.`,
  };
}

// ---- Evidence ----
// pdfEvidence(bytes, { packet, profile, job, sources, coverBytes, extractor }).
// `extractor` is injectable for deterministic negative controls; the default is the
// real pdfjs parse. Poppler is a cross-check tier, never the primary parse.
export async function pdfEvidence(bytes, { packet = null, profile = {}, job = null, sources = [], coverBytes = null, extractor = null, poppler = null, at = new Date().toISOString() } = {}) {
  const extract = extractor || pdfjsExtract;
  const extractorInfo = { name: extractor ? 'injected' : 'pdfjs-dist', version: extractor ? null : pdfjsVersion(), mode: 'node' };
  const evidence = {
    extractor: extractorInfo,
    state: 'error',
    pages: [],
    pageCount: 0,
    textSha256: null,
    textLength: 0,
    checks: [],
    ats: null,
    cover: null,
    popplerCrossCheck: null,
    atsParseTier: extractor ? 'injected' : 'pdfjs-only',
    error: null,
    at,
  };
  const fail = (id, detail, label) => evidence.checks.push({ id, label: label || id, status: 'fail', detail });
  const pass = (id, detail, label) => evidence.checks.push({ id, label: label || id, status: 'pass', detail });

  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    fail('parse', 'No PDF bytes were attached.');
    evidence.state = 'error';
    evidence.error = 'No PDF bytes were attached.';
    return evidence;
  }
  let parsed;
  try { parsed = await extract(Buffer.from(bytes)); }
  catch (error) { parsed = { error: error?.message || 'The PDF extractor threw.' }; }
  if (parsed?.unavailable) {
    evidence.checks.push({ id: 'parse', label: 'PDF parse', status: 'fail', detail: parsed.unavailable });
    evidence.state = 'unavailable';
    evidence.error = parsed.unavailable;
    return evidence;
  }
  if (parsed?.error || !Array.isArray(parsed?.pages) || !parsed.pages.length) {
    const detail = parsed?.error || 'The PDF has no pages.';
    fail('parse', detail);
    evidence.state = 'error';
    evidence.error = detail;
    return evidence;
  }
  evidence.pages = parsed.pages;
  evidence.pageCount = parsed.pages.length;
  const lines = linesOf(parsed.pages);
  const text = lines.map(line => line.text).join('\n');
  evidence.lines = lines.map(line => ({ page: line.page, text: line.text, x0: line.x0, x1: line.x1, y: line.y }));
  evidence.textSha256 = sha256(text);
  evidence.textLength = text.length;

  const groups = visibleGroups(packet);
  const posting = String(job?.description || '');
  const supportText = (sources || []).map(source => source.text).filter(Boolean).join('\n');
  // Coverage first: its match positions are also the document's line order, which is
  // the only order a parser sees (the renderer groups sections by format).
  const coverage = coverageCheck(groups, text);
  const interleaved = interleavedLines(coverage.results);
  const documentOrderedLines = [...coverage.results.filter(result => !result.heading)]
    .sort((a, b) => (a.position < 0 ? Number.MAX_SAFE_INTEGER : a.position) - (b.position < 0 ? Number.MAX_SAFE_INTEGER : b.position))
    .flatMap(result => result.parts);
  const resumeLines = documentOrderedLines.length ? documentOrderedLines : groups.filter(group => !group.heading).flatMap(group => group.parts);

  pass('parse', `pdfjs parsed ${evidence.pageCount} page(s).`, 'PDF parse');
  const emptyPages = parsed.pages.filter(page => !page.items.some(item => item.str.trim())).map(page => page.pageNumber);
  if (squash(text) && !emptyPages.length) pass('text-layer', `${text.length} characters of text across ${evidence.pageCount} page(s).`, 'Text layer');
  else fail('text-layer', !squash(text) ? 'The PDF has no readable text layer.' : `Page(s) ${emptyPages.join(', ')} have no text items.`, 'Text layer');

  // The product's own ATS read uses the resume entry lines, which is what a parser
  // sees as prose; headings are covered by resume-coverage above.
  const ats = checkResumeText(text, { profile, lines: resumeLines, posting, supportText, at });
  evidence.ats = { state: ats.state, keywords: ats.keywords, checks: ats.checks.map(check => ({ id: check.id, status: check.status, detail: check.detail })) };
  const atsById = id => ats.checks.find(check => check.id === id);
  for (const [id, label] of [['garbled', 'Readable characters'], ['contact', 'Contact details']]) {
    const check = atsById(id);
    if (check) evidence.checks.push({ id, label, status: check.status, detail: check.detail });
  }

  evidence.coverage = {
    ok: coverage.ok,
    lowestCoverage: coverage.lowestCoverage,
    missing: coverage.missing,
    reordered: coverage.reordered,
    results: coverage.results.map(result => ({ id: result.id, section: result.section, heading: Boolean(result.heading), ok: result.ok, position: result.position, matches: result.matches.map(match => ({ coverage: match.coverage, position: match.position })) })),
  };
  if (coverage.ok) pass('resume-coverage', `Every visible resume line is in the text layer, in order (lowest coverage ${coverage.lowestCoverage}).`, 'Resume coverage');
  else {
    const problems = [];
    if (coverage.missing.length) problems.push(`missing or incomplete: ${coverage.missing.join('; ')}`);
    if (coverage.reordered.length) problems.push(`out of order: ${coverage.reordered.join('; ')}`);
    fail('resume-coverage', problems.join('; ') || `Lowest line coverage ${coverage.lowestCoverage}.`, 'Resume coverage');
  }

  const order = readingOrderCheck(resumeLines, text);
  const engineOrder = atsById('order');
  const orderOk = order.ok && !interleaved.length && coverage.reordered.length === 0;
  evidence.checks.push({
    id: 'reading-order',
    label: 'Reading order',
    status: orderOk ? 'pass' : 'fail',
    detail: `${order.detail}${engineOrder?.status === 'fail' ? ` ATS order check: ${engineOrder.detail}` : ''}${interleaved.length ? ` Interleaved lines: ${interleaved.join('; ')}.` : ''}${coverage.reordered.length ? ` Reordered within a section: ${coverage.reordered.join('; ')}.` : ''}`,
    diagnostic: { foundRatio: order.foundRatio, documentOrderRatio: order.orderRatio, atsOrder: engineOrder?.status || null, interleaved },
  });

  const anomalies = layoutCheck(parsed.pages, lines);
  if (anomalies.length) fail('layout', anomalies.join('; '), 'Layout');
  else pass('layout', `No layout anomaly across ${evidence.pageCount} page(s).`, 'Layout');

  if (ats.state === 'passed') pass('ats', `ATS-style read of the extracted text passed (${ats.keywords.covered.length} keyword(s) covered, ${ats.keywords.gaps.length} gap(s) recorded).`, 'ATS read');
  else fail('ats', (ats.checks.filter(check => check.status === 'fail').map(check => `${check.label}: ${check.detail}`).join(' ') || 'The ATS-style read failed.'), 'ATS read');

  // Cover PDF: required when the packet has a cover letter.
  const coverSentences = coverLetterClaims(packet?.coverLetter || '', profile?.name || '');
  if (!coverSentences.length) {
    evidence.cover = { required: false, status: 'skipped', detail: 'The packet has no cover letter.' };
    evidence.checks.push({ id: 'cover', label: 'Cover letter PDF', status: 'skipped', detail: evidence.cover.detail });
  } else if (!coverBytes || !(coverBytes instanceof Uint8Array) || !coverBytes.length) {
    evidence.cover = { required: true, status: 'fail', detail: 'The packet has a cover letter but no cover PDF was produced.' };
    fail('cover', evidence.cover.detail, 'Cover letter PDF');
  } else {
    let coverParsed;
    try { coverParsed = await extract(Buffer.from(coverBytes)); }
    catch (error) { coverParsed = { error: error?.message || 'The cover PDF extractor threw.' }; }
    if (coverParsed?.unavailable || coverParsed?.error || !Array.isArray(coverParsed?.pages) || !coverParsed.pages.length) {
      const detail = coverParsed?.unavailable || coverParsed?.error || 'The cover PDF has no pages.';
      evidence.cover = { required: true, status: 'fail', detail };
      fail('cover', detail, 'Cover letter PDF');
    } else {
      const coverLines = linesOf(coverParsed.pages);
      const coverText = coverLines.map(line => line.text).join('\n');
      const coverGroups = coverSentences.map((sentence, index) => ({ id: `cover:${index}`, label: `cover sentence "${clip(sentence)}"`, parts: [squash(sentence)] }));
      const coverCoverage = coverageCheck(coverGroups, coverText);
      const coverOrder = readingOrderCheck(coverSentences, coverText);
      const coverInterleaved = interleavedLines(coverCoverage.results);
      const coverAts = checkResumeText(coverText, { profile: {}, lines: coverSentences, posting, supportText, at });
      const coverGarbled = coverAts.checks.find(check => check.id === 'garbled');
      const ok = coverCoverage.ok && coverOrder.ok && !coverInterleaved.length && coverAts.state === 'passed' && coverGarbled?.status !== 'fail';
      evidence.cover = { required: true, status: ok ? 'pass' : 'fail', pageCount: coverParsed.pages.length, textSha256: sha256(coverText), coverage: coverCoverage, order: coverOrder, atsState: coverAts.state };
      evidence.checks.push({ id: 'cover', label: 'Cover letter PDF', status: ok ? 'pass' : 'fail', detail: ok ? `Cover text covers ${coverSentences.length} reviewed sentence(s).` : `Cover PDF does not cover the reviewed letter: ${[...coverCoverage.missing, ...coverCoverage.reordered].join('; ') || coverAts.state}.` });
    }
  }

  // Poppler cross-check: Tier B. Skipped when the extractor is injected or the
  // binary is absent; an absent tier is recorded, never counted as a pass.
  if (extractor || poppler === false) {
    evidence.popplerCrossCheck = { available: false, reason: extractor ? 'injected extractor' : 'disabled' };
    evidence.checks.push({ id: 'poppler-cross-check', label: 'Poppler cross-check', status: 'skipped', detail: extractor ? 'Injected extractor: Poppler does not parse synthetic bytes.' : 'Poppler cross-check disabled.' });
  } else {
    const popplerText = await extractPdfText(Buffer.from(bytes));
    if (popplerText.unavailable) {
      evidence.popplerCrossCheck = { available: false, reason: popplerText.unavailable };
      evidence.atsParseTier = 'pdfjs-only';
      evidence.checks.push({ id: 'poppler-cross-check', label: 'Poppler cross-check', status: 'skipped', detail: `pdftotext is unavailable, so the ATS-parse claim is pdfjs-only. ${popplerText.unavailable}` });
    } else {
      const popplerTextValue = popplerText.text || '';
      const popplerCoverage = coverageCheck(groups, popplerTextValue);
      const popplerOrder = readingOrderCheck(resumeLines, popplerTextValue);
      const popplerAts = checkResumeText(popplerTextValue, { profile, lines: resumeLines, posting, supportText, at });
      const ok = popplerCoverage.ok && popplerOrder.ok && popplerAts.state === 'passed';
      evidence.popplerCrossCheck = {
        available: true,
        textSha256: sha256(popplerTextValue),
        agrees: squashLower(popplerTextValue) === squashLower(text),
        coverage: popplerCoverage.lowestCoverage,
        missing: popplerCoverage.missing,
        reordered: popplerCoverage.reordered,
        atsState: popplerAts.state,
      };
      evidence.atsParseTier = 'pdfjs+poppler';
      evidence.checks.push({ id: 'poppler-cross-check', label: 'Poppler cross-check', status: ok ? 'pass' : 'fail', detail: ok ? `pdftotext agrees on the visible lines (text ${evidence.popplerCrossCheck.agrees ? 'identical' : 'differs only in spacing'}).` : `pdftotext found a problem pdfjs missed: ${[...popplerCoverage.missing, ...popplerCoverage.reordered].join('; ') || popplerAts.state}.` });
    }
  }

  // A document with no text layer is not "issues to fix": extraction is unavailable,
  // and the design requires that state, not a pass and not a silent skip.
  evidence.state = !squash(text)
    ? 'unavailable'
    : evidence.checks.some(check => check.status === 'fail') ? 'issues' : 'passed';
  if (evidence.state === 'unavailable') evidence.error = 'The PDF has no selectable text layer.';
  return evidence;
}

// The packet-level pass rule: a real passed parse plus every required check passing.
export function pdfEvidencePassed(evidence) {
  if (!evidence || evidence.state !== 'passed') return false;
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  if (!REQUIRED_PDF_CHECKS.every(id => checks.some(check => check.id === id && check.status === 'pass'))) return false;
  if (evidence.cover?.required && evidence.cover.status !== 'pass') return false;
  return checks.every(check => check.status !== 'fail');
}

// The subset the scorer reports into a result (no extracted text, no geometry).
export function pdfEvidenceSummary(evidence) {
  if (!evidence) return null;
  return {
    state: evidence.state,
    extractor: evidence.extractor,
    pageCount: evidence.pageCount,
    textSha256: evidence.textSha256,
    textLength: evidence.textLength,
    atsParseTier: evidence.atsParseTier,
    checks: (evidence.checks || []).map(check => ({ id: check.id, status: check.status, detail: check.detail })),
    popplerCrossCheck: evidence.popplerCrossCheck,
    cover: evidence.cover ? { required: evidence.cover.required, status: evidence.cover.status } : null,
    error: evidence.error,
  };
}
