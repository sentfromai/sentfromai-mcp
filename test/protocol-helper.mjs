import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

// Use the public stdio protocol, without importing a sibling repository's client.
export async function inspectServer(entry, env, { call } = {}) {
  const child = spawn(process.execPath, [entry], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = '', pending = ''
  const results = new Map()
  let resolveDone, rejectDone
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
  const timer = setTimeout(() => rejectDone(new Error('MCP handshake timed out')), 10_000)
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n')
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('error', rejectDone)
  child.on('exit', (code) => { if (!results.has(call ? 3 : 2)) rejectDone(new Error(`MCP exited early (${code})`)) })
  child.stdout.on('data', (chunk) => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
      try {
        const message = JSON.parse(line)
        if (!message.id) continue
        assert.equal(message.error, undefined, 'MCP returned a protocol error')
        results.set(message.id, message.result)
        if (message.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        } else if (message.id === 2 && call) send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: call })
        else resolveDone({ initialized: results.get(1), tools: results.get(2).tools, called: results.get(3), stderr })
      } catch (error) { rejectDone(error) }
    }
  })
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'release-consumer', version: '1.0.0' } } })
  try { return await done } finally { clearTimeout(timer); child.stdin.end(); child.kill(); await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve)) }
}
