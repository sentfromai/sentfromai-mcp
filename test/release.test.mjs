import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parsePack, reconcile, validateDispatch, validateFiles, validatePackage } from '../scripts/release.mjs'

const manifest = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const files = ['package.json', 'README.md', 'LICENSE', 'server.js', 'lib.js', 'lib.d.ts', 'identity-server.js', 'mcp-with-identity.json', 'skills/sentfromai/SKILL.md', 'skills/agent-login/SKILL.md', 'skills/agent-login/ONBOARDING.md', 'skills/agent-login/config.example.json']

test('only beta canonical package with optional identity can be released', () => {
  validatePackage(manifest())
  for (const mutate of [p => { p.version = '0.5.0' }, p => { p.publishConfig.tag = 'latest' }, p => { p.repository.url = 'https://example.com' }, p => { p.peerDependenciesMeta['@agentlogin/mcp'].optional = false }, p => { p.dependencies['@agentlogin/mcp'] = '0.2.0-beta.1' }]) {
    const p = manifest(); mutate(p); assert.throws(() => validatePackage(p))
  }
})

test('publication excludes local state, credentials, unexpected skills and missing companion docs', () => {
  validateFiles(files)
  for (const extra of ['.env', '.npmrc', 'keys.json', 'skills/private/secret.json', '../outside', 'state/cookies.json']) assert.throws(() => validateFiles([...files, extra]))
  assert.throws(() => validateFiles(files.filter(f => !f.endsWith('ONBOARDING.md'))))
  assert.throws(() => validateFiles([...files, 'LICENSE']))
})

test('npm10 and npm12 pack metadata is accepted only for one intended package', () => {
  const p = { name: 'sentfromai-mcp', filename: 'sentfromai-mcp-0.5.0-beta.1.tgz' }
  assert.deepEqual(parsePack(JSON.stringify([p])), p)
  assert.deepEqual(parsePack(JSON.stringify({ [p.name]: p })), p)
  assert.throws(() => parsePack(JSON.stringify([p, p])))
  assert.throws(() => parsePack(JSON.stringify([{ ...p, filename: '../escape.tgz' }])))
})

test('provenance names the workflow commit, never an older checkout', () => {
  validateDispatch('a'.repeat(40), 'a'.repeat(40))
  assert.throws(() => validateDispatch('a'.repeat(40), 'b'.repeat(40)))
  assert.throws(() => validateDispatch('a'.repeat(40), undefined))
})

test('late registry appearance cannot bypass integrity or distribution-tag checks', async () => {
  const p = { name: 'sentfromai-mcp', version: '0.5.0-beta.1', integrity: 'sha512-reviewed' }
  let reads = 0
  const lookup = async () => ++reads === 1 ? null : { dist: { integrity: 'sha512-other' } }
  assert.equal(await reconcile(p, lookup, async () => {}), false)
  await assert.rejects(reconcile(p, lookup, async () => {}), /different bytes/)
  await assert.rejects(reconcile(p, async () => ({ dist: { integrity: p.integrity } }), async () => { throw new Error('tag changed') }), /tag changed/)
})
