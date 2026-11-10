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

const numberTokens = text => (String(text || '').match(/\d[\d.,]*%?/g) || []);
const hasWord = (text, keyword) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(String(text || '').toLowerCase());

function evidenceFor(persona, fact) {
  return [{ sourceId: 'cv', quote: fact.text }];
}

function factSection(fact) {
  if (['tools', 'sql'].includes(fact.id)) return 'Skills';
  if (['fsae', 'app', 'dashboard', 'design-system', 'editorial', 'scheduling'].includes(fact.id)) return 'Projects';
  return 'Experience';
}

function resumeEntries(persona, job) {
  const required = job.requiredFactIds.map(id => persona.facts.find(f => f.id === id)).filter(Boolean);
  const rest = persona.facts.filter(f => !required.includes(f));
  const chosen = [...required, ...rest].slice(0, 5);
  return chosen.map(fact => ({
    section: factSection(fact),
    heading: fact.id === 'pumps' || fact.id === 'ta' ? { org: persona.employer, title: persona.title, location: persona.profile.location.split(',')[0], dates: persona.dates } : null,
    text: fact.text,
    evidence: evidenceFor(persona, fact),
  }));
}

function packetFor(persona, job) {
  const fact = persona.facts.find(f => job.requiredFactIds.includes(f.id)) || persona.facts[0];
  return {
    headline: `${persona.profile.roles.split(',')[0]} for ${job.title}`,
    resume: [
      ...resumeEntries(persona, job),
      {
        section: 'Education',
        heading: null,
        text: persona.degreeEvidence,
        evidence: [{ sourceId: 'cv', quote: persona.degreeEvidence }],
      },
    ],
    coverLetter: `I am applying for the ${job.title} role at ${job.company}. ${persona.profile.story} ${fact.text}`,
    answers: [
      { question: 'Describe a relevant project.', answer: fact.text, evidence: evidenceFor(persona, fact) },
    ],
    questions: [],
    suggestions: [],
  };
}

function standardFor(persona) {
  const entries = persona.facts.map(fact => ({ section: factSection(fact), heading: null, text: fact.text, evidence: evidenceFor(persona, fact) }));
  entries.push({ section: 'Education', heading: null, text: persona.degreeEvidence, evidence: [{ sourceId: 'cv', quote: persona.degreeEvidence }] });
  return {
    headline: persona.profile.roles,
    resume: entries.slice(0, 8),
    coverLetter: `I am a ${persona.profile.roles.split(',')[0]}. ${persona.profile.story}`,
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
  for (const absent of persona.absent) {
    if (absent.keywords.some(keyword => hasWord(allText, keyword))) issues.push(`The candidate said they have not done: ${absent.text}`);
  }
  for (const claim of claims) {
    if (/\b(?:passionate|leverage|cutting-edge|synergy|robust)\b/i.test(claim)) issues.push('Banned voice phrase in a claim.');
  }
  const calibration = [
    ...(packet.resume || []).map((_, i) => ({ id: `resume:${i}`, rating: issues.length ? 'unsupported' : 'balanced', kind: 'other', reason: issues[0] || 'Grounded in source text.', suggestion: '' })),
    ...(packet.answers || []).map((_, i) => ({ id: `answer:${i}`, rating: issues.length ? 'unsupported' : 'balanced', kind: 'other', reason: issues[0] || 'Grounded in source text.', suggestion: '' })),
  ];
  return { passed: issues.length === 0, issues, calibration };
}

function formSuggestions(persona, job, fields) {
  const suggestions = [], questions = [];
  const jobFacts = job.requiredFactIds.map(id => persona.facts.find(f => f.id === id)).filter(Boolean);
  for (const field of fields || []) {
    const label = String(field.label || '').toLowerCase();
    if (field.sectionContext && /employment/i.test(field.sectionContext.label)) {
      const rec = persona.records?.[field.sectionContext.index || 0];
      if (rec && /employer|company/i.test(label)) {
        suggestions.push({ key: field.key, answer: rec.employer, evidence: [{ sourceId: 'cv', quote: rec.employer }] });
        continue;
      }
      if (rec && /title|role/i.test(label)) {
        suggestions.push({ key: field.key, answer: rec.title, evidence: [{ sourceId: 'cv', quote: rec.title }] });
        continue;
      }
    }
    if (/degree/.test(label)) {
      if (field.options?.some(option => option.value === persona.degree)) suggestions.push({ key: field.key, answer: persona.degree, evidence: [{ sourceId: 'cv', quote: persona.degreeEvidence }] });
      continue;
    }
    if (/start|earliest/.test(label)) { questions.push({ key: field.key, question: 'What is your exact earliest start date?' }); continue; }
    if (/level|experience/.test(label)) {
      const option = field.options?.find(item => item.value === persona.level) || field.options?.find(item => /professional/i.test(item.label));
      if (option) suggestions.push({ key: field.key, answer: option.value, evidence: [{ sourceId: 'cv', quote: persona.degreeEvidence }] });
      continue;
    }
    if (/employer|company/.test(label)) {
      suggestions.push({ key: field.key, answer: persona.employer, evidence: [{ sourceId: 'cv', quote: persona.degreeEvidence }] });
      continue;
    }
    if (/project|achievement|describe|relevant|why|motivat/.test(label)) {
      const fact = jobFacts[0] || persona.facts[0];
      suggestions.push({ key: field.key, answer: fact.text, evidence: evidenceFor(persona, fact) });
      continue;
    }
    if (field.required) questions.push({ key: field.key, question: field.label });
  }
  return { suggestions, questions };
}

export function controlledAgent({ scenario, persona, job }) {
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
      if (job.expectRecommendation === 'Skip') {
        return {
          score: 2.2,
          recommendation: 'Skip',
          summary: `The role requires senior distributed storage experience not present in ${persona.name}'s background.`,
          matches: [{ text: 'General engineering coursework only.', evidence: evidenceFor(persona, persona.facts[0]) }],
          gaps: ['Requires 10+ years of distributed storage and Kubernetes architecture experience.'],
          questions: [],
          legitimacyNotes: ['Owned evaluation sandbox; no employer was contacted.'],
        };
      }
      const fact = persona.facts.find(f => job.requiredFactIds.includes(f.id)) || persona.facts[0];
      return {
        score: 4.6,
        recommendation: 'Apply',
        summary: `The candidate's documented ${job.requiredFactIds[0] || 'work'} matches this ${job.title} role.`,
        matches: [{ text: `Documented ${job.atsTerms[0] || 'experience'} relevant to the role.`, evidence: evidenceFor(persona, fact) }],
        gaps: [],
        questions: [],
        legitimacyNotes: ['Owned evaluation sandbox; no employer was contacted.'],
      };
    }
    if (instruction === PACKET_INSTRUCTION) return packetFor(persona, job);
    if (instruction === STANDARD_INSTRUCTION) return standardFor(persona);
    if (instruction === REVIEW_INSTRUCTION) return reviewBody(persona, data.packet || {}, data.context || { sources: [] });
    if (instruction === FORM_INSTRUCTION) return formSuggestions(persona, job, data.fields);
    if (instruction.startsWith('Act as the conversational assistant')) {
      return { say: 'What is one project you are proud of, and what did you do on it?', actions: [] };
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
      if (/short and specific|buzzwords|plain/i.test(message)) actions.push({ name: 'profile.update', input: { voice: message } });
    }
    return { say, actions };
  };
}
