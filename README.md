# sentfromai-mcp

This branch prepares `0.5.0-beta.1`. Use its pinned install commands only after the
release operator confirms publication; a source checkout is not a published release.
Existing marketplace, Gemini, Cursor and server-directory defaults remain on the
stable mail release. The beta companion is enabled explicitly through the local
installation instructions below.

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

Use an existing SentFromAI API key (`sf_live_…`), or follow the
[agent setup guide](https://docs.sentfrom.ai/agent-install.md) to bootstrap an
inbox through REST when agent signup is enabled. New agent accounts can receive
and read before their human claims them; sending and other changes require that
claim. The console remains available for human signup.

## Let your agent install it

Paste this into your agent (Claude Code, OpenClaw, Gemini CLI, any MCP-capable agent):

```text
Set up email for yourself: https://docs.sentfrom.ai/agent-install.md
```

Bootstrap uses `POST /v1/agent-signups`, not an MCP tool: MCP requires the key
returned by signup. Save a random `Idempotency-Key` before the request and reuse
it with the same body for retries within the replay window. Save the response
privately; give its `claim_url` only to your operator in your existing chat.
`GET /v1/account` reports current capabilities; `POST /v1/account/claim-link`
refreshes a link with the original API key. Claiming preserves the inbox and key.

Use your host's protected credential configuration. Never put a real key in
chat, shell commands, source control or logs. Configure `SENTFROMAI_API_KEY` in
the stdio server environment privately before starting it; examples below show
placeholders only. For hosted MCP, configure its Bearer header privately.
This onboarding flow needs the matching API and console rollout; the package
itself does not create accounts or bypass account limits.

## Install

### Claude Code

As a plugin (asks for the key when you enable it, and adds a skill that teaches Claude email etiquette):

```bash
claude plugin marketplace add sentfromai/sentfromai-mcp
claude plugin install sentfromai@sentfromai
```

Or as a plain MCP server:

```bash
claude mcp add sentfromai -- npx -y sentfromai-mcp@0.4.1
```

### Claude Desktop, Cursor, Windsurf, Cline, any JSON-config host

```json
{
  "mcpServers": {
    "sentfromai": {
      "command": "npx",
      "args": ["-y", "sentfromai-mcp@0.4.1"],
      "env": { "SENTFROMAI_API_KEY": "sf_live_…" }
    }
  }
}
```

Cursor one-click (then paste your key into the generated config):
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=sentfromai&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNlbnRmcm9tYWktbWNwIl0sImVudiI6eyJTRU5URlJPTUFJX0FQSV9LRVkiOiJzZl9saXZlX+KApiJ9fQ==)

### Cursor and Grok Bot (plugin)

Install **SentFromAI** from the Cursor Marketplace; Grok Bot lists the same plugin under
Settings, Plugins. It connects to the hosted endpoint and asks for your API key on install.
To try it before it is listed, copy this repo into `~/.cursor/plugins/local/sentfromai`
and reload Cursor.

### VS Code

Add `npx -y sentfromai-mcp@0.4.1` through VS Code's MCP configuration and enter
`SENTFROMAI_API_KEY` in a protected input.

### Gemini CLI

```bash
gemini extensions install https://github.com/sentfromai/sentfromai-mcp
```

Gemini asks for the API key on install and keeps it in your keychain.

### Codex CLI

```bash
codex mcp add sentfromai -- npx -y sentfromai-mcp@0.4.1
```

### OpenClaw

```bash
openclaw mcp add sentfromai --command npx --arg -y --arg sentfromai-mcp@0.4.1
openclaw skills install git:sentfromai/sentfromai-mcp
```

Full guide: [docs.sentfrom.ai/frameworks/openclaw](https://docs.sentfrom.ai/frameworks/openclaw).

## Hosted endpoint (no install)

The same 21 tools are served over Streamable HTTP at `https://api.sentfrom.ai/mcp` for
hosts that only speak remote MCP (claude.ai connectors, ChatGPT apps, Meta Muse, Cursor
remote servers, MCP Inspector). Authenticate with `Authorization: Bearer sf_live_…`
(an `x-api-key` header also works), or let OAuth-capable hosts sign you in: the
endpoint publishes RFC 9728 resource metadata pointing at SentFromAI's authorization server.

```bash
claude mcp add --transport http sentfromai https://api.sentfrom.ai/mcp
```

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

## Optional Agent Login companion

For a new human account and agent, follow the bundled
[SentFrom beta onboarding guide](skills/agent-login/ONBOARDING.md). It includes a
validated configuration example, the independent human activation steps, and
recovery instructions. Beta admission and first-factor activation require the
advertised operator process.

The email tools and application sign-in are separate capabilities. The existing
hosted mail MCP endpoint does not hold your local browser or application sessions.
The new local companion adds enrollment, human approval, application sign-in,
authenticated application operations and logout using the open Agent Login SDK.
It targets the working draft; it is not a claim that the hosted service is already
deployed or certified.

The planned beta uses `agentlogin@0.2.0-beta.1`, `@agentlogin/mcp@0.2.0-beta.1`
and `sentfromai-mcp@0.5.0-beta.1`. These versions are release candidates until the
release operator confirms publication. Before publication, install the matching
reviewed tarballs supplied by that operator:

```sh
npm install --save-exact /absolute/artifacts/agentlogin-0.2.0-beta.1.tgz /absolute/artifacts/agentlogin-mcp-0.2.0-beta.1.tgz /absolute/artifacts/sentfromai-mcp-0.5.0-beta.1.tgz
```

After those exact versions are confirmed public, a registry installation is:

```sh
npm install --save-exact agentlogin@0.2.0-beta.1 @agentlogin/mcp@0.2.0-beta.1 sentfromai-mcp@0.5.0-beta.1
```

Use a maintained Node.js release satisfying the companion's Node.js 22.13 minimum.
The mail-only package retains its existing runtime requirement.

Create a private mode-0600 Agent Login config following the companion README. Set
the selected identity's `handle` to the existing inbox, `enrollmentEndpoint` to
the actual deployed identity service's `/identity/enrollment-requests`, and
`enrollmentCredentialEnv` to `SENTFROMAI_API_KEY`. Supply the latter only through
the host's protected secret configuration. Set `ownerPortal` to the actual human
identity service origin and `ownerApprovalPath` to
`/identity/transactions/{transaction_id}` for direct human approval links. Configure each target application
explicitly; a provider catalog does not authorize application access.

For a Git-cloned Claude plugin, install the exact companion in that checkout with
`npm install --no-save @agentlogin/mcp@0.2.0-beta.1` after its publication; installing
it in an unrelated project does not make it available to this wrapper. For other
hosts, use both packages from the same npm installation directory.

For Claude plugin installations, the opt-in `mcp-with-identity.json` contains both
local servers. Select it as the plugin's `mcpServers` configuration and configure
`identity_config` to the absolute private config path. Other MCP hosts can add a
local server command `node /absolute/package/identity-server.js` with
`AGENTLOGIN_MCP_CONFIG` and `SENTFROMAI_API_KEY` in their protected environment.
Keep the existing mail-only configuration when the companion is not installed.

The `skills/agent-login` skill explains the tool flow. Keys and cookies remain in
the local helper's private directory. A successful sign-in authenticates that
helper; it does not authenticate a separate browser. Owner approval takes place in
the independent human interface and cannot be performed with the mail API key.
