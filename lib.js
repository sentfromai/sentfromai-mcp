// SentFromAI MCP server — shared core. Every tool is one authenticated HTTP call
// to the REST API; no business logic or DB access here, which keeps SentFromAI
// portable (swap the backend, keep the MCP surface).
//
// Consumers:
//   - server.js (this package's bin): stdio transport for local MCP hosts
//   - api.sentfrom.ai/mcp: the hosted Streamable HTTP endpoint — same tools, the
//     bearer token comes from the request instead of the environment
import { readFileSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
export const DEFAULT_BASE_URL = 'https://api.sentfrom.ai'

// Tool annotations are hints for hosts (directory review, confirmation prompts,
// grouping) — never enforcement. Four presets cover every tool:
//   READ    pure lookup, safe to retry
//   WRITE   creates or changes tenant-owned state, no outside effect
//   SEND    puts email on the wire — irreversible, reaches the outside world
//   DELETE  removes tenant-owned state
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const SEND = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }

const tool = (name, title, description, inputSchema, hints) => ({
  name,
  title,
  description,
  inputSchema,
  annotations: { title, ...hints },
})

const NO_ARGS = { type: 'object', properties: {} }

export const TOOLS = [
  // ── Inboxes ──────────────────────────────────────────────────────────────
  tool(
    'create_inbox',
    'Create inbox',
    'Create a new email inbox. Defaults to the managed mail.sentfrom.ai domain.',
    {
      type: 'object',
      properties: {
        local_part: { type: 'string', description: 'The part before @ (e.g. "support" or a user hash).' },
        display_name: { type: 'string', description: 'Optional display name shown in the From header.' },
      },
      required: ['local_part'],
    },
    WRITE,
  ),
  tool('list_inboxes', 'List inboxes', 'List all inboxes for this tenant.', NO_ARGS, READ),
  tool(
    'delete_inbox',
    'Delete inbox',
    'Delete an inbox. Mail to its address stops being accepted.',
    { type: 'object', properties: { inbox_id: { type: 'string' } }, required: ['inbox_id'] },
    DELETE,
  ),
  // ── Messages ─────────────────────────────────────────────────────────────
  tool(
    'send_message',
    'Send email',
    'Send a new email from one of your inboxes.',
    {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', description: 'The sending inbox id.' },
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses.' },
        cc: { type: 'array', items: { type: 'string' } },
        bcc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        text: { type: 'string', description: 'Plain-text body.' },
        html: { type: 'string', description: 'Optional HTML body.' },
        attachments: {
          type: 'array',
          description: 'Optional file attachments.',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              content_type: { type: 'string' },
              content_base64: { type: 'string', description: 'Base64-encoded file content.' },
            },
            required: ['content_base64'],
          },
        },
      },
      required: ['inbox_id', 'to', 'subject'],
    },
    SEND,
  ),
  tool(
    'reply_to_message',
    'Reply to email',
    'Reply to a message, staying in its thread (sets In-Reply-To/References automatically).',
    {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The id of the message to reply to.' },
        text: { type: 'string' },
        html: { type: 'string' },
      },
      required: ['message_id'],
    },
    SEND,
  ),
  tool(
    'forward_message',
    'Forward email',
    'Forward a message to new recipients in a fresh thread, quoting the original and re-attaching its files.',
    {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The id of the message to forward.' },
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses.' },
        text: { type: 'string', description: 'Optional note placed above the quoted original.' },
        from_inbox_id: { type: 'string', description: 'Optional: send from a different inbox than the one that received the original.' },
      },
      required: ['message_id', 'to'],
    },
    SEND,
  ),
  tool(
    'get_message',
    'Get message',
    'Fetch a single message by id, including body and attachment links.',
    { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] },
    READ,
  ),
  tool(
    'search_messages',
    'Search messages',
    'Search messages across the tenant. mode: keyword (default), semantic (by meaning), or hybrid. No query returns recent messages.',
    {
      type: 'object',
      properties: {
        query: { type: 'string' },
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode.' },
        inbox_id: { type: 'string', description: 'Optional: restrict to one inbox.' },
        limit: { type: 'number' },
      },
    },
    READ,
  ),
  // ── Threads ──────────────────────────────────────────────────────────────
  tool(
    'list_threads',
    'List threads',
    'List conversation threads, most recently active first.',
    {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', description: 'Optional: restrict to one inbox.' },
        limit: { type: 'number', description: 'Max threads to return (default 25, max 100).' },
      },
    },
    READ,
  ),
  tool(
    'get_thread',
    'Get thread',
    'Fetch a thread and all its messages in order.',
    { type: 'object', properties: { thread_id: { type: 'string' } }, required: ['thread_id'] },
    READ,
  ),
  // ── Drafts ───────────────────────────────────────────────────────────────
  tool(
    'create_draft',
    'Create draft',
    'Create a draft (optionally scheduled, optionally a reply). Does not send.',
    {
      type: 'object',
      properties: {
        inbox_id: { type: 'string' },
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        text: { type: 'string' },
        html: { type: 'string' },
        reply_to_message_id: { type: 'string', description: 'Make this draft a reply to a message.' },
        scheduled_at: { type: 'string', description: 'ISO timestamp to auto-send at.' },
      },
      required: ['inbox_id'],
    },
    WRITE,
  ),
  tool(
    'send_draft',
    'Send draft',
    'Send an existing draft immediately.',
    { type: 'object', properties: { draft_id: { type: 'string' } }, required: ['draft_id'] },
    SEND,
  ),
  tool('list_drafts', 'List drafts', 'List drafts for this tenant.', NO_ARGS, READ),
  // ── Domains ──────────────────────────────────────────────────────────────
  tool(
    'add_domain',
    'Add sending domain',
    'Add a custom sending domain. Returns the DNS records to add to your DNS; verification is automatic once they propagate.',
    { type: 'object', properties: { hostname: { type: 'string' } }, required: ['hostname'] },
    WRITE,
  ),
  tool(
    'get_domain',
    'Get domain status',
    'Get a domain’s verification status and required DNS records.',
    { type: 'object', properties: { domain_id: { type: 'string' } }, required: ['domain_id'] },
    READ,
  ),
  // ── Webhooks ─────────────────────────────────────────────────────────────
  tool(
    'create_webhook',
    'Create webhook',
    'Register a webhook endpoint for delivery events. The signing secret is returned once on creation — store it.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTPS endpoint to receive events.' },
        events: { type: 'array', items: { type: 'string' }, description: 'Event types (default ["message.received"]).' },
      },
      required: ['url'],
    },
    WRITE,
  ),
  tool('list_webhooks', 'List webhooks', 'List webhook endpoints (signing secrets omitted).', NO_ARGS, READ),
  tool(
    'delete_webhook',
    'Delete webhook',
    'Delete a webhook endpoint.',
    { type: 'object', properties: { webhook_id: { type: 'string' } }, required: ['webhook_id'] },
    DELETE,
  ),
  // ── Allow/block lists ────────────────────────────────────────────────────
  tool(
    'add_address_rule',
    'Add allow/block rule',
    'Add an allow or block rule for an email address or bare domain. Block rules are enforced on both send and receive.',
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['allow', 'block'] },
        pattern: { type: 'string', description: 'Email address or bare domain (e.g. "spam.example").' },
        direction: { type: 'string', enum: ['inbound', 'outbound', 'both'], description: 'Default: both.' },
      },
      required: ['kind', 'pattern'],
    },
    WRITE,
  ),
  tool('list_address_rules', 'List allow/block rules', 'List allow/block rules for this tenant.', NO_ARGS, READ),
  tool(
    'delete_address_rule',
    'Delete allow/block rule',
    'Delete an allow/block rule.',
    { type: 'object', properties: { rule_id: { type: 'string' } }, required: ['rule_id'] },
    DELETE,
  ),
]

