# Mode: pdf — ATS-Optimized PDF Generation

## Resume Policy

Read `modes/_shared.md` first, then `modes/_profile.md`.
Read `docs/artifact-contract.md` before implementing or changing any per-job
artifact naming or metadata behavior.

In this repo, resume generation uses this policy only:
- Default template: `templates/cv-template-watson.html`
- Canonical content source: `data/resume-source.yml`
- `cv.md` is a generated mirror for agent readability
- Preserve `cv.md` structure/order
- No Professional Summary
- No Core Competencies block
- No bullet reordering
- No new bullets
- Trim only if needed to fit one page; cut non-engineering items first

## Full pipeline

1. Read `data/resume-source.yml` as the canonical source and `cv.md` as the generated human-readable mirror
2. Ask the user for the JD if it is not in context (text or URL)
3. Extract 15-20 keywords from the JD
4. Detect JD language → CV language (EN default)
5. Detect company location → paper format:
   - US/Canada → `letter`
   - Rest of the world → `a4`
6. Detect role archetype → adapt framing
7. Read `modes/_profile.md` and follow the Watson resume policy exactly
8. Apply JD tailoring only within that policy
9. **Keyword injection — with context validation (run for every swap):**

    For each JD keyword:
    a. Map to the single best-matching bullet in `cv.md`. No match = skip entirely. Do not force the keyword anywhere.
    b. Context-check before applying:
       - What does this keyword mean in the JD's domain and context?
       - What did the candidate actually do? (scope, domain, tools actually used)
       - Does using this keyword imply experience in a domain the candidate hasn't worked in?
       - Could the candidate answer honestly if a hiring manager pointed at the bullet and said "tell me about this"? YES = apply. NO = skip.
    c. Zero adjacent experience for a keyword = do not include it anywhere (not in bullets, not in skills list).
    d. Stretching OK: reframe with JD vocabulary when the work genuinely involved it; use broader terms that cover what was done.
    e. Stretching NOT OK: claim tools never used; inflate scope; invent metrics; use a JD term that implies a different domain than what was done.
10. Generate full HTML from `templates/cv-template-watson.html` + personalized content
11. Read `name` from `config/profile.yml` → normalize to kebab-case lowercase (e.g. "John Doe" → "john-doe") → `{candidate}`
12. Write HTML to `/tmp/cv-{candidate}-{company-slug}-{role-slug}.html`
13. Execute: `node generate-pdf.mjs /tmp/cv-{candidate}-{company-slug}-{role-slug}.html output/cv-{candidate}-{company-slug}-{role-slug}-{YYYY-MM-DD}.pdf --format={letter|a4}`
14. Emit companion metadata required by `docs/artifact-contract.md`
    Metadata is not complete unless required values are valid too:
    `artifact_date` must be a real `YYYY-MM-DD` date, `generated_at` must be a
    parseable ISO timestamp, enums must stay within the contract, and
    per-type arrays must be non-empty
15. Report: PDF path, number of pages, keyword coverage %

## ATS Rules (clean parsing)

- Single-column layout (no sidebars, no parallel columns)
- Use standard ATS-readable section names for whatever sections are present in the active template
- No text in images/SVGs
- No critical info in PDF headers/footers (ATS ignores them)
- UTF-8, selectable text (not rasterized)
- No nested tables
- Distributed JD keywords only in sections present in the Watson template

## Watson Resume Rules

- Template: `templates/cv-template-watson.html`
- Layout order: Education → Technical Skills → Professional Experience → Project Experience
- Font/look: Times New Roman, black/white, Word-style
- Preserve section order from `cv.md`
- Preserve bullet order from `cv.md`
- No Professional Summary
- No Core Competencies block
- No new bullets
- Only trim if needed to fit one page; cut non-engineering items first, never aerospace/rocketry/FSAE

## Keyword injection strategy (ethical, truth-based)

Examples of legitimate reformulation:
- JD says "RAG pipelines" and CV says "LLM workflows with retrieval" → change to "RAG pipeline design and LLM orchestration workflows"
- JD says "MLOps" and CV says "observability, evals, error handling" → change to "MLOps and observability: evals, error handling, cost monitoring"
- JD says "stakeholder management" and CV says "collaborated with team" → change to "stakeholder management across engineering, operations, and business"

**NEVER add skills that the candidate does not have. Only reword real experience using the exact JD vocabulary.**

## Template HTML

Use `templates/cv-template-watson.html` only.

Only fill placeholders that exist in the Watson template.

Common placeholders:

