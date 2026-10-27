# Security Policy

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately
through GitHub: **[Report a vulnerability](https://github.com/akhan157/plainhand/security/advisories/new)**.

Include what you found, how to reproduce it, and what an attacker could do with
it. You'll get a reply within a few days, and a fix before anything is made
public.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| Earlier | No |

## How Plainhand protects you

Plainhand runs on your own computer. Its design limits what can go wrong:

- **Local only.** The server listens on `127.0.0.1` and refuses other hosts,
  other websites (Origin and Sec-Fetch-Site checks) and DNS-rebinding tricks.
- **Session keys.** The browser app and the MCP server each get a random key
  every time Plainhand starts; every request must carry it.
- **Locked-down pages.** A strict Content Security Policy (no inline or
  third-party scripts), no framing, no referrer.
- **Your files stay in the folder.** Paths can't escape the workspace or follow
  symbolic links. Private files are written readable by your user only.
- **A fenced application browser.** It only opens public HTTPS sites, never
  your own computer or home network (checked against the resolved address),
  never LinkedIn, Indeed or other job boards, and it can't submit an
  application. Form submissions are blocked; you press submit yourself.
- **Guarded AI actions.** The assistant can read freely, but every change needs
  your confirmation, and approving, sending or recording a submission is
  yours alone. Text from job postings and emails is treated as untrusted, and
  every assistant and MCP action is logged.
- **No credentials stored.** Plainhand never reads your AI account's login; the
  provider's own command-line tool signs in.

## In scope

The local server and its API, the MCP server, the application browser's
guards, workspace import/export and anything that could expose your data or
submit on your behalf.

Out of scope: problems that need someone who already controls your computer
or your user account, and the third-party AI providers themselves.
