# Installing Plainhand

Plainhand runs on your computer. You need Node.js, a copy of Plainhand, and one
AI account's command-line tool. Plan on about 15 minutes.

## 1. Install Node.js 22 or newer

- **macOS:** download the LTS installer from [nodejs.org](https://nodejs.org),
  or `brew install node`.
- **Windows:** download the LTS installer from [nodejs.org](https://nodejs.org)
  and accept the defaults. Use **PowerShell** or **Windows Terminal** for the
  commands below.
- **Linux:** use your distribution's Node.js 22 package or
  [nodejs.org](https://nodejs.org) (NodeSource or `nvm` both work).

Check with `node --version` (it should print v22 or higher).

## 2. Get Plainhand

With git: `git clone https://github.com/akhan157/plainhand.git`. Without git: download the
ZIP from the repository page and unzip it. Then open a terminal in that folder:

```bash
cd plainhand
```

## 3. Run setup

```bash
npm run setup
```

Setup checks Node.js, installs dependencies and the Chromium browser Plainhand
uses for PDFs and form filling, and tells you about anything optional:

- **PDF resume import** needs `pdftotext`: `brew install poppler` (macOS),
  `sudo apt install poppler-utils` (Debian/Ubuntu). On Windows, paste your
  resume text instead.
- **Linux:** Chromium may need system libraries: `npx playwright install-deps chromium`.

`npm run setup -- --check` reports without installing anything.

## 4. Connect an AI account

Install and sign in to one (your plan's limits and billing apply):

| Account | Install | Sign in |
| --- | --- | --- |
| Claude | `npm install -g @anthropic-ai/claude-code` | run `claude` and follow the sign-in |
| ChatGPT | `npm install -g @openai/codex` | `codex login` |
| Google Antigravity | see [Antigravity install](https://www.antigravity.google/docs/install?tab=cli) | run `agy` and sign in |

Plainhand never reads your credentials; the tool signs in on its own.

## 5. Start

```bash
npm start
```

Open **http://127.0.0.1:3210**. Use exactly that address; `localhost` is
refused on purpose. Leave the terminal open while you use Plainhand. Stop it
with Ctrl+C.

On the **Connections** screen, choose your account and press **Check and use**.

## Updating

```bash
git pull
npm run setup
```

Your data lives in `data/`, `config/profile.yml`, `cv.md` and `output/` and is
not touched by updates. **Workspace → Export workspace** makes a backup you
can import into a fresh copy.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `node: command not found` or version below 22 | Install Node.js 22+ (step 1), then open a new terminal |
| "Chromium not installed" | `npx playwright install chromium` |
| The page says to use the 127.0.0.1 address | Open `http://127.0.0.1:3210`, not `localhost` |
| Port 3210 in use | `npm start -- --port 3220`, then open that port |
| "No AI account CLI found" | Install one from step 4, sign in, restart Plainhand |
| The application browser doesn't appear (Linux) | Plainhand needs a graphical desktop session |
| A site asks you to sign in or solve a check | Use **Handle sign-in or verification** in the Apply tab, complete it, then **Resume inspection** |
