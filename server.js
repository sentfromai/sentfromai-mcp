#!/usr/bin/env node
// SentFromAI MCP server — stdio entrypoint (`npx -y sentfromai-mcp`).
// Config via env: SENTFROMAI_API_KEY (required — a tenant bearer token),
// SENTFROMAI_BASE_URL (default https://api.sentfrom.ai).
// The tools live in lib.js so the hosted endpoint can share them.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer, DEFAULT_BASE_URL } from './lib.js'

const BASE_URL = process.env.SENTFROMAI_BASE_URL ?? DEFAULT_BASE_URL
const API_KEY = process.env.SENTFROMAI_API_KEY ?? ''

if (!API_KEY) {
  console.error(
    'sentfromai-mcp: SENTFROMAI_API_KEY is not set.\n' +
      'Get an API key at https://console.sentfrom.ai and set it in the `env` of your MCP config.\n' +
      'Docs: https://docs.sentfrom.ai/guides/mcp',
  )
  process.exit(1)
}

const server = createServer({ apiKey: API_KEY, baseUrl: BASE_URL })
await server.connect(new StdioServerTransport())
