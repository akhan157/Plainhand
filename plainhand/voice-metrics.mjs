// Deterministic surface measures for comparing a draft with the candidate's own
// writing. Voice is style, not truth: these numbers rank sentence length,
// contractions and a fixed list of formal markers. They never judge content, and a
// synthetic comparison is not evidence about a real candidate's voice.

const CONTRACTION = /\b(?:i'm|i've|i'll|i'd|you're|you've|you'll|you'd|we're|we've|we'll|we'd|they're|they've|they'll|they'd|it's|that's|there's|what's|here's|who's|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|can't|couldn't|won't|wouldn't|shouldn't|hasn't|haven't|hadn't|let's|he's|she's)\b/gi;

const FORMAL = Object.freeze([
  'furthermore', 'moreover', 'therefore', 'thus', 'hence', 'consequently', 'nevertheless', 'notwithstanding',
  'approximately', 'pursuant', 'hereby', 'herein', 'thereby', 'commence', 'endeavour', 'endeavor',
  'utilise', 'utilize', 'regarding', 'with respect to', 'prior to', 'in order to',
  'at your earliest convenience', 'please find', 'i am writing', 'sincerely', 'respectfully', 'shall', 'whom',
]);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FORMAL_RE = new RegExp(`\\b(?:${FORMAL.map(escape).join('|')})\\b`, 'gi');
const round = (value, places) => { const scale = 10 ** places; return Math.round(value * scale) / scale; };

function sentences(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return clean.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(sentence => /[A-Za-z0-9]/.test(sentence));
}

function words(text) {
  return String(text ?? '').match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
}

export function voiceFeatures(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const list = sentences(clean), wordCount = words(clean).length;
  const contractions = (clean.match(CONTRACTION) || []).length;
  const formal = (clean.match(FORMAL_RE) || []).length;
  return {
    sentences: list.length,
    words: wordCount,
    meanSentenceLength: list.length ? round(wordCount / list.length, 2) : 0,
    contractionRate: wordCount ? round(contractions / wordCount, 4) : 0,
    formalityRate: wordCount ? round(formal * 100 / wordCount, 3) : 0,
    contractionMarkers: contractions,
    formalityMarkers: formal,
  };
}

// The scales set what one unit of difference means: 20 words per sentence, a 5%
// contraction rate and two formal markers per 100 words are each "one step".
const SCALES = Object.freeze({ meanSentenceLength: 20, contractionRate: 0.05, formalityRate: 2 });

export function voiceDistance(a, b) {
  const left = voiceFeatures(a), right = voiceFeatures(b);
  const total = Object.keys(SCALES).reduce((sum, key) => sum + Math.abs((left[key] || 0) - (right[key] || 0)) / SCALES[key], 0);
  return round(total / Object.keys(SCALES).length, 4);
}

// Which sample set a draft sounds closer to. closerToOwn is strict: a tie (including
// two empty sample sets) is not evidence that the voice was matched.
export function voiceAttribution({ letter, own, other }) {
  const ownDistance = voiceDistance(letter, own);
  const otherDistance = voiceDistance(letter, other);
  return { ownDistance, otherDistance, closerToOwn: ownDistance < otherDistance, margin: round(otherDistance - ownDistance, 4) };
}
