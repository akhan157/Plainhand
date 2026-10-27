# Plainhand

Plainhand is a job-application assistant that runs on your own computer and uses
your own AI subscription (Claude, ChatGPT or Gemini/Antigravity). You talk to
it about your experience; it builds a profile of you in your own words, writes
a standard resume and cover letter you approve once, tailors them for each
role, fills application forms on employer sites, and lists anything it
couldn't answer. **You review and submit every application yourself.**

- **A profile that sounds like you.** Built by conversation and from a few
  samples of your writing. Every claim it makes is traced to something you
  said or provided.
- **Not too modest, not overstated.** Each line is graded against your
  evidence: undersold, balanced, stretched or unsupported. It learns where you
  draw the line from your choices. Titles, employers, dates and degrees are
  always exact, and nothing you can't back up is used.
- **Your format, no AI writing.** Plainhand reads the layout of your own
  resume PDF (fonts, margins, headings, section order, dates, bullets) and
  renders every resume and cover letter in it. Every line it writes goes
  through a humanizer pass ([blader/humanizer](https://github.com/blader/humanizer))
  that removes AI writing patterns without changing a fact or number.
- **Less tedium.** One standard application, tailored per role; "make it
  shorter" or "lead with the pump project" revises it; queues let you review
  and send several in a row.
- **Forms filled, gaps flagged.** On Greenhouse, Lever, Ashby and other
  employer sites it fills what it can from your approved packet and profile,
  uploads your resume and cover letter, and shows a pre-submit list of what's
  filled, what needs you and what to double-check.
- **Your data stays with you.** Everything is stored in this folder. The AI
  provider sees only what a task needs, and you can exclude any source.

## What you need

- A Mac, Windows or Linux computer with a desktop (the application browser
  opens on screen).
- [Node.js 22 or newer](https://nodejs.org).
- An AI account with its command-line tool, signed in. One of:
  Claude (`npm install -g @anthropic-ai/claude-code`, then `claude`),
  ChatGPT (`npm install -g @openai/codex`, then `codex login`),
  or Google Antigravity (`agy`). Your plan's usage limits apply.

## Install and start

```bash
git clone https://github.com/akhan157/plainhand.git
cd plainhand
npm run setup     # checks your computer and installs what's needed
npm start
```

Open **http://127.0.0.1:3210** (use that exact address). Step-by-step help for
each operating system is in [docs/INSTALL.md](docs/INSTALL.md).

## First hour

1. **Connections:** pick your AI account, follow its three steps and press **Check and use**.
2. **Profile & brain:** paste your resume, then talk to Plainhand about a
   project or job you're proud of. Add two or three things you've written.
   Review "How your agent sees you" and approve it if it's right.
3. **Your standard application:** have Plainhand write it, read it, ask for
   changes, and approve it.
4. **Jobs:** paste a job link (company career pages, Greenhouse, Lever,
   Ashby, Workday… or a LinkedIn/Indeed posting plus the employer's
   application link). Evaluate it, choose it, prepare the application.
5. **Apply:** review the packet, approve it, open the application, let
   Plainhand fill it, check the pre-submit list, and submit it yourself on
   the employer's site. Then tell Plainhand you submitted.

The full walkthrough is in [docs/USER-GUIDE.md](docs/USER-GUIDE.md). Prefer to
look first? **Take a look around** on the home screen opens a sample workspace.

## What Plainhand never does

- Submit an application, press a final submit button, or mark something
  applied without your confirmation.
- Claim anything your sources don't support, or change an official title,
  employer, date, degree or seniority.
- Answer work authorization, compensation, demographic or legal questions for
  you.
- Open LinkedIn, Indeed or other job boards in its browser (their terms
  prohibit automation). Save the posting and give it the employer's link.
- Send your data anywhere except your chosen AI provider, for the task at hand.

## Help and docs

- [Install guide](docs/INSTALL.md) · [User guide](docs/USER-GUIDE.md)
- [Browser app reference](docs/PLAINHAND-BROWSER-APP.md) (features, limits, data files)
- [Use Plainhand from your own agent (MCP)](docs/MCP.md)
- [What Plainhand measures](docs/METRICS-INVENTORY.md) · [Verification](docs/VERIFICATION-MATRIX.md)
- [Changelog](CHANGELOG.md)

## Credits and license

Plainhand builds on [career-ops](https://github.com/santifer/career-ops) by
Santiago Fernández de Valderrama (MIT). The career-ops name and brand belong
to its maintainer (see [TRADEMARK.md](TRADEMARK.md)); its original README is
kept in [docs/career-ops](docs/career-ops/README.md). The career-ops
command-line tools still ship in this repository for advanced use. Plainhand is
MIT-licensed ([LICENSE](LICENSE)).
