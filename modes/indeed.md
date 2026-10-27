# Mode: indeed — Indeed MCP Integration

Two sub-modes using the Claude Code Indeed MCP connector:
- **`indeed-scan`** — discover new jobs on Indeed and add to pipeline
- **`indeed-apply`** — apply to Indeed Easy Apply jobs via Playwright

---

## indeed-scan — Discover Jobs on Indeed

### Workflow

```text
1. PROFILE  → Read config/profile.yml for target_roles, location, remote_ok
2. RESUME   → Call mcp__claude_ai_Indeed__get_resume (optional: check profile completeness)
3. DEDUP    → Load scan-history.tsv to build known-URL set
4. SEARCH   → Call mcp__claude_ai_Indeed__search_jobs for each (role, location) pair
5. FILTER   → Apply title_filter from portals.yml; skip already-seen URLs
6. DETAILS  → Call mcp__claude_ai_Indeed__get_job_details for each new candidate
7. CLASSIFY → Tag each: [Easy Apply] (indeed.com form) or [External] (ATS redirect)
8. PIPELINE → Append to pipeline.md under ## Indeed Scan — {YYYY-MM-DD}
9. HISTORY  → Append new rows to scan-history.tsv (source: indeed_scan)
```

### Search Queries

Build from `config/profile.yml`:
- **roles**: each entry in `target_roles` (run up to 3 searches to avoid redundancy)
- **location**: `location.primary` (e.g., `"New York, NY"`) + `"remote"` if `location.remote_ok: true`
- **country_code**: derived from location (default `"US"`)
- **job_type**: `"fulltime"` unless profile specifies otherwise

### Deduplication

Before adding to pipeline, check both:
1. Is the job URL already in `scan-history.tsv`?
2. Is company+role already in `data/applications.md`?

Skip if either matches.

### Classifying Easy Apply vs External

After `get_job_details`, inspect the apply URL:
- URL on `indeed.com` (e.g., `https://m.indeed.com/applystart/...`) → `[Easy Apply]`
- URL redirects to ATS (greenhouse, ashby, lever, workday, taleo, icims, etc.) → `[External]`

If apply type is ambiguous from the URL alone, mark `[Easy Apply?]` — the apply mode will confirm at runtime.

### Pipeline Entry Format

Append under a new dated section in `pipeline.md`:

```markdown
## Indeed Scan — {YYYY-MM-DD}

- [ ] {apply_url} | {Company} | {Role} | [Easy Apply]
- [ ] {apply_url} | {Company} | {Role} | [External]
```

### scan-history.tsv Entry

One row per new job (tab-separated):
```
{url}	{YYYY-MM-DD}	indeed_scan_{role_slug}	{title}	{company}	added
```

---

## indeed-apply — Apply via Indeed Easy Apply

After a job is evaluated (score ≥ 4.0/5), this mode automates the Indeed Easy Apply flow using Playwright.

### Preconditions

1. Job was sourced from Indeed scan (URL contains `indeed.com` or tagged `[Easy Apply]` in pipeline)
2. Score ≥ 4.0/5 — or user explicitly overrides with a reason
3. Report exists in `reports/` for this job (run auto-pipeline first if not)
4. User must approve before submitting — non-negotiable

### Workflow

```text
1. LOAD      → Read report + cv.md + output/{num}-{slug}.pdf (tailored PDF)
2. NAVIGATE  → browser_navigate to the job's apply URL
3. CHECK     → Is this still Indeed Easy Apply or did it redirect to external ATS?
               - Stays on indeed.com → proceed with form fill
               - Redirected to ATS → tell user, switch to /career-ops apply
4. SNAPSHOT  → browser_snapshot to read all visible form fields
5. FILL      → Generate responses from cv.md + report for each field (see apply.md Step 5)
6. UPLOAD    → Upload tailored PDF if a resume upload field is present
7. PAUSE     → Show filled-form summary → STOP — wait for user approval
8. SUBMIT    → User confirms → click Submit/Apply button
9. UPDATE    → applications.md: Evaluated → Applied; report Section G saved
```

### Form Fill Logic

Follow the same rules as `modes/apply.md` Step 5:
- Free text: use report proof points (Block B) and STAR stories (Block F)
- Dropdowns: use cv.md education/experience data
- Work authorization: always "Yes, authorized to work in the US" (verify with user if visa situation changed)
- Salary: use `comp.target_min` from `config/profile.yml` as floor
- Resume upload: use tailored PDF from `output/` — generate via `/career-ops pdf` first if missing

### ATS Redirect Handling

If Playwright lands on a non-Indeed domain after navigating:
1. Surface the ATS URL to the user
2. Say: "This is a [Greenhouse/Ashby/Workday] application. Switching to `/career-ops apply` — I'll fill the form there."
3. Continue in `apply` mode

### CRITICAL: Never Submit Without User Confirmation

Before any Submit/Apply/Send click:
1. Show summary of all filled fields
2. Ask: "Ready to submit to **{Company}** for **{Role}**? (yes/no)"
3. Proceed only on explicit "yes"

This is non-negotiable per the ethical use policy.

### Post-Apply

1. `applications.md`: status `Evaluated` → `Applied`
2. Report Section G: save final submitted responses
3. Suggest: `/career-ops contacto` for LinkedIn outreach to hiring manager

---

## indeed-resume — Sync Indeed Resume to cv.md

Quick utility: fetch the user's Indeed resume profile and compare against `cv.md`.

```text
1. Call mcp__claude_ai_Indeed__get_resume
2. Compare key fields: work history, education, skills, summary
3. Report differences — do NOT auto-overwrite cv.md
4. Ask user which gaps (if any) they want to sync
```

Use this when: user wants to check if their Indeed profile is consistent with cv.md, or wants to update cv.md with experience listed on Indeed but not yet in the file.
