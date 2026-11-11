// Deterministic posting check. Runs on every job description before any AI provider sees it.
//
// A posting is untrusted input: an employer page (or anyone who can edit one) can hide text
// meant for AI tools rather than applicants. This module does no model calls. It
//   - strips invisible characters (zero-width, bidirectional controls, Unicode tag characters
//     and variation-selector smuggling) and decodes any message hidden in tag characters,
//   - withholds sentences addressed to AI tools ("ignore previous instructions", "if you are
//     an AI", chat-template markers) from the copy sent to the provider,
//   - folds in passages the browser verifier found hidden on the live page (transparent,
//     tiny, same-colour-as-background, off-screen or screen-reader-only text, and the links
//     inside them).
// The stored job.description stays exactly what the candidate saved; only the provider copy
// changes, so packet staleness hashes are unaffected.

export const WITHHELD = '[Plainhand withheld a sentence here: it was addressed to AI tools, not applicants.]';

// Tag characters (U+E0000–U+E007F) mirror ASCII and render as nothing: a hidden message.
const TAG = /[\u{E0000}-\u{E007F}]/gu;
// Variation selectors supplement: invisible, used to smuggle bytes after a visible character.
const VS_SUPPLEMENT = /[\u{E0100}-\u{E01EF}]/gu;
const BIDI = /[‪-‮⁦-⁩]/g;
const ZERO_WIDTH = /[​‌⁠⁡-⁤᠎]|(?<!^)﻿/g;
// A zero-width joiner is legitimate inside emoji sequences (👩‍💻); elsewhere it is invisible noise.
const LONE_ZWJ = /(?<![\p{Extended_Pictographic}️\u{1F3FB}-\u{1F3FF}])‍|‍(?!\p{Extended_Pictographic})/gu;
// Stripped without counting: legitimate on real pages but useless to a model.
const SILENT = /[­‎‏]|^﻿/g;

const AI = String.raw`(?:an?\s+)?(?:ai|a\.i\.|llm|large language model|language model|chat ?bot|bot|ai (?:assistant|agent|model|tool|system)|automated (?:system|tool|screener|agent|assistant)|gpt|chatgpt|claude|gemini|copilot)`;
// "an AI engineer", "a bot developer": a job, not an addressee.
const NOT_A_ROLE = String.raw`(?!s?\s*[-/&]?\s*(?:engineer|research|scien|develop|special|architect|lead|manag|product|platform|team|enthusias|practition|expert|native|first|ethic|train|tutor|annotat|safety|ops|infra|and\b|or\b|\/))`;
const QUALIFIER = String.raw`(?:previous|prior|above|earlier|preceding|foregoing|system|your|my|all\s+(?:of\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding|your|other|system))`;
const ADDRESSED_TO_AI = [
  // "Ignore all previous instructions", "disregard the above instructions", "forget your prompt".
  new RegExp(String.raw`\b(?:ignore|disregard|forget|override|bypass)\s+(?:the\s+|any\s+)?${QUALIFIER}\s+(?:\w+\s+)?(?:instructions?|prompts?|directions|directives|context)\b`, 'i'),
  /\b(?:ignore|disregard|forget)\s+(?:everything|all)\s+(?:above|before\s+this|you\s+(?:were|have\s+been)\s+told)\b/i,
  // "If you are an AI…", "If you're a language model reading this…".
  new RegExp(String.raw`\b(?:if|when|since)\s+(?:you\s+are|you're|you\s+were)\s+${AI}\b${NOT_A_ROLE}`, 'i'),
  // "Note to AI tools:", "Instructions for automated screeners —", "Attention LLMs:".
  new RegExp(String.raw`\b(?:note|message|instructions?|attention|hey|hello|dear)\s*(?:to|for)?\s*(?:all\s+|any\s+)?(?:the\s+)?${AI}s?\b(?:\s+(?:tools?|systems?|readers?|models?|screeners?|reading\s+this))?\s*[:\u2014-]`, 'i'),
  new RegExp(String.raw`\b(?:any|all)\s+${AI}s?\s+(?:reading|processing|parsing|reviewing|summari[sz]ing|screening)\b`, 'i'),
  // Chat-template and role markers.
  /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?(?:system|instructions?)>/i,
  /^\s*(?:system|developer)\s+(?:prompt|message)\s*:/im,
  /\b(?:real|true|hidden|actual|secret)\s+(?:system\s+)?instructions?\s*:/i,
  // Attempts to steer the evaluation of this posting.
  /\b(?:rate|score|rank|grade|evaluate)\b[^.!?\n]{0,30}\b(?:this|the)\s+(?:role|job|position|posting|opening|company)\b[^.!?\n]{0,30}(?:\b(?:5\/5|10\/10|100%|highest|maximum|perfect|top)\b|\bas\s+(?:a\s+)?(?:perfect|excellent|ideal)\b)/i,
  /\b(?:you\s+must|always|be\s+sure\s+to|make\s+sure\s+to)\s+(?:recommend|rate|score|mark|approve)\s+(?:this\s+(?:role|job|position|posting|opening)|applying)\b/i,
];