// One authenticated JSON call to the REST API. Non-2xx responses throw an
// ApiError carrying the status so callers can decide how to surface it.
export class ApiError extends Error {
  constructor(status, body, method, path) {
    super(`sentfromai ${method} ${path} -> ${status}: ${body}`)
    this.status = status
    this.body = body
  }
}

export function createApi({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/$/, '')
  return async function api(method, path, body) {
    const res = await fetchImpl(`${root}/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new ApiError(res.status, text, method, path)
    return text ? JSON.parse(text) : null
  }
}

const query = (pairs) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(pairs)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

// Dispatch one tool call to the REST API. Exported so the hosted endpoint and
// tests can exercise tools without an MCP transport.
export async function callTool(api, name, a = {}) {
  switch (name) {
    case 'create_inbox':
      return api('POST', '/inboxes', { local_part: a.local_part, display_name: a.display_name })
    case 'list_inboxes':
      return api('GET', '/inboxes')
    case 'delete_inbox':
      return api('DELETE', `/inboxes/${a.inbox_id}`)
    case 'send_message':
      return api('POST', '/messages', {
        inbox_id: a.inbox_id, to: a.to, cc: a.cc, bcc: a.bcc,
        subject: a.subject, text: a.text, html: a.html, attachments: a.attachments,
      })
    case 'reply_to_message':
      return api('POST', `/messages/${a.message_id}/reply`, { text: a.text, html: a.html })
    case 'forward_message':
      return api('POST', `/messages/${a.message_id}/forward`, { to: a.to, text: a.text, from_inbox_id: a.from_inbox_id })
    case 'get_message':
      return api('GET', `/messages/${a.message_id}`)
    case 'search_messages':
      return api('GET', `/messages${query({ query: a.query, mode: a.mode, inbox_id: a.inbox_id, limit: a.limit })}`)
    case 'list_threads':
      return api('GET', `/threads${query({ inbox_id: a.inbox_id, limit: a.limit })}`)
    case 'get_thread':
      return api('GET', `/threads/${a.thread_id}`)
    case 'create_draft':
      return api('POST', '/drafts', {
        inbox_id: a.inbox_id, to: a.to, subject: a.subject, text: a.text, html: a.html,
        reply_to_message_id: a.reply_to_message_id, scheduled_at: a.scheduled_at,
      })
    case 'send_draft':
      return api('POST', `/drafts/${a.draft_id}/send`)
    case 'list_drafts':
      return api('GET', '/drafts')
    case 'add_domain':
      return api('POST', '/domains', { hostname: a.hostname })
    case 'get_domain':
      return api('GET', `/domains/${a.domain_id}`)
    case 'create_webhook':
      return api('POST', '/webhooks', { url: a.url, events: a.events })
    case 'list_webhooks':
      return api('GET', '/webhooks')
    case 'delete_webhook':
      return api('DELETE', `/webhooks/${a.webhook_id}`)
    case 'add_address_rule':
      return api('POST', '/lists', { kind: a.kind, pattern: a.pattern, direction: a.direction })
    case 'list_address_rules':
      return api('GET', '/lists')
    case 'delete_address_rule':
      return api('DELETE', `/lists/${a.rule_id}`)
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

// Build an MCP Server bound to one tenant credential. The caller attaches a
// transport (stdio locally, Streamable HTTP when hosted).
export function createServer({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl }) {
  const api = createApi({ apiKey, baseUrl, fetchImpl })
  const server = new Server({ name: 'sentfromai', version: VERSION }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params
    try {
      const result = await callTool(api, name, req.params.arguments ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (err) {
      // API failures come back as tool results (not protocol errors) so the model
      // can read the status and self-correct — a 401 means the key is wrong, a
      // 402 means the plan limit is reached, a 4xx body says what to fix.
      if (err instanceof ApiError) return { isError: true, content: [{ type: 'text', text: err.message }] }
      throw err
    }
  })

  return server
}
