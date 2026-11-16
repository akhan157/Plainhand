// The candidate's own writing samples, measured into a deterministic register target.
// The drafting and humanizer passes receive it as INPUT.voiceTarget; a humanized
// rewrite is then checked against the same samples with the pre-registered voice
// distance (plainhand/voice-metrics.mjs, imported, never changed here). Samples set
// style only: they are never facts or evidence.
import { voiceDistance, voiceFeatures } from './voice-metrics.mjs';

export const sampleText = samples => (Array.isArray(samples) ? samples : [])
  .map(sample => (typeof sample === 'string' ? sample : sample?.text))
  .filter(text => typeof text === 'string' && text.trim())
  .join('\n\n');

// One sentence or a greeting is not a voice; a target guessed from it would override
// the drafter with no evidence.
const MIN_SENTENCES = 2, MIN_WORDS = 20;
// One contraction per 100 words is written use, not a slip; formal samples have none.
const CONTRACTION_USE = 0.01;
// One formal marker per 100 words, or long sentences on their own, read formal. Short
// sentences read plain; anything between is neutral and only bounds sentence length.
const FORMAL_MARKERS = 1, FORMAL_LENGTH = 22, PLAIN_LENGTH = 15;

// The connectives and stock phrases that mark a register, the same stock the frozen
// formality measure counts plus a small casual list. A phrase is reported only when the
// candidate's own samples use it, so the target names their voice rather than a
// generic one. Every phrase here is a style marker, not an AI tell: humanize.mjs never
// lists one of them in AI_WORDS.
export const REGISTER_PHRASES = Object.freeze([
  ['formal', 'furthermore'], ['formal', 'moreover'], ['formal', 'therefore'], ['formal', 'thus'],
  ['formal', 'hence'], ['formal', 'consequently'], ['formal', 'nevertheless'], ['formal', 'notwithstanding'],
  ['formal', 'approximately'], ['formal', 'pursuant'], ['formal', 'hereby'], ['formal', 'herein'],
  ['formal', 'thereby'], ['formal', 'commence'], ['formal', 'endeavour'], ['formal', 'utilise'],
  ['formal', 'utilize'], ['formal', 'regarding'], ['formal', 'with respect to'], ['formal', 'prior to'],
  ['formal', 'in order to'], ['formal', 'at your earliest convenience'], ['formal', 'please find'],
  ['formal', 'i am writing'], ['formal', 'sincerely'], ['formal', 'respectfully'], ['formal', 'shall'],
  ['formal', 'whom'], ['formal', 'i would like'], ['formal', 'do not hesitate'], ['formal', 'in addition'],
  ['formal', 'kindly'], ['formal', 'i would welcome'], ['formal', 'accordingly'],
  ['casual', "i'm"], ['casual', "i've"], ['casual', "i'll"], ['casual', "i'd"], ['casual', 'really'],
  ['casual', 'pretty'], ['casual', 'just'], ['casual', 'a bit'], ['casual', 'kind of'], ['casual', 'sort of'],
  ['casual', 'totally'], ['casual', 'super'], ['casual', 'gonna'], ['casual', 'wanna'], ['casual', 'hey'],
  ['casual', 'quick'], ['casual', 'actually'], ['casual', 'stuff'], ['casual', 'things'], ['casual', 'folks'],
  ['casual', 'guys'], ['casual', 'you know'],
]);
const PHRASE_LIMIT = 10;
const escapePhrase = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const per100 = (count, words) => Math.round(count * 1000 / Math.max(1, words)) / 10;
// Only phrases the samples use, most used first. The rate is per 100 words of the
// samples, the same scale the formality measure uses.
function registerPhrasesOf(text, words) {
  const lower = String(text || '').replace(/[\u2018\u2019]/g, "'").toLowerCase();
  return REGISTER_PHRASES.map(([register, phrase]) => {
    const count = (lower.match(new RegExp(`(?<![a-z0-9])${escapePhrase(phrase)}(?![a-z0-9])`, 'g')) || []).length;
    return count ? { phrase, register, count, per100: per100(count, words) } : null;
  }).filter(Boolean).sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
}

export function voiceTargetOf(samples) {
  const text = sampleText(samples);
  if (!text) return null;
  const features = voiceFeatures(text);
  if (features.sentences < MIN_SENTENCES || features.words < MIN_WORDS) return null;
  const sentenceLength = Math.max(1, Math.round(features.meanSentenceLength));
  const phrases = registerPhrasesOf(text, features.words);
  const register = features.formalityRate >= FORMAL_MARKERS || sentenceLength >= FORMAL_LENGTH ? 'formal'
    : sentenceLength <= PLAIN_LENGTH ? 'plain' : 'neutral';
  // The rate counts only the phrases of the register the samples are written in
  // (casual phrases for a plain or neutral voice), and multi-word casual phrases only,
  // since one-word fillers ("just", "actually") are what the humanizer cuts. It is
  // summed over every phrase found, then capped at one phrase per sentence.
  const own = phrases.filter(item => (register === 'formal' ? item.register === 'formal' : item.register === 'casual' && (item.phrase.includes(' ') || item.phrase.includes("'"))));
  const rate = Math.min(Math.round(own.reduce((sum, item) => sum + item.per100, 0) * 10) / 10, Math.round(1000 / sentenceLength) / 10);
  return {
    sentenceLength,
    contractions: features.contractionRate >= CONTRACTION_USE ? 'use' : 'avoid',
    register,
    // Only the phrases of the samples' own register, so a formal letter is never
    // handed casual fillers from a stray informal note.
    registerPhrases: phrases.filter(item => (register === 'formal') === (item.register === 'formal')).slice(0, PHRASE_LIMIT),
    // Their combined rate, so the drafter has one number to write to rather than a
    // list of small per-phrase rates it tends to undershoot.
    ...(rate > 0 ? { registerRate: rate } : {}),
  };
}

// How far a letter sits from the samples' own prose. The same voiceDistance the
// synthetic contrast measures, so a rewrite can be compared with the draft it replaced.
export function voiceDrift(before, after, samples) {
  const text = sampleText(samples);
  if (!text || typeof before !== 'string' || typeof after !== 'string') return null;
  const draft = voiceDistance(before, text), rewrite = voiceDistance(after, text);
  return { before: draft, after: rewrite, drifted: rewrite > draft };
}
