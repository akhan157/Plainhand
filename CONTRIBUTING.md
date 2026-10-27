# Contributing to Plainhand

Thanks for helping. Plainhand is small and opinionated, so for anything larger
than a bug fix, please [open an issue](https://github.com/akhan157/plainhand/issues/new/choose) first.

## Setup

```bash
git clone https://github.com/akhan157/plainhand.git
cd plainhand
npm run setup
npm start          # http://127.0.0.1:3210
```

## Before you open a pull request

- Run `npm run test:plainhand` (fast) and `npm run test:full` (includes the
  browser suites; needs a desktop or `xvfb-run` on Linux).
- No personal data: no real resumes, profiles, names or API keys, including in
  test fixtures and screenshots.
- Don't touch user files (`cv.md`, `config/profile.yml`, `data/`,
  `output/`). See [DATA_CONTRACT.md](DATA_CONTRACT.md).
- Match the code around you. The front end has no build step (vendored Preact
  and htm), and the Content Security Policy forbids inline scripts and styles.

## Rules that don't bend

These are what Plainhand is. Pull requests that weaken them won't be merged:

- Plainhand never submits an application or presses a final submit button.
- It never claims anything the candidate's sources don't support, and never
  changes a title, employer, date or degree.
- It never answers work authorization, compensation, demographic or legal
  questions for the candidate.
- It never opens LinkedIn, Indeed or other job boards in its browser.
- The assistant's changes need the candidate's confirmation; approvals, sends
  and submissions are candidate-only.
- Recruiter-facing text goes through the humanizer pass.

## Where things are

| Area | Files |
| --- | --- |
| Server and API | `plainhand-server.mjs` |
| Actions the UI, assistant and MCP share | `plainhand/actions.mjs` |
| Assistant | `plainhand/agent.mjs`, `plainhand/agents.mjs` |
| Drafting, review, calibration | `plainhand/workflow.mjs`, `plainhand/humanize.mjs` |
| Application browser | `plainhand/jobs.mjs` and `plainhand/browser-*.mjs` |
| Front end | `plainhand/web/` |

The career-ops command-line tools that Plainhand builds on are still in the
repository; their guide is [docs/career-ops](docs/career-ops/README.md).

By contributing you agree your work is released under the [MIT License](LICENSE).
