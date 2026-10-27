# Plainhand terminal dashboard

An optional terminal view of the same application tracker used by the website.
Browse/filter/sort roles, read reports, view progress and edit tracker statuses.
Candidate onboarding, AI connections and application preparation live in the web
interface. The dashboard does not run a second application engine.

```bash
# From the repository root (Go required)
npm run tui
# Or select a separate workspace:
go -C dashboard run . --path /absolute/path/to/workspace
```

The workspace must contain `data/applications.md` (or `applications.md` for legacy
layouts). New users create their profile and first application in the website.
Use the dashboard's on-screen key hints for navigation. Refresh between web and
terminal edits; concurrent status writes do not yet share a transaction lock.

Implementation originally adapted from Career Ops by Santiago Fernández de
Valderrama; see the repository license and upstream reuse review. Visible product
terminology is Plainhand. The Go module import path is retained for compatibility.
