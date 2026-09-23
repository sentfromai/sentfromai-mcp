# sentfromai-mcp

[![npm](https://img.shields.io/npm/v/sentfromai-mcp)](https://www.npmjs.com/package/sentfromai-mcp)
[![MCP registry](https://img.shields.io/badge/MCP_registry-ai.sentfrom%2Fmcp-2ea44f)](https://registry.modelcontextprotocol.io/v0/servers?search=ai.sentfrom)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MCP server for [SentFromAI](https://sentfrom.ai) — email infrastructure for AI agents.

Gives any MCP-capable agent (Claude Code, Claude Desktop, Cursor, VS Code, Gemini CLI,
Codex, OpenClaw, or your own MCP host) email as native tools: create inboxes, send,
reply, forward, search, read threads, manage drafts, custom domains, webhooks, and
allow/block rules — 21 tools, each a thin wrapper over the
[SentFromAI REST API](https://docs.sentfrom.ai/api-reference/introduction). Every tool
carries MCP annotations (read-only / write / send / delete) so hosts can group them
and confirm the irreversible ones.

You need a SentFromAI API key (`sf_live_…`) from the [console](https://console.sentfrom.ai).
Free plan: 5 inboxes, 5,000 emails/month, no card.

## Let your agent install it

Paste this into your agent (Claude Code, OpenClaw, Gemini CLI, any MCP-capable agent):

```text
Set up SentFromAI email for yourself: fetch https://docs.sentfrom.ai/agent-install.md
and follow it. Ask me for the API key when you need it.
```

## Install

### Claude Code

As a plugin (asks for the key when you enable it, and adds a skill that teaches Claude email etiquette):

```bash
claude plugin marketplace add sentfromai/sentfromai-mcp
claude plugin install sentfromai@sentfromai
```

Or as a plain MCP server:

```bash
claude mcp add sentfromai --env SENTFROMAI_API_KEY=sf_live_… -- npx -y sentfromai-mcp
```

### Claude Desktop, Cursor, Windsurf, Cline, any JSON-config host

```json
{
  "mcpServers": {
    "sentfromai": {
      "command": "npx",
      "args": ["-y", "sentfromai-mcp"],
      "env": { "SENTFROMAI_API_KEY": "sf_live_…" }
    }
  }
}
```

Cursor one-click (then paste your key into the generated config):
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=sentfromai&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNlbnRmcm9tYWktbWNwIl0sImVudiI6eyJTRU5URlJPTUFJX0FQSV9LRVkiOiJzZl9saXZlX+KApiJ9fQ==)

### VS Code

```bash
code --add-mcp '{"name":"sentfromai","command":"npx","args":["-y","sentfromai-mcp"],"env":{"SENTFROMAI_API_KEY":"sf_live_…"}}'
```

### Gemini CLI

```bash
gemini extensions install https://github.com/sentfromai/sentfromai-mcp
```

Gemini asks for the API key on install and keeps it in your keychain.

### Codex CLI

```bash
codex mcp add sentfromai --env SENTFROMAI_API_KEY=sf_live_… -- npx -y sentfromai-mcp
```

### OpenClaw

```bash
openclaw mcp add sentfromai --command npx --arg -y --arg sentfromai-mcp --env SENTFROMAI_API_KEY=sf_live_…
openclaw skills install git:sentfromai/sentfromai-mcp
```

Full guide: [docs.sentfrom.ai/frameworks/openclaw](https://docs.sentfrom.ai/frameworks/openclaw).

## Tools

| Area | Tools | Annotation |
| --- | --- | --- |
| Inboxes | `create_inbox` · `list_inboxes` · `delete_inbox` | write · read · delete |
| Messages | `send_message` · `reply_to_message` · `forward_message` | send (irreversible, open world) |
| | `get_message` · `search_messages` | read |
| Threads | `list_threads` · `get_thread` | read |
| Drafts | `create_draft` · `send_draft` · `list_drafts` | write · send · read |
| Domains | `add_domain` · `get_domain` | write · read |
| Webhooks | `create_webhook` · `list_webhooks` · `delete_webhook` | write · read · delete |
| Allow/block | `add_address_rule` · `list_address_rules` · `delete_address_rule` | write · read · delete |

Replies thread correctly (In-Reply-To/References set automatically), search
supports keyword, semantic, and hybrid modes, and sends respect the same
idempotency and suppression rules as the REST API. API failures come back as tool
results with `isError` and the HTTP status, so the model can read a `401` (bad key)
or `402` (plan limit) and tell you instead of retrying.

## Configuration

| Env var | Required | Default |
| --- | --- | --- |
| `SENTFROMAI_API_KEY` | yes | — |
| `SENTFROMAI_BASE_URL` | no | `https://api.sentfrom.ai` |

## Programmatic use

The tools are exported so you can embed them in your own MCP host or transport:

```js
import { createServer, TOOLS, callTool, createApi } from 'sentfromai-mcp'

const server = createServer({ apiKey: process.env.SENTFROMAI_API_KEY })
await server.connect(yourTransport)
```

## Privacy

This server keeps no state and stores nothing locally. Every tool call is one HTTPS
request to `api.sentfrom.ai` authenticated with your API key. SentFromAI's privacy
policy: https://sentfrom.ai/privacy · terms: https://sentfrom.ai/terms.

## Docs

- [MCP guide](https://docs.sentfrom.ai/guides/mcp)
- [API reference](https://docs.sentfrom.ai/api-reference/introduction)
- [SentFromAI for agents](https://docs.sentfrom.ai/for-agents)
