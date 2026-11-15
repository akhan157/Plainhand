// Profile interview coverage: which areas an onboarding conversation still has to ask
// about. It is decided from the candidate's own statements and the profile fields they
// confirmed, never from how many stories were saved, so the interview keeps going
// instead of offering to summarize after two or three answers.
//
// The labels are fixed text and reach the agent digest, so nothing here can echo
// candidate, resume or posting text.

import { candidateStatements } from './profile-strength.mjs';

const NUMBER = /\d/;
const RESULT_VERB = /\b(built|led|ran|own|owned|wrote|cut|reduced|increased|improved|saved|grew|shipped|delivered|managed|designed|tested|launched|automated|migrated|trained|closed|cleared|passed)\b/i;
const any = (texts, pattern) => texts.some(text => pattern.test(String(text || '')));
const filled = (value) => Boolean(String(value || '').trim());

// Order matters only for what the interview asks first: the work itself comes before
// the details around it.
export const PROFILE_AREAS = [
  { id: 'results', label: 'what each role was responsible for and the results, with numbers', covered: texts => texts.some(text => NUMBER.test(text) && RESULT_VERB.test(text)) },
  { id: 'tools', label: 'the tools, software and systems they use', covered: texts => any(texts, /\b(tools?|software|systems?|platforms?|excel|spreadsheets?|sql|python|pandas|tableau|power ?bi|power query|netsuite|quickbooks|sap|cad|solidworks|ansys|matlab|labview|figma|jira|salesforce|typescript|javascript|java|aws|azure|docker|git|sas|stata|rstudio|rmarkdown)\b/i) },
  { id: 'credentials', label: 'certifications and licences', covered: texts => any(texts, /\b(certificat\w*|licen[cs]e[ds]?|certified|credential\w*|cpa|cfa|pmp|exam|registered for|series \d)\b/i) },
  { id: 'education', label: 'education and training', covered: (texts, profile) => filled(profile.graduation) || any(texts, /\b(degree|b\.?s\.?|m\.?s\.?|bachelor\w*|master'?s?|ph\.?d|doctorate|university|college|graduat\w*|diploma|coursework|minor|gpa|school|apprentice\w*|bootcamp)\b/i) },
  { id: 'projects', label: 'projects they built or led', covered: texts => any(texts, /\b(project|built|portfolio|prototype|thesis|hackathon|capstone|volunteer\w*)\b/i) },
  { id: 'leadership', label: 'leading, mentoring or coordinating people', covered: texts => any(texts, /\b(led|lead|leader|managed|manager|supervis\w*|mentor\w*|coordinat\w*|coached|team of|direct reports?|chaired)\b/i) },
  { id: 'regulated', label: 'regulated or quality work such as SOPs, audits or controls', covered: texts => any(texts, /\b(sops?|standard operating|audit\w*|compliance|regulat\w*|quality (?:assurance|control|system|management)|qa|qc|internal controls?|controls? testing|sox|gmp|glp|iso \d|hipaa|fda|inspection|validat\w*)\b/i) },
  { id: 'targets', label: 'the roles they want next', covered: (texts, profile) => filled(profile.roles) || any(texts, /\b(looking for|i want|i'd like|i would like|next role|aiming for|interested in|move into|apply for)\b/i) },
];

// How far the interview has got, in the shape the agent digest sends and the engine
// enforces. `uncovered` is the list the next question should come from.
export function profileCoverage(state = {}) {
  const profile = state.profile || {};
  const texts = candidateStatements(state);
  const uncovered = PROFILE_AREAS.filter(area => !area.covered(texts, profile));
  return { covered: PROFILE_AREAS.length - uncovered.length, total: PROFILE_AREAS.length, complete: uncovered.length === 0, uncovered: uncovered.map(area => area.label) };
}

// The candidate can ask for the summary at any point; the assistant may only offer it
// once the areas are covered or the candidate says they are done.
const CANDIDATE_ASKS = /(\bsummary\b|\bsummar(?:ise|ize)\b|\bunderstanding\b|\brebuild\b|\bbuild my profile\b|\bupdate (?:my|the) profile\b|\bi(?:'m| am) done\b|\ball done\b|\bfinished\b|\bthat's (?:all|everything)\b|\bnothing (?:else|more)\b|\bno more\b)/i;

export function canOfferSummary(state, message = '') {
  return profileCoverage(state).complete || CANDIDATE_ASKS.test(String(message || '').replace(/[\u2018\u2019]/g, "'"));
}