| Placeholder | Content |
|-------------|-----------|
| `{{LANG}}` | `en` or `es` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) or `210mm` (A4) |
| `{{NAME}}` | (from profile.yml) |
| `{{PHONE}}` | (from profile.yml — include with its separator only when `profile.yml` has a non-empty `phone` value; omit both `<span>` and `<span class="separator">` otherwise) |
| `{{EMAIL}}` | (from profile.yml) |
| `{{LINKEDIN_URL}}` | [from profile.yml] |
| `{{LINKEDIN_DISPLAY}}` | [from profile.yml] |
| `{{PORTFOLIO_URL}}` | [from profile.yml] (or /es depending on language) |
| `{{PORTFOLIO_DISPLAY}}` | [from profile.yml] (or /es depending on language) |
| `{{LOCATION}}` | [from profile.yml] |
| `{{SECTION_EXPERIENCE}}` | Work Experience |
| `{{EXPERIENCE}}` | HTML for each job using the active branch policy |
| `{{SECTION_PROJECTS}}` | Projects |
| `{{PROJECTS}}` | HTML for active-branch project selection |
| `{{SECTION_EDUCATION}}` | Education |
| `{{EDUCATION}}` | Education HTML |
| `{{SECTION_CERTIFICATIONS}}` | Certifications |
| `{{CERTIFICATIONS}}` | Certifications HTML |
| `{{SECTION_SKILLS}}` | Skills |
| `{{SKILLS}}` | Skills HTML |

## Canva CV Generation (optional)

If `config/profile.yml` has `cv.canva_resume_design_id` set, offer the user a choice before generating:
- **"HTML/PDF (fast, ATS-optimized)"** — existing flow above
- **"Canva CV (visual, design-preserving)"** — new flow below

If the user has no `cv.canva_resume_design_id`, skip this prompt and use the HTML/PDF flow.

### Canva workflow

#### Step 1 — Duplicate the base design

a. `export-design` the base design (using `cv.canva_resume_design_id`) as PDF → get download URL
b. `import-design-from-url` using that download URL → creates a new editable design (the duplicate)
c. Note the new `design_id` for the duplicate

#### Step 2 — Read the design structure

a. `get-design-content` on the new design → returns all text elements (richtexts) with their content
b. Map text elements to CV sections by content matching:
   - Look for the candidate's name → header section
   - Look for company names from cv.md → experience sections
   - Look for degree/school names → education section
   - Look for skill keywords → skills section
c. If mapping fails, show the user what was found and ask for guidance

#### Step 3 — Generate tailored content

Same content generation policy as the HTML flow above, including `_profile.md` overrides.

**IMPORTANT — Character budget rule:** Each replacement text MUST be approximately the same length as the original text it replaces (within ±15% character count). If tailored content is longer, condense it. The Canva design has fixed-size text boxes — longer text causes overlapping with adjacent elements. Count the characters in each original element from Step 2 and enforce this budget when generating replacements.

#### Step 4 — Apply edits

a. `start-editing-transaction` on the duplicate design
b. `perform-editing-operations` with `find_and_replace_text` for each section:
   - Replace each experience bullet with JD-matched wording only
   - Replace skills text with JD-matched terms
   - Replace project descriptions with top relevant projects
c. **Reflow layout after text replacement:**
   After applying all text replacements, the text boxes auto-resize but neighboring elements stay in place. This causes uneven spacing between work experience sections. Fix this:
   1. Read the updated element positions and dimensions from the `perform-editing-operations` response
   2. For each work experience section (top to bottom), calculate where the bullets text box ends: `end_y = top + height`
   3. The next section's header should start at `end_y + consistent_gap` (use the original gap from the template, typically ~30px)
   4. Use `position_element` to move the next section's date, company name, role title, and bullets elements to maintain even spacing
   5. Repeat for all work experience sections
d. **Verify layout before commit:**
   - `get-design-thumbnail` with the transaction_id and page_index=1
   - Visually inspect the thumbnail for: text overlapping, uneven spacing, text cut off, text too small
   - If issues remain, adjust with `position_element`, `resize_element`, or `format_text`
   - Repeat until layout is clean
e. Show the user the final preview and ask for approval
f. `commit-editing-transaction` to save (ONLY after user approval)

#### Step 5 — Export and download PDF

a. `export-design` the duplicate as PDF (format: a4 or letter based on JD location)
b. **IMMEDIATELY** download the PDF using Bash:
   ```bash
   curl -sL -o "output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf" "{download_url}"
   ```
   The export URL is a pre-signed S3 link that expires in ~2 hours. Download it right away.
c. Verify the download:
   ```bash
   file output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf
   ```
   Must show "PDF document". If it shows XML or HTML, the URL expired — re-export and retry.
d. Report: PDF path, file size, Canva design URL (for manual tweaking)

#### Error handling

- If `import-design-from-url` fails → fall back to HTML/PDF pipeline with message
- If text elements can't be mapped → warn user, show what was found, ask for manual mapping
- If `find_and_replace_text` finds no matches → try broader substring matching
- Always provide the Canva design URL so the user can edit manually if auto-edit fails

## Post-generation

Update tracker if the job is already registered: change PDF from ❌ to ✅.
The tracker signal does not replace exact artifact resolution in apply mode.