export const addressedToAI = text => ADDRESSED_TO_AI.some(pattern => pattern.test(text));

const excerpt = (text, max = 160) => { const flat = String(text).replace(/\s+/g, ' ').trim(); return flat.length > max ? flat.slice(0, max - 1) + '…' : flat; };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Hidden-on-page reasons that only make sense as concealment. Off-screen and
// screen-reader-only text is common on legitimate pages (skip links, carousels), so it is
// left out of the provider copy but does not flag the posting by itself.
const DECEPTIVE = new Set(['transparent', 'tiny text', 'same colour as background']);

function stripInvisible(text) {
  let message = '';
  const counts = { tag: 0, smuggled: 0, bidi: 0, zeroWidth: 0 };
  let out = text.replace(TAG, ch => { counts.tag++; const code = ch.codePointAt(0) - 0xE0000; if (code >= 0x20 && code < 0x7F) message += String.fromCharCode(code); return ''; });
  out = out.replace(VS_SUPPLEMENT, () => { counts.smuggled++; return ''; });
  out = out.replace(BIDI, () => { counts.bidi++; return ''; });
  out = out.replace(ZERO_WIDTH, () => { counts.zeroWidth++; return ''; });
  out = out.replace(LONE_ZWJ, () => { counts.zeroWidth++; return ''; });
  out = out.replace(SILENT, '');
  return { text: out, counts, message: message.trim() };
}

// Split a line into sentences so a single injected sentence doesn't take a paragraph with it.
const sentences = line => line.split(/(?<=[.!?])\s+(?=\S)/);

function withholdAddressed(text) {
  const withheld = [];
  const lines = text.split('\n').map(line => {
    if (!addressedToAI(line)) return line;
    return sentences(line).map(sentence => {
      if (!addressedToAI(sentence)) return sentence;
      withheld.push(excerpt(sentence));
      return WITHHELD;
    }).join(' ');
  });
  // A pattern can span a sentence break; catch it at line level if sentences missed it.
  return { text: lines.join('\n'), withheld };
}

/**
 * Inspect a posting. Pure and deterministic.
 * @param {string} description the saved posting text
 * @param {{ hidden?: Array<{reason:string,text:string,links?:string[]}> }} [options]
 *   passages the browser verifier found hidden on the live page (already left out of the text)
 * @returns {{ verdict: 'clean'|'flagged', summary: string, findings: Array<object>, text: string }}
 *   text is the copy safe to send to an AI provider.
 */
export function inspectPosting(description, { hidden = [] } = {}) {
  const findings = [];
  const invisible = stripInvisible(String(description || ''));
  const { counts } = invisible;
  const invisibleTotal = counts.tag + counts.smuggled + counts.bidi + counts.zeroWidth;
  if (invisibleTotal) {
    // A handful of stray zero-width spaces is ordinary copy-paste residue; anything that can
    // carry a message, or reorders text, is not.
    const severe = counts.tag > 0 || counts.smuggled > 0 || counts.bidi > 0 || counts.zeroWidth > 20;
    findings.push({ kind: 'invisible-characters', severity: severe ? 'warn' : 'info', count: invisibleTotal,
      detail: [counts.tag && plural(counts.tag, 'tag character'), counts.smuggled && plural(counts.smuggled, 'variation selector'), counts.bidi && plural(counts.bidi, 'text-direction control'), counts.zeroWidth && plural(counts.zeroWidth, 'zero-width character')].filter(Boolean).join(', '),
      excerpts: invisible.message ? [excerpt(invisible.message)] : [] });
    if (invisible.message && addressedToAI(invisible.message)) findings.push({ kind: 'ai-addressed', severity: 'warn', count: 1, detail: 'A message hidden in invisible characters was addressed to AI tools.', excerpts: [excerpt(invisible.message)] });
  }
  const { text, withheld } = withholdAddressed(invisible.text);
  if (withheld.length) findings.push({ kind: 'ai-addressed', severity: 'warn', count: withheld.length, detail: `${plural(withheld.length, 'sentence')} addressed to AI tools, withheld from the AI.`, excerpts: withheld.slice(0, 5) });

  const passages = (Array.isArray(hidden) ? hidden : []).filter(h => h && typeof h.text === 'string' && h.text.trim());
  if (passages.length) {
    const flagged = passages.filter(h => DECEPTIVE.has(h.reason) || addressedToAI(h.text) || (h.links || []).length);
    const minor = passages.length - flagged.length;
    if (flagged.length) findings.push({ kind: 'hidden-text', severity: 'warn', count: flagged.length, detail: `${plural(flagged.length, 'passage')} hidden on the page (${[...new Set(flagged.map(h => h.reason))].join(', ')}), left out.`, excerpts: flagged.slice(0, 5).map(h => excerpt(h.text)) });
    if (minor) findings.push({ kind: 'hidden-text', severity: 'info', count: minor, detail: `${plural(minor, 'passage')} not visible on the page (off-screen or screen-reader only), left out.`, excerpts: [] });
    const links = [...new Set(passages.flatMap(h => h.links || []))];
    if (links.length) findings.push({ kind: 'hidden-links', severity: 'warn', count: links.length, detail: `${plural(links.length, 'link')} inside hidden text. Plainhand never follows links from a posting.`, excerpts: links.slice(0, 5).map(l => excerpt(l, 120)) });
  }

  const verdict = findings.some(f => f.severity === 'warn') ? 'flagged' : 'clean';
  return { verdict, summary: summarize(verdict, findings), findings, text };
}

