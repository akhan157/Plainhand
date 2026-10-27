# Mode: linkedin — LinkedIn Job Curation

Claude finds and saves matching LinkedIn jobs. You apply via LinkedIn Easy Apply yourself.

**Claude's role:** discover → filter → save to watchlist
**Your role:** open list → click Easy Apply on matches

---

## linkedin-scan — Find and Save LinkedIn Jobs

### Requirements

**With LinkedIn MCP connector** (preferred): uses `mcp__claude_ai_LinkedIn__search_jobs` if available.

**Without connector** (fallback): uses `/browse` skill to scrape LinkedIn job search results. Requires Chrome running.

### Workflow

```text
1. PROFILE   → Read config/profile.yml: target_roles, location, remote_ok, title_filter
2. SEARCH    → Search LinkedIn for each target role + location combo
3. FILTER    → Apply title_filter.positive/negative from portals.yml
4. DEDUP     → Skip any URL already in data/linkedin-saved.md or data/scan-history.tsv
5. TAG       → Mark each job: [Easy Apply] or [Regular]
6. SCORE     → Quick fit tag: ✅ Strong / 〰️ Maybe / ❌ Skip (no full A-F evaluation)
7. SAVE      → Append new jobs to data/linkedin-saved.md
```

### Quick Scoring (lightweight — not full A-F)

Three tiers, one survivor:
- **✅ Strong** — title matches profile archetype + location fits + no hard negatives → **SAVED**
- **〰️ Maybe** — partial match or minor compromise → **DROPPED**
- **❌ Skip** — seniority mismatch or hard negatives → **DROPPED**

Only Strong jobs reach the watchlist. Everything else is silently discarded.

### Search Queries

Per session, run searches for:
- Each `target_roles` entry × primary location
- Each `target_roles` entry × "remote" (if `location.remote_ok: true`)
- Priority: Easy Apply filter ON (gets you the mass-apply pool)

### Output — data/linkedin-saved.md

Append to the watchlist file. Format:

```markdown
| {title} | {company} | {location} | {apply_type} | {fit} | [{date}]({linkedin_job_url}) | Pending |
```

Columns: Title · Company · Location · Easy Apply? · Fit · Link+Date · Status

Status values: `Pending` → `Applied` (user updates after applying) → `Responded` / `Rejected`

---

## linkedin-saved.md Watchlist

File lives at `data/linkedin-saved.md`. User works through it manually.

### Format

```markdown
# LinkedIn Saved Jobs

_Last scan: {YYYY-MM-DD} — {N} new jobs added_

| Title | Company | Location | Easy Apply | Link | Status |
|-------|---------|----------|:----------:|------|--------|
| Mechanical Engineer | ACME Corp | NYC, NY | ✅ | [2026-05-29](https://linkedin.com/jobs/view/...) | Pending |
```

All rows are Strong by definition — no Fit column needed.

### Status values

| Status | When |
|--------|------|
| `Pending` | Saved, not yet applied |
| `Applied` | You clicked Easy Apply |
| `Responded` | Company replied |
| `Rejected` | Pass |
| `Removed` | Expired or no longer interested |

### Workflow for you (applying)

1. Open `data/linkedin-saved.md`
2. Click each link → LinkedIn opens → click Easy Apply
3. Update status to `Applied`

---

## linkedin-update — Refresh Status

When you say "update LinkedIn statuses" or "mark these as applied":

1. Open `data/linkedin-saved.md`
2. Update `Status` column per your feedback
3. For any `Applied` rows: offer to add to `data/applications.md` tracker for follow-up cadence

This bridges the LinkedIn watchlist into the main career-ops tracker so follow-up mode works.
