import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { callTool, createApi, TOOLS, VERSION } from '../lib.js'
import { inspectServer } from './protocol-helper.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)))
const pkg = read('package.json')

test('host release versions agree and default configurations remain mail-only', () => {
  assert.equal(VERSION, pkg.version)
  const hostVersion = pkg['x-sentfromai-host-version']
  assert.equal(hostVersion, '0.4.1')
  assert.equal(pkg.peerDependencies['@agentlogin/mcp'], '0.2.0-beta.1')
  assert.equal(pkg.peerDependenciesMeta['@agentlogin/mcp'].optional, true)
  for (const file of ['server.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini-extension.json']) assert.equal(read(file).version, hostVersion)
  assert.equal(read('server.json').packages[0].version, hostVersion)
  const stable = read('.claude-plugin/marketplace.json').plugins[0]
  assert.equal(stable.version, hostVersion)
  assert.deepEqual(stable.source, { source: 'github', repo: 'sentfromai/sentfromai-mcp', sha: '526ce6116ca51c7f1ab9fe7e374f045b4217a762' })
  for (const file of ['mcp.json', 'mcp-config.json', 'gemini-extension.json']) assert.deepEqual(Object.keys(read(file).mcpServers), ['sentfromai'])
  assert.deepEqual(Object.keys(read('mcp-with-identity.json').mcpServers), ['sentfromai', 'agentlogin'])
  assert.equal(read('.claude-plugin/plugin.json').userConfig.identity_config.required, false)
  assert.ok(read('mcp-config.json').mcpServers.sentfromai.args.includes(`sentfromai-mcp@${hostVersion}`))
  assert.ok(read('gemini-extension.json').mcpServers.sentfromai.args.includes(`sentfromai-mcp@${hostVersion}`))
})

test('real mail stdio handshake exposes only the 21 annotated mail tools and reports API failure', async () => {
  const result = await inspectServer(`${root}/server.js`, { SENTFROMAI_API_KEY: 'synthetic-not-a-real-key', SENTFROMAI_BASE_URL: 'http://127.0.0.1:9' }, { call: { name: 'list_inboxes', arguments: {} } })
  assert.equal(result.initialized.serverInfo.version, pkg.version)
  assert.equal(result.tools.length, 21)
  assert.ok(result.tools.every((tool) => tool.title && tool.annotations && typeof tool.annotations.readOnlyHint === 'boolean' && tool.inputSchema))
  assert.ok(result.tools.every((tool) => !tool.name.startsWith('agentlogin_')))
  assert.equal(result.called.isError, true)
  assert.doesNotMatch(JSON.stringify(result), /synthetic-not-a-real-key/)
})

test('mail tools preserve REST calls, encoding and send annotations', async () => {
  const calls = []
  const api = createApi({ apiKey: 'synthetic-key', fetchImpl: async (url, options) => { calls.push({ url, ...options }); return new Response('{"ok":true}', { status: 200 }) } })
  await callTool(api, 'search_messages', { query: 'subject:a&owner=b', inbox_id: 'inbox', limit: 5 })
  assert.equal(new URL(calls[0].url).searchParams.get('query'), 'subject:a&owner=b')
  assert.equal(calls[0].headers.authorization, 'Bearer synthetic-key')
  assert.equal(calls[0].headers['user-agent'], `sentfromai-mcp/${pkg.version}`)
  await callTool(api, 'send_message', { inbox_id: 'inbox', to: ['recipient@example.com'], text: 'test', client_id: 'replay-id' })
  assert.equal(calls[1].method, 'POST')
  assert.equal(JSON.parse(calls[1].body).client_id, 'replay-id')
  assert.equal(TOOLS.find((tool) => tool.name === 'send_message').annotations.openWorldHint, true)
  assert.equal(TOOLS.find((tool) => tool.name === 'send_message').annotations.idempotentHint, false)
})

test('missing mail credential fails without printing unrelated environment secrets', () => {
  const result = spawnSync(process.execPath, [`${root}/server.js`], { env: { PATH: process.env.PATH, SECRET_CANARY: 'do-not-print-test-secret' }, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /SENTFROMAI_API_KEY/)
  assert.equal(result.stdout, '')
  assert.doesNotMatch(result.stderr, /do-not-print-test-secret/)
})
