// Deterministic provider for controlled evaluation runs. It proves the harness,
// workflow and server-side submission path. It is not evidence about model
// quality; live runs pass --provider and use the app's real agent.
import {
  EVALUATE_INSTRUCTION,
  INTERVIEW_INSTRUCTION,
  PACKET_INSTRUCTION,
  REVIEW_INSTRUCTION,
  FORM_INSTRUCTION,
  STANDARD_INSTRUCTION,
} from '../agents.mjs';
import { HUMANIZE_INSTRUCTION } from '../humanize.mjs';
import { NAVIGATION_INSTRUCTION } from '../browser-driver.mjs';
import { fixtureAgent } from '../test-fixtures.mjs';
import { absentClaimsIn } from './corpus.mjs';

const numberTokens = text => (String(text || '').match(/\d[\d.,]*%?/g) || []);

function quoteEvidence(quote, context) {
  const source = (context?.sources || []).find(item => item.id !== 'reviewed-understanding' && String(item.text || '').includes(quote));
  return source ? [{ sourceId: source.id, quote }] : null;
}

// A controlled run may only use what the profile context actually contains.
// This is what makes the minimal/built/seeded profile comparison meaningful:
// a fact that the conversation did not capture must not appear in the packet.
function availableFacts(persona, context) {
  const text = (context?.sources || []).map(source => source.text || '').join('\n');
  return persona.facts.filter(fact => text.includes(fact.text));
}

function fallbackEvidence(context, persona) {
  const source = (context?.sources || []).find(item => item.id !== 'reviewed-understanding' && String(item.text || '').trim().length >= 8);
  if (source) {
    const quote = String(source.text).split(/\n/).map(line => line.trim()).find(line => line.length >= 8 && line.length <= 300);
    if (quote) return [{ sourceId: source.id, quote }];
  }
  return [{ sourceId: 'cv', quote: persona.degreeEvidence }];
}

function evidenceFor(persona, fact, context) {
  return quoteEvidence(fact.text, context) || fallbackEvidence(context, persona);
}

function factSection(fact) {
  if (['tools', 'sql'].includes(fact.id)) return 'Skills';
  if (['fsae', 'app', 'dashboard', 'design-system', 'editorial', 'scheduling'].includes(fact.id)) return 'Projects';
  return 'Experience';
}

function resumeEntries(persona, job, context, facts) {
  const required = job.requiredFactIds.map(id => facts.find(f => f.id === id)).filter(Boolean);
  const rest = facts.filter(f => !required.includes(f));
  const chosen = [...required, ...rest].slice(0, 5);
  return chosen.map(fact => ({
    section: factSection(fact),
    heading: fact.id === 'pumps' || fact.id === 'ta' ? { org: persona.employer, title: persona.title, location: persona.profile.location.split(',')[0], dates: persona.dates } : null,
    text: fact.text,
    evidence: evidenceFor(persona, fact, context),
  }));
}

function packetFor(persona, job, context) {
  const facts = availableFacts(persona, context);
  const fact = job.requiredFactIds.map(id => facts.find(f => f.id === id)).find(Boolean) || facts[0] || null;
  const educationEvidence = quoteEvidence(persona.degreeEvidence, context) || fallbackEvidence(context, persona);
  return {
    headline: `${persona.profile.roles.split(',')[0]} for ${job.title}`,
    resume: [
      ...resumeEntries(persona, job, context, facts),
      {
        section: 'Education',
        heading: null,
        text: persona.degreeEvidence,
        evidence: educationEvidence,
      },
    ],
    coverLetter: `I am applying for the ${job.title} role at ${job.company}.${persona.profile.story ? ' ' + persona.profile.story : ''}${fact ? ' ' + fact.text : ''}`,
    answers: fact ? [{ question: 'Describe a relevant project.', answer: fact.text, evidence: evidenceFor(persona, fact, context) }] : [],
    questions: [],
    suggestions: [],
  };
}

function standardFor(persona, context) {
  const facts = availableFacts(persona, context);
  const entries = facts.map(fact => ({ section: factSection(fact), heading: null, text: fact.text, evidence: evidenceFor(persona, fact, context) }));
  entries.push({ section: 'Education', heading: null, text: persona.degreeEvidence, evidence: quoteEvidence(persona.degreeEvidence, context) || fallbackEvidence(context, persona) });
  return {
    headline: persona.profile.roles,
    resume: entries.slice(0, 8),
    coverLetter: `I am a ${persona.profile.roles.split(',')[0]}.${persona.profile.story ? ' ' + persona.profile.story : ''}`,
    suggestions: [],
  };
}

