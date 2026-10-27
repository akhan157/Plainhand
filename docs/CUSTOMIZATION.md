# Customization Guide

## Profile (config/profile.yml)

This is the single source of truth for your identity. All modes read from here.

Key sections:
- **candidate**: Name, email, phone, location, LinkedIn, portfolio
- **target_roles**: Your North Star roles and archetypes
- **narrative**: Your headline, exit story, superpowers, proof points
- **compensation**: Target range, minimum, currency
- **location**: Country, timezone, visa status, on-site availability

## Target Roles (modes/_profile.md)

The archetype table in `_profile.md` determines how offers are scored and CVs are framed. Edit the table to match YOUR career targets:

```markdown
| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
| **Your Role 1** | key skills | what they need |
| **Your Role 2** | key skills | what they need |
```

Also update the "Adaptive Framing" table to map YOUR specific projects to each archetype.

## Portals (portals.yml)

Copy from `templates/portals.example.yml` and customize:

1. **title_filter.positive**: Keywords matching your target roles
2. **title_filter.negative**: Tech stacks or domains to exclude
3. **search_queries**: WebSearch queries for job boards (Ashby, Greenhouse, Lever)
4. **tracked_companies**: Companies to check directly

## CV Template (templates/cv-template.html)

The HTML template uses these design tokens:
- **Fonts**: Space Grotesk (headings) + DM Sans (body) -- self-hosted in `fonts/`
- **Colors**: Cyan primary (`hsl(187,74%,32%)`) + Purple accent (`hsl(270,70%,45%)`)
- **Layout**: Single-column, ATS-optimized

To customize fonts/colors, edit the CSS in the template. Update font files in `fonts/` if switching fonts.

## Negotiation Scripts (modes/_shared.md)

The negotiation section provides frameworks for salary discussions. Replace the example scripts with your own:
- Target ranges
- Geographic arbitrage strategy
- Pushback responses

## Hooks (Optional)

Career-ops can integrate with external systems via Claude Code hooks. Example hooks:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "echo 'Career-ops session started'"
      }]
    }]
  }
}
```

Save hooks in `.claude/settings.json`.

## States (templates/states.yml)

The canonical states rarely need changing. If you add new states, update:
1. `templates/states.yml`
2. `normalize-statuses.mjs` (alias mappings)
3. `merge-tracker.mjs`, `verify-pipeline.mjs`, `analyze-patterns.mjs`, `followup-cadence.mjs`, and dashboard status logic
4. `modes/_shared.md` (any references)

## CV Templates

Career-ops ships with two templates:

| Template | Style | Best for |
|----------|-------|----------|
| `cv-template.html` | Modern — Space Grotesk + DM Sans, cyan/purple | AI, tech, startups, creative roles |
| `cv-template-watson.html` | Traditional — Times New Roman, black/white | Engineering, manufacturing, defense, gov, MEP |

**To switch templates:** Add this line to `modes/_profile.md` under "Your CV Template":

**Default template: `templates/cv-template-watson.html`**

Or ask Claude: "Use the Watson template for all CVs."

## Bring Your Own Template

To create a custom template from an existing resume design:

**Step 1:** Export your target resume as a PDF screenshot.

**Step 2:** Paste this prompt into Claude along with the screenshot:
```
Reverse-engineer this resume into an HTML file with inline CSS. Use these exact placeholder tokens where my personal data appears:
{{NAME}}, {{EMAIL}}, {{PHONE}}, {{LOCATION}}, {{LINKEDIN}},
{{SUMMARY_TEXT}}, {{EXPERIENCE}}, {{EDUCATION}}, {{SKILLS}}, {{PROJECTS}}

Preserve all fonts, colors, spacing, and layout exactly. Self-host fonts via @font-face or use system fonts only. Return a single .html file that renders identically to the screenshot when opened in a browser.
```

**Step 3:** Review the output. Open in a browser and compare side-by-side with the original.

**Step 4:** Save to `templates/your-template-name.html`.

**Step 5:** Activate by setting the template path in `modes/_profile.md`:
```
**Default template: `templates/your-template-name.html`**
```

**ATS safety check:** After generating, run a quick ATS parse test — paste the rendered PDF text into a plain text editor. If the text flows logically (no column interleaving, no header/footer bleed), the template is ATS-safe.
