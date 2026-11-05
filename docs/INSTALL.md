# Installing Plainhand

Plainhand runs on your computer. You need Node.js, a copy of Plainhand, and one
AI account. Plainhand sets up the AI connector from its own screen.

## One command

With [Node.js 22 or newer](https://nodejs.org), this downloads, sets up and
starts Plainhand, then opens it:

macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/akhan157/Plainhand/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/akhan157/Plainhand/main/install.ps1 | iex
```

The first run installs dependencies and Chromium, creates a `plainhand`
command, and starts Plainhand. Your workspace is kept in
`~/.plainhand/workspace` (`%USERPROFILE%\.plainhand\workspace` on Windows); the
downloaded code stays separate. Use `plainhand --port 3211` if 3210 is busy,
`plainhand --data-root /path/to/workspace` for another folder, or
`plainhand --check` to see what is installed without starting.

The manual steps below are for a development checkout. The same installer can
be pointed elsewhere with `PLAINHAND_HOME=/path` and
`PLAINHAND_BIN_DIR=/path/bin`.

Plan on about 15 minutes for the full first-time setup.

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

## 4. Start Plainhand

```bash
npm start
```

Open **http://127.0.0.1:3210**. Use exactly that address; `localhost` is
refused on purpose. Leave the terminal open while you use Plainhand. Stop it
with Ctrl+C.

## 5. Connect an AI account

On **Connections**, choose Claude or ChatGPT and follow the three steps:
**Set up**, **Sign in**, **Check it works**. Plainhand downloads the connector
into its own folder and opens the provider's browser sign-in, so you do not
need a terminal command or a global install. Your plan's limits and billing
apply. For Google Antigravity, open its official app from the link Plainhand
shows, sign in there, then check the connection.

Plainhand never reads your credentials; the provider signs in on its own.

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