function reviewBody(persona, packet, context) {
  const sourceText = context.sources.map(source => source.text).join('\n');
  const claims = [
    ...(packet.resume || []).map(entry => entry.text),
    ...(packet.answers || []).map(answer => answer.answer),
    packet.coverLetter || '',
  ];
  const issues = [];
  const allText = claims.join('\n');
  for (const number of numberTokens(allText)) if (!sourceText.includes(number)) issues.push(`Number ${number} is not in the sources.`);
  // Same per-sentence, negation-aware rule as the scorer.
  for (const absent of absentClaimsIn(allText, persona)) issues.push(`The candidate said they have not done: ${absent.text}`);
  for (const claim of claims) {
    if (/\b(?:passionate|leverage|cutting-edge|synergy|robust)\b/i.test(claim)) issues.push('Banned voice phrase in a claim.');
  }
  const claimIssue = text => {
    for (const number of numberTokens(text)) if (!sourceText.includes(number)) return `Number ${number} is not in the sources.`;
    for (const absent of absentClaimsIn(text, persona)) return `The candidate said they have not done: ${absent.text}`;
    if (/\b(?:passionate|leverage|cutting-edge|synergy|robust)\b/i.test(text)) return 'Banned voice phrase in a claim.';
    return '';
  };
  const calibration = [
    ...(packet.resume || []).map((entry, i) => {
      const issue = claimIssue(entry.text);
      return { id: `resume:${i}`, claim: entry.text, rating: issue ? 'unsupported' : 'balanced', kind: 'other', reason: issue || 'Grounded in source text.', suggestion: '' };
    }),
    ...(packet.answers || []).map((answer, i) => {
      const issue = claimIssue(answer.answer);
      return { id: `answer:${i}`, claim: answer.answer, rating: issue ? 'unsupported' : 'balanced', kind: 'other', reason: issue || 'Grounded in source text.', suggestion: '' };
    }),
  ];
  return { passed: issues.length === 0, issues, calibration };
}

function formSuggestions(persona, job, fields, context) {
  const suggestions = [], questions = [];
  const facts = availableFacts(persona, context);
  const jobFacts = job.requiredFactIds.map(id => facts.find(f => f.id === id)).filter(Boolean);
  for (const field of fields || []) {
    const label = String(field.label || '').toLowerCase();
    if (field.sectionContext && /employment/i.test(field.sectionContext.label)) {
      const rec = persona.records?.[field.sectionContext.index || 0];
      if (rec && /employer|company/i.test(label)) {
        suggestions.push({ key: field.key, answer: rec.employer, evidence: quoteEvidence(rec.employer, context) });
        continue;
      }
      if (rec && /title|role/i.test(label)) {
        suggestions.push({ key: field.key, answer: rec.title, evidence: quoteEvidence(rec.title, context) });
        continue;
      }
    }
    if (/degree/.test(label)) {
      if (field.options?.some(option => option.value === persona.degree)) suggestions.push({ key: field.key, answer: persona.degree, evidence: quoteEvidence(persona.degreeEvidence, context) });
      continue;
    }
    if (/start|earliest/.test(label)) { questions.push({ key: field.key, question: 'What is your exact earliest start date?' }); continue; }
    if (/level|experience/.test(label)) {
      const option = field.options?.find(item => item.value === persona.level) || field.options?.find(item => /professional/i.test(item.label));
      if (option) suggestions.push({ key: field.key, answer: option.value, evidence: quoteEvidence(persona.degreeEvidence, context) });
      continue;
    }
    if (/employer|company/.test(label)) {
      suggestions.push({ key: field.key, answer: persona.employer, evidence: quoteEvidence(persona.degreeEvidence, context) });
      continue;
    }
    if (/project|achievement|describe|relevant|why|motivat/.test(label)) {
      const fact = jobFacts[0] || facts[0] || null;
      if (fact) suggestions.push({ key: field.key, answer: fact.text, evidence: evidenceFor(persona, fact, context) });
      else if (field.required) questions.push({ key: field.key, question: field.label });
      continue;
    }
    if (field.required) questions.push({ key: field.key, question: field.label });
  }
  return { suggestions, questions };
}