function summarize(verdict, findings) {
  if (!findings.length) return 'Nothing hidden and nothing addressed to AI tools.';
  const parts = findings.map(f => f.kind === 'invisible-characters' ? `removed ${plural(f.count, 'invisible character')}`
    : f.kind === 'ai-addressed' ? `withheld ${plural(f.count, 'sentence')} addressed to AI tools`
    : f.kind === 'hidden-links' ? `found ${plural(f.count, 'link')} in hidden text`
    : f.severity === 'warn' ? `left out ${plural(f.count, 'hidden passage')}` : `left out ${plural(f.count, 'passage')} not shown on the page`);
  const sentence = parts.join('; ');
  return (verdict === 'flagged' ? 'Check this posting: ' : 'Clean: ') + sentence + '.';
}

/** What is stored on the job record: verdict and findings, never sent to a provider. */
export function integrityRecord(description, hidden, at = new Date().toISOString()) {
  const { verdict, summary, findings } = inspectPosting(description, { hidden });
  return { verdict, summary, findings, checkedAt: at };
}

/** The posting text an AI provider may see. */
export const providerDescription = description => inspectPosting(description).text;

/**
 * Runs inside the verification page (page.evaluate): finds rendered-but-hidden text, hides
 * it so the following body.innerText excludes it, and returns what it found. Self-contained:
 * it may not reference anything outside its own body.
 */
export function collectHiddenText() {
  const found = [];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'HEAD', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG']);
  const rgba = value => { const m = /rgba?\(([^)]+)\)/.exec(value || ''); if (!m) return null; const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean); return [Number(r), Number(g), Number(b), Number(a)]; };
  const pageWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  const background = el => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== 'none') return null; // text over an image: can't judge
      const c = rgba(style.backgroundColor);
      if (c && c[3] > 0.5) return c;
    }
    return [255, 255, 255, 1];
  };
  const reasonFor = (el, style, ownText) => {
    if (parseFloat(style.opacity) < 0.05) return 'transparent';
    const rect = el.getBoundingClientRect();
    if (rect.right < -50 || rect.bottom < -50 || rect.left > pageWidth + 50) return 'off-screen';
    const clipped = (style.clip && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)|rect\(\s*1px/.test(style.clip)) || /inset\(\s*50%|circle\(\s*0/.test(style.clipPath || '');
    if (clipped || (rect.width <= 1 && rect.height <= 1 && style.overflow === 'hidden')) return 'screen-reader only';
    if (!ownText) return null;
    if (parseFloat(style.fontSize) < 3) return 'tiny text';
    const color = rgba(style.color);
    if (color && color[3] < 0.05) return 'transparent';
    const bg = color && background(el);
    if (bg && Math.abs(color[0] - bg[0]) + Math.abs(color[1] - bg[1]) + Math.abs(color[2] - bg[2]) < 24) return 'same colour as background';
    return null;
  };
  const walk = el => {
    if (SKIP.has(el.tagName)) return;
    const style = getComputedStyle(el);
    if (style.display === 'none') return;
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const reason = style.visibility === 'hidden' ? null : reasonFor(el, style, ownText);
    if (reason) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text) {
        const links = [...(el.matches('a[href]') ? [el] : []), ...el.querySelectorAll('a[href]')].map(a => a.href).filter(h => /^https?:/i.test(h));
        found.push({ reason, text: text.slice(0, 2000), links: [...new Set(links)].slice(0, 10) });
        el.style.setProperty('display', 'none', 'important');
      }
      return;
    }
    for (const child of [...el.children]) walk(child);
  };
  if (document.body) walk(document.body);
  return found.slice(0, 50);
}
