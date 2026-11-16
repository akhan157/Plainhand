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

// Role dates: a year range ("2016 to 2020", "2016-present") or an explicit start year
// ("from 2016", "since 2016", "joined ... in 2016"). A bare year is not a date here, so
// graduation years and result numbers never read as role dates.
const YEAR = '(?:19|20)\\d{2}';
const ROLE_DATES = new RegExp(`\\b${YEAR}\\s*(?:-|–|—|to|until|through|thru)\\s*(?:${YEAR}|present|now|current|today)\\b|\\b(?:since|from)\\s+(?:in\\s+)?${YEAR}\\b|\\b(?:starting|started|start|joined|began)\\b[^.;\\n]{0,40}?\\b${YEAR}\\b`, 'i');
// An employer-like phrase is two or more capitalised words in a row ("Fictional
// Biotech"), the shape an employer, school or dated project takes in the candidate's
// own sentence or on a resume line. Deliberately shallow and deterministic. Limits: a
// one-word employer ("Pfizer") or a lower-case mention ("at a startup") is not read, so
// the interview asks again, and asked-and-answered then moves it on; a place or school
// after "at" and a dated project title can read as an employer; a month before a year
// ("May 2024 to August 2025") is not read yet. A wrong guess only stops one question
// early; it never invents an employer or a date for any document.
const EMPLOYER_LIKE = /\b[A-Z][\w&'’.+-]*(?:\s+(?:[A-Z][\w&'’.+-]*|of|&|and))+/;
// A resume the candidate uploaded or pasted counts once a line reads as a role heading:
// an employer-like name and role dates on the same line.
const datedRoleLines = resume => String(resume || '').split('\n').some(line => EMPLOYER_LIKE.test(line) && ROLE_DATES.test(line));

