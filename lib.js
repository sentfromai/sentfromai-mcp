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
    'Create an email inbox for this tenant and return it (id, address, display_name, created_at). Uses the managed mail.sentfrom.ai domain unless domain_id names one of your verified custom domains. The address is live immediately. Errors: 400 invalid local_part, 402 plan inbox limit reached, 409 address already taken.',
    {
      type: 'object',
      properties: {
        local_part: {
          type: 'string',
          description: 'Part before the @, e.g. "support" or "agent-42". Only a-z, 0-9, dot, underscore and hyphen; normalised to lowercase. Must be unique on the domain.',
        },
        display_name: { type: 'string', description: 'Optional display name shown in the From header, e.g. "Acme Support".' },
        domain_id: {
          type: 'string',
          description: 'Optional id of a verified custom domain (from add_domain / get_domain). Omit to use mail.sentfrom.ai.',
        },
      },
      required: ['local_part'],
    },
    WRITE,
  ),
  tool(
    'list_inboxes',
    'List inboxes',
    'List every inbox in this tenant (id, address, display_name, created_at). Call this before create_inbox to reuse an existing address.',
    NO_ARGS,
    READ,
  ),
  tool(
    'delete_inbox',
    'Delete inbox',
    'Permanently delete an inbox. Its address stops accepting mail immediately; messages already received stay searchable. Cannot be undone. Errors: 404 unknown inbox.',
    {
      type: 'object',
      properties: { inbox_id: { type: 'string', description: 'Id of the inbox to delete (from list_inboxes).' } },
      required: ['inbox_id'],
    },
    DELETE,
  ),
  // ── Messages ─────────────────────────────────────────────────────────────
  tool(
    'send_message',
    'Send email',
    'Send a new email from one of your inboxes and return the created message (id, thread_id, delivery_status). Starts a new thread; to continue a conversation use reply_to_message so threading headers are set. Recipients matching a block rule are refused and addresses that previously bounced are suppressed. Pass client_id to make retries idempotent. Errors: 400 missing fields, 402 plan send limit reached, 413 message over 10 MB, 422 all recipients blocked or suppressed.',
    {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', description: 'Id of the sending inbox (from list_inboxes).' },
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses; at least one.' },
        cc: { type: 'array', items: { type: 'string' }, description: 'Optional CC addresses.' },
        bcc: { type: 'array', items: { type: 'string' }, description: 'Optional BCC addresses (not visible to other recipients).' },
        subject: { type: 'string', description: 'Subject line.' },
        text: { type: 'string', description: 'Plain-text body. Provide text, html, or both.' },
        html: { type: 'string', description: 'Optional HTML body. text is used as the plain-text alternative.' },
        client_id: {
          type: 'string',
          description: 'Optional idempotency key you choose (e.g. a UUID). Resending with the same client_id returns the original message instead of sending again.',
        },
        attachments: {
          type: 'array',
          description: 'Optional file attachments. The whole message must stay under 10 MB once encoded.',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'File name shown to the recipient, e.g. "report.pdf".' },
              content_type: { type: 'string', description: 'MIME type, e.g. "application/pdf". Inferred from filename when omitted.' },
              content_base64: { type: 'string', description: 'File bytes, base64-encoded.' },
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
    'Reply inside an existing thread and return the created message. Sent from the inbox that received the original, to the original sender (or to everyone on the thread with reply_all), with the subject and In-Reply-To/References headers set so mail clients thread it correctly. Block rules and suppression apply. Errors: 404 unknown message, 402 plan send limit reached.',
    {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Id of the message to reply to (from search_messages, get_thread or a webhook event).' },
        text: { type: 'string', description: 'Plain-text body of the reply.' },
        html: { type: 'string', description: 'Optional HTML body of the reply.' },
        reply_all: { type: 'boolean', description: 'Reply to every original recipient (To and CC) instead of only the sender. Default false.' },
        attachments: {
          type: 'array',
          description: 'Optional file attachments, same shape as send_message.',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'File name shown to the recipient.' },
              content_type: { type: 'string', description: 'MIME type; inferred from filename when omitted.' },
              content_base64: { type: 'string', description: 'File bytes, base64-encoded.' },
            },
            required: ['content_base64'],
          },
        },
      },
      required: ['message_id'],
    },
    SEND,
  ),
  tool(
    'forward_message',
    'Forward email',
    'Forward a message to new recipients as a fresh thread, quoting the original and re-attaching its files, and return the created message. Useful for handing a conversation to a human. Errors: 404 unknown message, 402 plan send limit reached.',
    {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Id of the message to forward.' },
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses; at least one.' },
        text: { type: 'string', description: 'Optional note placed above the quoted original.' },
        from_inbox_id: {
          type: 'string',
          description: 'Optional inbox to send from. Defaults to the inbox that received the original.',
        },
        client_id: { type: 'string', description: 'Optional idempotency key; a repeat with the same client_id does not forward twice.' },
      },
      required: ['message_id', 'to'],
    },
    SEND,
  ),
  tool(
    'get_message',
    'Get message',
    'Fetch one message by id: from/to/cc, subject, plain-text and HTML bodies, direction, delivery_status, thread_id, timestamps, and time-limited download URLs for attachments. Errors: 404 unknown message.',
    {
      type: 'object',
      properties: { message_id: { type: 'string', description: 'Id of the message (from search_messages, list_threads/get_thread or a webhook event).' } },
      required: ['message_id'],
    },
    READ,
  ),
  tool(
    'search_messages',
    'Search messages',
    'Search this tenant\'s messages, or list the most recent ones when query is omitted (the way to check for new mail). Returns up to limit message summaries (id, thread_id, direction, from_addr, to_addrs, subject, sent_at/received_at), newest first; use get_message for bodies. mode keyword matches words in subject and body, semantic finds messages by meaning, hybrid combines both.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text. Omit to list the most recent messages.' },
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode. Default keyword.' },
        inbox_id: { type: 'string', description: 'Optional: restrict results to one inbox.' },
        limit: { type: 'number', description: 'Maximum results, 1-100. Default 25.' },
      },
    },
    READ,
  ),
  // ── Threads ──────────────────────────────────────────────────────────────
  tool(
    'list_threads',
    'List threads',
    'List conversation threads, most recently active first: id, subject, participants, message_count, last_message_at. Use get_thread to read the messages of one thread.',
    {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', description: 'Optional: restrict to threads involving one inbox.' },
        limit: { type: 'number', description: 'Maximum threads to return, 1-100. Default 25.' },
      },
    },
    READ,
  ),
  tool(
    'get_thread',
    'Get thread',
    'Fetch a thread with all of its messages in chronological order, bodies included. Errors: 404 unknown thread.',
    {
      type: 'object',
      properties: { thread_id: { type: 'string', description: 'Thread id (from list_threads or a message\'s thread_id).' } },
      required: ['thread_id'],
    },
    READ,
  ),
  // ── Drafts ───────────────────────────────────────────────────────────────
  tool(
    'create_draft',
    'Create draft',
    'Create a draft without sending it and return it (id, status draft or scheduled). Set scheduled_at to have it sent automatically at that time, or send it later with send_draft. With reply_to_message_id the draft becomes a threaded reply: recipients and subject default to the original message. Errors: 404 unknown inbox or message.',
    {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', description: 'Inbox the draft will be sent from.' },
        to: { type: 'array', items: { type: 'string' }, description: 'Recipients. Optional for replies (defaults to the original sender).' },
        cc: { type: 'array', items: { type: 'string' }, description: 'Optional CC addresses.' },
        bcc: { type: 'array', items: { type: 'string' }, description: 'Optional BCC addresses.' },
        subject: { type: 'string', description: 'Subject. Optional for replies (defaults to "Re: <original subject>").' },
        text: { type: 'string', description: 'Plain-text body.' },
        html: { type: 'string', description: 'Optional HTML body.' },
        reply_to_message_id: { type: 'string', description: 'Id of a message this draft replies to; sets threading headers when sent.' },
        scheduled_at: {
          type: 'string',
          description: 'ISO 8601 timestamp in UTC, e.g. "2026-10-01T09:00:00Z". SentFromAI sends the draft automatically at this time.',
        },
      },
      required: ['inbox_id'],
    },
    WRITE,
  ),
  tool(
    'send_draft',
    'Send draft',
    'Send an existing draft now and return the resulting message. Works for drafts in status draft or scheduled; a draft that was already sent cannot be sent again. Errors: 404 unknown draft, 409 already sent.',
    {
      type: 'object',
      properties: { draft_id: { type: 'string', description: 'Id of the draft (from create_draft or list_drafts).' } },
      required: ['draft_id'],
    },
    SEND,
  ),
  tool(
    'list_drafts',
    'List drafts',
    'List this tenant\'s drafts: id, inbox_id, to, subject, status (draft, scheduled, sent) and scheduled_at.',
    NO_ARGS,
    READ,
  ),
  // ── Domains ──────────────────────────────────────────────────────────────
  tool(
    'add_domain',
    'Add sending domain',
    'Register a custom domain for sending and receiving and return it (id, status pending) together with the DNS records to add: DKIM CNAMEs, MX and SPF for the mail-from subdomain, and DMARC. SentFromAI re-checks DNS automatically and marks the domain verified once the records propagate; poll with get_domain. Errors: 400 invalid hostname, 409 already registered.',
    {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'Domain or subdomain you control, e.g. "mail.example.com".' } },
      required: ['hostname'],
    },
    WRITE,
  ),
  tool(
    'get_domain',
    'Get domain status',
    'Get a domain\'s verification status (pending, verified, failed), the DKIM, SPF and DMARC check results, and the exact DNS records still required. Errors: 404 unknown domain.',
    {
      type: 'object',
      properties: { domain_id: { type: 'string', description: 'Id of the domain (from add_domain).' } },
      required: ['domain_id'],
    },
    READ,
  ),
  // ── Webhooks ─────────────────────────────────────────────────────────────
  tool(
    'create_webhook',
    'Create webhook',
    'Register an HTTPS endpoint that receives events as signed JSON POSTs and return it with its signing secret, which is shown only this once. Events: message.received (inbound mail, the default), message.delivered, message.bounced, message.complained, message.rejected. Failed deliveries are retried with backoff.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTPS URL that will receive the POSTed events.' },
        events: {
          type: 'array',
          items: { type: 'string', enum: ['message.received', 'message.delivered', 'message.bounced', 'message.complained', 'message.rejected'] },
          description: 'Event types to subscribe to. Default ["message.received"].',
        },
      },
      required: ['url'],
    },
    WRITE,
  ),
  tool(
    'list_webhooks',
    'List webhooks',
    'List webhook endpoints: id, url, events, created_at. Signing secrets are never returned after creation.',
    NO_ARGS,
    READ,
  ),
  tool(
    'delete_webhook',
    'Delete webhook',
    'Delete a webhook endpoint. Event deliveries to it stop immediately. Cannot be undone. Errors: 404 unknown endpoint.',
    {
      type: 'object',
      properties: { webhook_id: { type: 'string', description: 'Id of the endpoint (from create_webhook or list_webhooks).' } },
      required: ['webhook_id'],
    },
    DELETE,
  ),
  // ── Allow/block lists ────────────────────────────────────────────────────
  tool(
    'add_address_rule',
    'Add allow/block rule',
    'Add a rule for an email address or a whole domain and return it (id, kind, direction, pattern). Block rules are enforced server-side for every inbox in the tenant: matching senders are refused on receive and matching recipients are refused on send. Allow rules are recorded for reference and are not enforced as exceptions. Errors: 400 invalid kind or pattern.',
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['allow', 'block'], description: 'block to refuse mail matching the pattern; allow to record an allow-listed address.' },
        pattern: {
          type: 'string',
          description: 'Full email address ("someone@example.com") or bare domain ("example.com", which matches every address at that domain). Case-insensitive.',
        },
        direction: {
          type: 'string',
          enum: ['inbound', 'outbound', 'both'],
          description: 'Where the rule applies: inbound (receiving), outbound (sending) or both. Default both.',
        },
      },
      required: ['kind', 'pattern'],
    },
    WRITE,
  ),
  tool(
    'list_address_rules',
    'List allow/block rules',
    'List this tenant\'s allow/block rules: id, kind, direction, pattern, created_at.',
    NO_ARGS,
    READ,
  ),
  tool(
    'delete_address_rule',
    'Delete allow/block rule',
    'Delete an allow/block rule by id. Takes effect immediately. Cannot be undone. Errors: 404 unknown rule.',
    {
      type: 'object',
      properties: { rule_id: { type: 'string', description: 'Id of the rule (from add_address_rule or list_address_rules).' } },
      required: ['rule_id'],
    },
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
      return api('POST', '/inboxes', { local_part: a.local_part, display_name: a.display_name, domain_id: a.domain_id })
    case 'list_inboxes':
      return api('GET', '/inboxes')
    case 'delete_inbox':
      return api('DELETE', `/inboxes/${a.inbox_id}`)
    case 'send_message':
      return api('POST', '/messages', {
        inbox_id: a.inbox_id, to: a.to, cc: a.cc, bcc: a.bcc,
        subject: a.subject, text: a.text, html: a.html, attachments: a.attachments, client_id: a.client_id,
      })
    case 'reply_to_message':
      return api('POST', `/messages/${a.message_id}/reply`, {
        text: a.text, html: a.html, reply_all: a.reply_all, attachments: a.attachments,
      })
    case 'forward_message':
      return api('POST', `/messages/${a.message_id}/forward`, {
        to: a.to, text: a.text, from_inbox_id: a.from_inbox_id, client_id: a.client_id,
      })
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
        inbox_id: a.inbox_id, to: a.to, cc: a.cc, bcc: a.bcc, subject: a.subject, text: a.text, html: a.html,
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
