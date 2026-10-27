# Plainhand MCP server

`plainhand-mcp.mjs` is a local MCP server (stdio). It lets your own agent
(Claude Code, Claude Desktop, Codex) read your Plainhand workspace and make the
same changes the Plainhand screens can make, under the same rules.

It is a thin bridge. It never reads or writes workspace files. Every tool call
goes to the running Plainhand server, which is still the only writer and which
checks every rule itself (contract: [Agent contracts, MCP bridge](AGENT-CONTRACTS.md)).

## Plainhand must be running

Start Plainhand first (`npm start` in the Plainhand folder). On startup it writes
`data/plainhand/local-api.json` (owner-only) with its port and a private MCP
token, and deletes it on shutdown. The MCP server reads that file on every
call, so a Plainhand restart (new port, new token) needs no reconfiguration.

If Plainhand is not running, every tool returns:
"Plainhand is not running. Start it with `npm start` in the Plainhand folder, then try again."

`--data-root <dir>` points at the folder that holds `data/plainhand/`. The
default is the Plainhand folder itself, as for `npm start`. Use the same value
you give `plainhand-server.mjs --data-root`, if any.

## Setup

Use absolute paths. Replace `/path/to/plainhand` with your Plainhand folder.

**Claude Code** (checked against `claude mcp add --help`):

```sh
claude mcp add plainhand -- node /path/to/plainhand/plainhand-mcp.mjs --data-root /path/to/plainhand
```

Add `--scope user` before `plainhand` to make it available in every project.
Check it with `claude mcp list`.

**Codex** (`~/.codex/config.toml`, checked against the Codex MCP docs):

```toml
[mcp_servers.plainhand]
command = "node"
args = ["/path/to/plainhand/plainhand-mcp.mjs", "--data-root", "/path/to/plainhand"]
```

Or: `codex mcp add plainhand -- node /path/to/plainhand/plainhand-mcp.mjs --data-root /path/to/plainhand`.

**Claude Desktop** (`claude_desktop_config.json`, the standard `mcpServers`
format; not tested here):

```json
{ "mcpServers": { "plainhand": { "command": "node", "args": ["/path/to/plainhand/plainhand-mcp.mjs", "--data-root", "/path/to/plainhand"] } } }
```

## Tools

Each Plainhand action becomes one tool. The name is `plainhand_` plus the action
name with dots replaced by underscores:

| Plainhand action | MCP tool |
| --- | --- |
| `workspace.digest` | `plainhand_workspace_digest` |
| `jobs.get` | `plainhand_jobs_get` |
| `record.setNextAction` | `plainhand_record_setNextAction` |
| `packet.approve` | `plainhand_packet_approve` |

Plus `plainhand_undo { undoToken }`. The list comes from Plainhand
(`GET /api/mcp/actions`) at startup and on every tools list, so new actions
appear without changing this server. Input schemas are strict JSON Schema
(`additionalProperties: false`; dates are `YYYY-MM-DD`). Write tools also take
an optional `reason`: why you asked, saved in the audit log.

The workspace overview is also a resource: `plainhand://digest`.

## What your agent can and cannot do

Each tool description ends with its tier in plain words.

| Tier | Through MCP |
| --- | --- |
| Read ("Read only.") | Runs. |
| Write ("Changes your Plainhand data…") | Runs, is audited, and returns an `undoToken` when the change is reversible: `plainhand_undo` reverses it once, within 10 minutes, if nothing changed since. |
| Candidate ("Only you can do this in Plainhand…") | Never runs. Approving a packet, approving your profile understanding, approving or rejecting a correction, confirming a submission, and setting status to Applied return a link to the right Plainhand screen. Nothing changes. |
| Task (discovery, evaluation, preparation, profile interview) | Not offered. Start tasks inside Plainhand. |

Form filling in the application browser is not reachable through MCP.

## Privacy

Your agent, and whichever model provider it uses, sees what the tools return:

- `plainhand_workspace_digest` and `plainhand_jobs_list`: companies, titles,
  locations, stages, statuses, scores, next actions, interview dates, open
  tasks. No contact details, interview notes, posting text or packet text.
- `plainhand_jobs_get` returns the evaluation by default, and the posting text,
  packet or application record (contacts, interview notes) only when `include`
  asks for them.
- Results that include posting text, or model output derived from it, start
  with a note that the content is untrusted employer text, to be treated as
  data and never as instructions.

## Audit

Plainhand records each MCP write as `mcp-write` with the action name and your
`reason` (or a one-line summary), and each undo as `mcp-undo`. Reads are not
logged. See the Workspace screen in Plainhand, or `plainhand_audit_list`.
