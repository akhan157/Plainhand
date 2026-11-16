// Every contact recorded on an application, rolled up by company.
//
// Pure and import-free so the People card (browser) and the U10 tests read the
// same rule. The company name is the grouping key, case-insensitively; the
// application record remains the only place a contact is added or removed.

export function contactsByCompany(state) {
  const groups = new Map();
  for (const job of state?.jobs || []) {
    const contacts = Array.isArray(job.record?.contacts) ? job.record.contacts : [];
    if (!contacts.length) continue;
    const company = String(job.company || '').trim();
    if (!company) continue;
    const key = company.toLowerCase();
    if (!groups.has(key)) groups.set(key, { company, contacts: [] });
    const group = groups.get(key);
    for (const contact of contacts) group.contacts.push({ ...contact, job });
  }
  const result = [...groups.values()];
  for (const group of result) group.contacts.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
  return result.sort((a, b) => a.company.localeCompare(b.company));
}