export function controlledAgent({ scenario, persona, job }) {
  const assistant = profileFixtureAgent();
  return async (id, instruction, data, options = {}) => {
    if (options.signal?.aborted) throw new Error('Canceled.');
    if (instruction === NAVIGATION_INSTRUCTION) return data.controls?.length ? { action: 'click', ref: data.controls[0].ref, reason: 'Continue to the next form step.' } : { action: 'stop', reason: 'No supported controls.' };
    if (instruction === HUMANIZE_INSTRUCTION) return { items: (data.items || []).map(item => ({ id: item.id, text: item.text })), remaining: [] };
    if (instruction === INTERVIEW_INSTRUCTION) {
      return {
        summary: `${persona.name} targets ${persona.profile.roles} roles in ${persona.profile.location}.`,
        voice: persona.profile.voice || 'Direct, specific first-person writing.',
        sampleAnswer: persona.facts[0].text,
        strengths: persona.facts.slice(0, 3).map(f => f.text),
        questions: ['Which role priority matters most to you right now?'],
        gaps: persona.absent.map(a => a.text),
      };
    }
    if (instruction === EVALUATE_INSTRUCTION) {
      const facts = availableFacts(persona, data.context);
      const candidateCorpus = [persona.profile.resume, persona.profile.roles, ...facts.map(f => f.text)].join(' ').toLowerCase();
      const matchedTerms = (job.atsTerms || []).filter(term => candidateCorpus.includes(term.toLowerCase()));
      if ((job.atsTerms || []).length > 0 && matchedTerms.length === 0) {
        return {
          score: 2.2,
          recommendation: 'Skip',
          summary: `The role requires ${job.atsTerms.join(', ')} experience not present in the available profile.`,
          matches: [{ text: 'General background documented in the available profile.', evidence: fallbackEvidence(data.context, persona) }],
          gaps: [`No documented experience with ${job.atsTerms.join(', ')}.`],
          questions: [],
          legitimacyNotes: ['Owned evaluation sandbox; no employer was contacted.'],
        };
      }
      const fact = job.requiredFactIds.map(id => facts.find(f => f.id === id)).find(Boolean) || facts[0];
      return {
        score: 4.6,
        recommendation: 'Apply',
        summary: fact ? `The candidate's documented ${job.requiredFactIds[0] || 'work'} matches this ${job.title} role.` : `The available profile has relevant background for this ${job.title} role.`,
        matches: [{ text: fact ? `Documented ${job.atsTerms[0] || 'experience'} relevant to the role.` : 'Background documented in the available profile.', evidence: fact ? evidenceFor(persona, fact, data.context) : fallbackEvidence(data.context, persona) }],
        gaps: [],
        questions: [],
        legitimacyNotes: ['Owned evaluation sandbox; no employer was contacted.'],
      };
    }
    if (instruction === PACKET_INSTRUCTION) return packetFor(persona, job, data.context);
    if (instruction === STANDARD_INSTRUCTION) return standardFor(persona, data.context);
    if (instruction === REVIEW_INSTRUCTION) return reviewBody(persona, data.packet || {}, data.context || { sources: [] });
    if (instruction === FORM_INSTRUCTION) return formSuggestions(persona, job, data.fields, data.context);
    if (instruction.startsWith('Act as the conversational assistant')) {
      return assistant(id, instruction, data);
    }
    throw new Error(`Unknown controlled-agent instruction: ${instruction.slice(0, 60)}`);
  };
}

const PROFILE_QUESTIONS = [
  'What project are you proudest of, and what did you do on it?',
  'What did you do in your last job or internship?',
  'Which tools or skills do you use most?',
  'What kind of role are you looking for next?',
  'How would you like your writing to sound?',
  'Have you led or coordinated other people?',
  'What was the hardest problem you solved?',
];

const contentWords = text => (String(text || '').toLowerCase().match(/[a-z0-9%$&]+/g) || []).filter(word => word.length >= 4 || /\d/.test(word));

export function profileFixtureAgent() {
  let asked = 0;
  let followedUp = false;
  return async (id, instruction, data) => {
    if (!instruction.startsWith('Act as the conversational assistant')) return fixtureAgent(id, instruction, data);
    const message = String(data.message || '');
    const save = message.length > 40 && !/everything I can think of/i.test(message);
    let say = PROFILE_QUESTIONS[asked++ % PROFILE_QUESTIONS.length];
    const actions = [];
    if (save) {
      actions.push({ name: 'profile.addStory', input: { text: message } });
      // Ask once about the first story so the deterministic candidate supplies a
      // detail; later long messages are saved without spending another turn.
      if (!followedUp) {
        followedUp = true;
        say = `You mentioned ${contentWords(message).slice(0, 3).join(' ')}. What made that necessary, and how did you do it?`;
      }
      if (/short and specific|buzzwords/i.test(message)) actions.push({ name: 'profile.update', input: { voice: message } });
    }
    return { say, actions };
  };
}
