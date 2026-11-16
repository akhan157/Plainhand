// Role identity and order, for the scorer and for the controlled fixture agent.
//
// A tailored resume keeps only the roles the job needs, curates each kept role's
// lines toward the job, and orders the kept roles by the candidate's setting
// (settings.roleOrder): newest first by default, or the role that best matches the
// job first, then the rest newest first. "Newest" is read from the dates in each
// role heading, which the product copies from the candidate's sources, so a role is
// never guessed from the wording of a bullet. A heading whose dates cannot be read
// is reported, never silently ordered.
//
// The same parsing serves both sides: the packet (what the app produced) and the
// persona's master resume (which role a ground-truth fact belongs to). Nothing here
// knows about a job or a persona's ids, so no rule can special-case a fixture.

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const YEAR = '(?:19|20)\\d{2}';
const POINT = `(?:${MONTH}\\s*)?${YEAR}`;
const ONGOING = '(?:present|current|now|ongoing|today)';
const POINT_VALUE = new RegExp(`^${POINT}$`, 'i');
const ONGOING_VALUE = new RegExp(`^${ONGOING}$`, 'i');

const clean = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const yearOf = text => {
  const match = /((?:19|20)\d{2})/.exec(String(text ?? ''));
  return match ? Number(match[1]) : null;
};

// A heading's date field, as the product writes it from the sources:
//   "2019 to 2026", "2014 - 2018", "Jun 2026 to Aug 2026", "May 2019 – Present",
//   "2020-2026", "2025" (a single date, as an internship or a project states it).
// Returns years, because role order is a year question; the month only disambiguates
// nothing a resume needs. `null` means "this heading states no date I can read", and
// the caller reports it instead of inventing an order.
export function parseDates(value) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim().replace(/^\(+/, '').replace(/\)+$/, '');
  if (!raw) return null;
  // Every dash form the sources use is the same separator ("2014–2018" is a range),
  // and the range may be written with a word instead of a dash.
  const normalized = raw.toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, ' to ')
    .replace(/\b(?:until|through|thru)\b/g, 'to')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = normalized.split(/\s+to\s+/);
  if (parts.length > 2) return null;
  if (!POINT_VALUE.test(parts[0])) return null;
  const start = yearOf(parts[0]);
  if (start === null) return null;
  if (parts.length === 1) return { start, end: start, ongoing: false, source: raw };
  const [startPart, endPart] = parts;
  if (ONGOING_VALUE.test(endPart)) return { start, end: null, ongoing: true, source: raw };
  if (!POINT_VALUE.test(endPart)) return null;
  const end = yearOf(endPart);
  if (end === null || end < start) return null;
  return { start, end, ongoing: false, source: raw };
}

// "Org — Title — Location — dates": only what the heading states, so an empty slot
// never shows up as a stray comma.
export const roleLabel = heading => ['org', 'title', 'location', 'dates']
  .map(key => String(heading?.[key] ?? '').trim())
  .filter(Boolean)
  .join(' — ');

const headingKey = heading => ['org', 'title', 'location', 'dates'].map(key => clean(heading?.[key])).join('|');
const hasHeading = heading => Boolean(heading) && Object.values(heading).some(value => String(value ?? '').trim());

// Sections whose headings are not employment roles. A packet line with no section
// is judged by its dates alone (the product may leave the section unnamed).
const NON_ROLE_SECTION = /^(?:education|training|certificat\w*|licen[cs]\w*|skills?|projects?|publications?|papers?|awards?|honou?rs?|languages?|interests?|summary|profile|contact|references|volunteer\w*)\b/i;
// A dated break is a gap in the record, not a job the candidate held.
const GAP_HEADING = /^(?:career break|career gap|family care|parental leave|sabbatical|break|time off|gap)\b/i;

// The experience roles a packet states, in the order they appear, with the dates read
// from their headings. Lines sharing one identical heading are one role (a role split
// across several entries is still one role); a heading-less line belongs to no role and
// is ignored here. `roles` holds the roles whose dates could be read (the order gate);
// `groups` holds every experience role, readable or not, so "was this role kept" can be
// answered even when its dates cannot (its org and title still identify it).
export function packetRoles(packet) {
  const grouped = [];
  let current = null;
  (packet?.resume || []).forEach((entry, index) => {
    const heading = hasHeading(entry?.heading) ? entry.heading : null;
    if (!heading) { current = null; return; }
    const key = headingKey(heading);
    if (!current || current.key !== key) {
      current = { key, heading, label: roleLabel(heading), section: String(entry?.section ?? '').trim(), entries: [], indexes: [] };
      grouped.push(current);
    }
    current.entries.push(String(entry?.text ?? ''));
    current.indexes.push(index);
  });
  const roles = [], groups = [], unparseable = [], excluded = [];
  for (const group of grouped) {
    if (NON_ROLE_SECTION.test(group.section)) { excluded.push({ heading: group.label, section: group.section }); continue; }
    const dates = parseDates(group.heading.dates);
    const role = { ...group, ...(dates || {}), parseable: Boolean(dates), gap: GAP_HEADING.test(clean(group.heading.org)) || GAP_HEADING.test(clean(group.heading.title)), text: group.entries.join('\n') };
    groups.push(role);
    if (dates) roles.push(role);
    else unparseable.push({ heading: group.label, org: group.heading.org ?? '', title: group.heading.title ?? '', dates: String(group.heading.dates ?? '').trim(), reason: 'dates-unparseable' });
  }
  return { roles, groups, unparseable, excluded };
}

// True when the roles are already in newest-first order by their start dates. Two
// roles that start in the same year are in either order: a resume may put the more
// relevant of two concurrent roles first.
export function newestFirstOrder(roles) {
  for (let index = 1; index < roles.length; index += 1) {
    if (roles[index].start > roles[index - 1].start) return false;
  }
  return true;
}

// The experience roles a persona's master resume states, with the body lines under
// each heading. This is the ground truth for "which role does this fact belong to",
// so a resume that keeps a role's fact but drops the role itself can be told apart
// from one that keeps the role.
const PERSONA_SECTION = /^(?:experience|employment(?: history)?|work history|professional experience|projects?|education|certificat\w*|licen[cs]\w*|licenses? & certifications|skills|publications?|awards?|volunteer\w*|summary|profile|interests|languages|writing samples)\b/i;
const EXPERIENCE_SECTION = /^(?:experience|employment(?: history)?|work history|professional experience)\b/i;
const SEPARATOR = /\s+[—–]\s+|\s+-\s+/;

export function personaRoles(persona) {
  const lines = String(persona?.profile?.resume ?? '').split('\n').map(line => line.trim());
  const roles = [];
  let section = '';
  let current = null;
  for (const line of lines) {
    if (!line) continue;
    if (PERSONA_SECTION.test(line) && !SEPARATOR.test(line)) {
      section = EXPERIENCE_SECTION.test(line) ? 'experience' : 'other';
      current = null;
      continue;
    }
    if (section !== 'experience') continue;
    const parts = line.split(SEPARATOR).map(part => part.trim()).filter(Boolean);
    const parsed = parts.length >= 2 ? parseDates(parts.at(-1)) : null;
    if (parsed) {
      // The date field keeps its own text (that is what a packet heading carries);
      // the parsed years sit beside it for ordering.
      current = { label: parts.join(' — '), org: parts[0], title: parts.length >= 3 ? parts[1] : '', dates: parts.at(-1), start: parsed.start, end: parsed.end, ongoing: parsed.ongoing, body: [] };
      roles.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return roles;
}
