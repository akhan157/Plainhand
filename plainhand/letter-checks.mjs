// Cover-letter quality, checked without a model. A letter must tell the story behind
// the resume line: the situation, how the work was done and why it mattered. A
// sentence that repeats a long run of a resume line is restating the resume, so it is
// flagged for the one redraft the prepare loop already makes. Quality only: this
// check never blocks a packet and never adds a model call of its own.

export const MIN_OVERLAP_WORDS = 8;

// Function words do not carry an accomplishment, so they are compared out before the
// run is measured. Both sides lose the same words, so a shared phrase still lines up.
const STOPWORDS = new Set('a an the and or but nor so yet if then than that this these those there here i me my mine we us our you your he him his she her it its they them their to of in on at by for with from as into onto about over under again further once is are was were be been being am do does did doing have has had having can could will would shall should may might must not no'.split(' '));

const wordList = value => (String(value ?? '').toLowerCase().replace(/[\u2019']/g, '').match(/[a-z0-9]+/g) || []);
const contentWords = value => wordList(value).filter(word => !STOPWORDS.has(word));
const sentences = value => String(value ?? '').split(/\n+/).flatMap(part => part.split(/(?<=[.!?])\s+/)).map(part => part.trim()).filter(Boolean);
export const condensed = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The longest run of words in `a` that appears contiguously in `b`, or null when it
// is shorter than the threshold. O(words(a) * words(b)), tiny at letter size.
function sharedRun(a, b) {
  let best = 0, end = 0;
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      current[j] = previous[j - 1] + 1;
      if (current[j] > best) { best = current[j]; end = i; }
    }
    previous = current;
  }
  return best >= MIN_OVERLAP_WORDS ? { phrase: a.slice(end - best, end).join(' '), words: best } : null;
}

// Letter sentences that repeat a resume line. Each hit names the sentence as written,
// the shared phrase and the resume line it came from, so the redraft can rewrite it.
export function letterOverlaps(coverLetter, resume = []) {
  const lines = (Array.isArray(resume) ? resume : [])
    .map((entry, index) => ({ index, text: String(entry?.text ?? '').trim(), section: String(entry?.section ?? ''), words: contentWords(entry?.text) }))
    .filter(line => line.text && line.words.length >= MIN_OVERLAP_WORDS);
  const found = [];
  for (const sentence of sentences(coverLetter)) {
    const words = contentWords(sentence);
    if (words.length < MIN_OVERLAP_WORDS) continue;
    for (const line of lines) {
      const run = sharedRun(words, line.words);
      if (run) found.push({ sentence, section: line.section, index: line.index, phrase: run.phrase, words: run.words });
    }
  }
  return found;
}

// Retry feedback for the existing reviewFeedback pass: name the overlapping sentences
// and tell the drafter what the letter should say instead. Empty when nothing overlaps.
export function letterRetryFeedback(overlaps, limit = 3) {
  if (!overlaps.length) return [];
  return ['The cover letter repeats resume lines word for word. Rewrite each flagged sentence in fresh words, never the resume line itself. Add the situation, how the work was done and why it mattered only where a story, interview or narrative source states them; when none does, reword the same evidenced work and add nothing:', ...overlaps.slice(0, limit).map(item => `Letter sentence "${condensed(item.sentence, 180)}" repeats "${item.phrase}" from a ${item.section || 'resume'} line.`)];
}

// The final-attempt record: quality, not a factual finding, so the packet is kept.
export function overlapSuggestion(overlaps) {
  const first = overlaps[0];
  const count = overlaps.length === 1 ? 'one sentence' : `${overlaps.length} sentences`;
  return `Cover letter quality (not a factual issue): ${count} restate the resume word for word. "${condensed(first.sentence, 160)}" repeats a resume line; rewrite it as the story behind the line on the next draft.`;
}