// Order matters only for what the interview asks first: the work itself comes before
// the details around it, and each role's employer, title and dates come straight after
// the results so the heading is attached to the story while it is still fresh. The role
// facts are not first because a new candidate's opening answer is usually about a
// project, not a job, and a role question lands oddly before any work has been told.
export const PROFILE_AREAS = [
  { id: 'results', asked: /\b(responsib\w*|results?|achiev\w*|accomplish\w*|impact)\b/i, label: 'what each role was responsible for and the results, with numbers', covered: texts => texts.some(text => NUMBER.test(text) && RESULT_VERB.test(text)) },
  { id: 'roles', asked: /\b(employers?|compan(?:y|ies)|organi[sz]ations?|job titles?|official titles?|dates?|date ranges?|start(?:ing|ed)? (?:and|to) end\w*)\b/i, label: "each role's employer, official job title and dates", covered: (texts, profile) => texts.some(text => EMPLOYER_LIKE.test(text) && ROLE_DATES.test(text)) || datedRoleLines(profile.resume) },
  { id: 'tools', asked: /\b(tools?|software|systems?|platforms?)\b/i, label: 'the tools, software and systems they use', covered: texts => any(texts, /\b(tools?|software|systems?|platforms?|excel|spreadsheets?|sql|python|pandas|tableau|power ?bi|power query|netsuite|quickbooks|sap|cad|solidworks|ansys|matlab|labview|figma|jira|salesforce|typescript|javascript|java|aws|azure|docker|git|sas|stata|rstudio|rmarkdown)\b/i) },
  { id: 'credentials', asked: /\b(certificat\w*|licen[cs]\w*|credential\w*)\b/i, label: 'certifications and licences', covered: texts => any(texts, /\b(certificat\w*|licen[cs]e[ds]?|certified|credential\w*|cpa|cfa|pmp|exam|registered for|series \d)\b/i) },
  { id: 'education', asked: /\b(education|degree|studied|study|training|school|university|college)\b/i, label: 'education and training', covered: (texts, profile) => filled(profile.graduation) || any(texts, /\b(degree|b\.?s\.?|m\.?s\.?|bachelor\w*|master'?s?|ph\.?d|doctorate|university|college|graduat\w*|diploma|coursework|minor|gpa|school|apprentice\w*|bootcamp)\b/i) },
  { id: 'projects', asked: /\bprojects?\b/i, label: 'projects they built or led', covered: texts => any(texts, /\b(project|built|portfolio|prototype|thesis|hackathon|capstone|volunteer\w*)\b/i) },
  { id: 'leadership', asked: /\b(lead|led|leading|mentor\w*|coordinat\w*|manag\w*|supervis\w*)\b/i, label: 'leading, mentoring or coordinating people', covered: texts => any(texts, /\b(led|lead|leader|managed|manager|supervis\w*|mentor\w*|coordinat\w*|coached|team of|direct reports?|chaired)\b/i) },
  { id: 'regulated', asked: /\b(sops?|audits?|controls?|compliance|regulat\w*|quality)\b/i, label: 'regulated or quality work such as SOPs, audits or controls', covered: texts => any(texts, /\b(sops?|standard operating|audit\w*|compliance|regulat\w*|quality (?:assurance|control|system|management)|qa|qc|internal controls?|controls? testing|sox|gmp|glp|iso \d|hipaa|fda|inspection|validat\w*)\b/i) },
  { id: 'targets', asked: /\b(next role|roles? (?:you|do you)|looking for|want next|kind of (?:role|job))\b/i, label: 'the roles they want next', covered: (texts, profile) => filled(profile.roles) || any(texts, /\b(looking for|i want|i'd like|i would like|next role|aiming for|interested in|move into|apply for)\b/i) },
];

// How far the interview has got, in the shape the agent digest sends and the engine
// enforces. `uncovered` is the list the next question should come from.
// The last question in a reply: the text after the final sentence end, up to the
// final question mark. Empty when the reply asks no question. The engine uses this
// to check the question against the first uncovered area, and askedAndAnswered uses
// it so both read a reply's question the same way.
export function finalQuestion(text = '') {
  const value = String(text || '');
  const end = value.lastIndexOf('?');
  if (end < 0) return '';
  const start = Math.max(value.lastIndexOf('.', end - 1), value.lastIndexOf('!', end - 1), value.lastIndexOf('?', end - 1));
  return value.slice(start + 1, end).trim();
}

// An area also counts once the assistant asked about it and the candidate answered,
// even with "no" or "I don't have any": a candidate without a licence must not be asked
// about licences forever. `history` is the agent conversation ({role, text}).
export function askedAndAnswered(history = []) {
  const done = new Set();
  history.forEach((message, index) => {
    if (message?.role !== 'assistant' || !history.slice(index + 1).some(next => next?.role === 'user')) return;
    const question = finalQuestion(message.text);
    if (!question) return;
    for (const area of PROFILE_AREAS) if (area.asked.test(question)) done.add(area.id);
  });
  return done;
}

export function uncoveredAreas(state = {}, history = []) {
  const profile = state.profile || {};
  const texts = candidateStatements(state);
  const asked = askedAndAnswered(history);
  return PROFILE_AREAS.filter(area => !asked.has(area.id) && !area.covered(texts, profile));
}

export function profileCoverage(state = {}, history = []) {
  const uncovered = uncoveredAreas(state, history);
  return { covered: PROFILE_AREAS.length - uncovered.length, total: PROFILE_AREAS.length, complete: uncovered.length === 0, uncovered: uncovered.map(area => area.label) };
}

// The candidate can ask for the summary at any point; the assistant may only offer it
// once the areas are covered or the candidate says they are done.
const CANDIDATE_ASKS = /(\bsummary\b|\bsummar(?:ise|ize)\b|\bunderstanding\b|\brebuild\b|\bbuild my profile\b|\bupdate (?:my|the) profile\b|\bi(?:'m| am) done\b|\ball done\b|\bfinished\b|\bthat's (?:all|everything)\b|\bnothing (?:else|more)\b|\bno more\b)/i;

export function canOfferSummary(state, message = '', history = []) {
  return profileCoverage(state, history).complete || CANDIDATE_ASKS.test(String(message || '').replace(/[\u2018\u2019]/g, "'"));
}
