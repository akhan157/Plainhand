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

export function voiceTargetOf(samples) {
  const text = sampleText(samples);
  if (!text) return null;
  const features = voiceFeatures(text);
  if (features.sentences < MIN_SENTENCES || features.words < MIN_WORDS) return null;
  const sentenceLength = Math.max(1, Math.round(features.meanSentenceLength));
  return {
    sentenceLength,
    contractions: features.contractionRate >= CONTRACTION_USE ? 'use' : 'avoid',
    register: features.formalityRate >= FORMAL_MARKERS || sentenceLength >= FORMAL_LENGTH ? 'formal'
      : sentenceLength <= PLAIN_LENGTH ? 'plain' : 'neutral',
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
