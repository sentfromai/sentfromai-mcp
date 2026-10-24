import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectServer } from '../test/protocol-helper.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export const registry = 'https://registry.npmjs.org/'
const repository = 'git+https://github.com/sentfromai/sentfromai-mcp.git'
const companionVersion = '0.2.0-beta.1'
const companionNames = ['agentlogin', '@agentlogin/mcp']
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const run = (command, args, cwd = root, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8_000_000, timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'], ...options })
const git = (...args) => run('git', args).trim()
const clean = () => assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Release source must be clean and committed')
const allowed = new Set(['package.json', 'README.md', 'LICENSE', 'server.js', 'lib.js', 'lib.d.ts', 'identity-server.js', 'mcp-with-identity.json', 'skills/sentfromai/SKILL.md', 'skills/agent-login/SKILL.md', 'skills/agent-login/ONBOARDING.md', 'skills/agent-login/config.example.json'])

export function validatePackage(pkg) {
  assert.equal(pkg.name, 'sentfromai-mcp')
  assert.match(pkg.version, /^0\.\d+\.\d+-beta\.[1-9]\d*$/)
  assert.equal(pkg.repository.url, repository)
  assert.equal(pkg.license, 'MIT')
  assert.deepEqual(pkg.publishConfig, { access: 'public', tag: 'beta', registry })
  assert.equal(pkg.peerDependencies['@agentlogin/mcp'], companionVersion)
  assert.deepEqual(pkg.peerDependenciesMeta['@agentlogin/mcp'], { optional: true })
  assert.equal(pkg.dependencies['@agentlogin/mcp'], undefined, 'Identity must remain opt-in')
}

export function parsePack(stdout) {
  const parsed = JSON.parse(stdout)
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed)
  assert.equal(entries.length, 1)
  const item = entries[0]
  assert.equal(item.name, 'sentfromai-mcp')
  assert.equal(basename(item.filename), item.filename)
  return item
}

export function validateFiles(files) {
  assert.deepEqual([...new Set(files)].sort(), [...allowed].sort(), 'Only the reviewed mail and optional identity files may be published')
  assert.equal(new Set(files).size, files.length)
}

function inspect(path, pkg) {
  const entries = run('tar', ['-tzf', path]).trim().split('\n')
  assert.ok(entries.every((entry) => entry.startsWith('package/')))
  const files = entries.map((entry) => entry.slice(8)).sort()
  validateFiles(files)
  assert.ok(run('tar', ['-tvzf', path]).trim().split('\n').every((line) => line.startsWith('-')), 'No archive links or special files')
  assert.deepEqual(JSON.parse(run('tar', ['-xOzf', path, 'package/package.json'])), pkg)
  for (const file of files) {
    const contents = run('tar', ['-xOzf', path, `package/${file}`])
    assert.equal(contents, readFileSync(join(root, file), 'utf8'), `Packed ${file} must match reviewed source`)
    assert.doesNotMatch(contents, /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\bnpm_[A-Za-z0-9]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}/, `Credential-like material in ${file}`)
  }
  return files
}

async function lookup(name, version) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return null
  assert.equal(response.status, 200, `Registry lookup failed for ${name}`)
  return response.json()
}

async function companions() {
  const bundle = process.env.AGENTLOGIN_RELEASE_BUNDLE
  if (bundle) {
    assert.ok(isAbsolute(bundle))
    const release = read(join(bundle, 'release.json'))
    assert.equal(release.version, companionVersion)
    return companionNames.map((name) => {
      const p = release.packages.find((p) => p.name === name)
      assert.ok(p)
      assert.equal(p.version, companionVersion)
      assert.equal(basename(p.filename), p.filename)
      const path = join(bundle, p.filename)
      assert.equal(hash(readFileSync(path)), p.sha256)
      assert.equal(`sha512-${hash(readFileSync(path), 'sha512', 'base64')}`, p.integrity)
      return { name, version: companionVersion, integrity: p.integrity, install: path, source: 'reviewed-local-artifact' }
    })
  }
  return Promise.all(companionNames.map(async (name) => {
    const record = await lookup(name, companionVersion)
    assert.ok(record, `Publish and verify ${name}@${companionVersion} before preparing the registry release`)
    assert.match(record.dist.integrity, /^sha512-/)
    return { name, version: companionVersion, integrity: record.dist.integrity, install: `${name}@${companionVersion}`, source: 'npm-registry' }
  }))
}

async function consumer(tarball, peers, withIdentity) {
  const dir = mkdtempSync(join(tmpdir(), 'sentfrom-beta-consumer-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sentfrom-beta-consumer', private: true, type: 'module', version: '0.0.0' }))
    run('npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(dir, 'cache'), '--registry', registry, tarball, ...(withIdentity ? peers.map((p) => p.install) : [])], dir)
    const installed = join(dir, 'node_modules/sentfromai-mcp')
    assert.ok(!lstatSync(installed).isSymbolicLink())
    const pkg = read(join(installed, 'package.json'))
    const mail = await inspectServer(join(installed, 'server.js'), { SENTFROMAI_API_KEY: 'synthetic-test-credential', SENTFROMAI_BASE_URL: 'http://127.0.0.1:9' }, { call: { name: 'list_inboxes', arguments: {} } })
    assert.equal(mail.initialized.serverInfo.version, pkg.version)
    assert.equal(mail.tools.length, 21)
    assert.equal(mail.called.isError, true)
    assert.doesNotMatch(JSON.stringify(mail), /synthetic-test-credential/)
    const lock = read(join(dir, 'package-lock.json'))
    if (withIdentity) {
      for (const peer of peers) {
        assert.equal(lock.packages[`node_modules/${peer.name}`].integrity, peer.integrity)
        assert.equal(read(join(dir, 'node_modules', peer.name, 'package.json')).version, peer.version)
        assert.ok(!lstatSync(join(dir, 'node_modules', peer.name)).isSymbolicLink())
      }
      const config = read(join(installed, 'skills/agent-login/config.example.json'))
      config.stateDirectory = join(dir, 'private')
      mkdirSync(config.stateDirectory, { mode: 0o700 })
      const configFile = join(dir, 'agentlogin.json')
      writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 })
      assert.match(run(process.execPath, [join(installed, 'identity-server.js'), '--check-config', configFile], dir), /Configuration valid/)
      const identity = await inspectServer(join(installed, 'identity-server.js'), { AGENTLOGIN_MCP_CONFIG: configFile }, { call: { name: 'agentlogin_inventory', arguments: {} } })
      assert.equal(identity.initialized.serverInfo.version, companionVersion)
      assert.equal(identity.tools.length, 9)
      assert.match(JSON.stringify(identity.called), /your-agent@mail.sentfrom.ai/)
      assert.doesNotMatch(JSON.stringify(identity.called), /privateJwk|polling_token/)
    } else {
      assert.equal(existsSync(join(dir, 'node_modules/@agentlogin/mcp')), false, 'Mail install must not install the optional identity peer')
      const missing = spawnSync(process.execPath, [join(installed, 'identity-server.js')], { cwd: dir, env: { PATH: process.env.PATH, SECRET_CANARY: 'must-not-print' }, encoding: 'utf8' })
      assert.equal(missing.status, 1)
      assert.match(missing.stderr, /install the matching @agentlogin\/mcp/)
      assert.doesNotMatch(missing.stderr, /must-not-print|ERR_MODULE_NOT_FOUND|stack/)
      assert.equal(missing.stdout, '')
    }
    const audit = JSON.parse(run('npm', ['audit', '--omit=dev', '--json', '--registry', registry, '--cache', join(dir, 'cache')], dir))
    assert.equal(audit.metadata.vulnerabilities.total, 0)
    return { mode: withIdentity ? 'mail-and-identity' : 'mail-only', mailTools: 21, identityTools: withIdentity ? 9 : 0, workspaceLinks: false, dependencyLockSha256: hash(readFileSync(join(dir, 'package-lock.json'))), reportedVulnerabilities: 0 }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

export function validateDispatch(commit, githubSha) {
  assert.match(commit, /^[0-9a-f]{40}$/)
  assert.equal(commit, githubSha, 'npm provenance must identify the actual workflow dispatch SHA')
}

export async function reconcile(pkg, fetchVersion = lookup, checkTags = async (p) => {
  const response = await fetch(`${registry}${p.name}`, { signal: AbortSignal.timeout(15_000) })
  assert.equal(response.status, 200)
  const metadata = await response.json()
  assert.equal(metadata['dist-tags']?.beta, p.version)
  assert.notEqual(metadata['dist-tags']?.latest, p.version)
}) {
  const existing = await fetchVersion(pkg.name, pkg.version)
  if (!existing) return false
  assert.equal(existing.dist?.integrity, pkg.integrity, 'Published version has different bytes')
  await checkTags(pkg)
  return true
}

async function prepare(out) {
  clean()
  assert.ok(relative(root, out).startsWith('..'), 'Output must be outside the checkout')
  assert.ok(!existsSync(out), 'Do not overwrite an artifact directory')
  const pkg = read(join(root, 'package.json')); validatePackage(pkg)
  const sourceCommit = git('rev-parse', 'HEAD')
  const peers = await companions()
  mkdirSync(out, { recursive: true })
  const packed = parsePack(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out]))
  const path = join(out, packed.filename)
  const files = inspect(path, pkg)
  const bytes = readFileSync(path)
  const integrity = `sha512-${hash(bytes, 'sha512', 'base64')}`
  assert.equal(packed.integrity, integrity)
  const consumers = [await consumer(path, peers, false), await consumer(path, peers, true)]
  clean(); assert.equal(git('rev-parse', 'HEAD'), sourceCommit)
  const manifest = { schemaVersion: 1, name: pkg.name, version: pkg.version, distTag: 'beta', registry, repository, sourceCommit, filename: packed.filename, sha256: hash(bytes), integrity, files, node: process.version, npm: run('npm', ['--version']).trim(), sourceLockSha256: hash(readFileSync(join(root, 'package-lock.json'))), companions: peers.map(({ install, ...p }) => p), consumers }
  writeFileSync(join(out, 'release.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(out, 'SHA256SUMS'), `${manifest.sha256}  ${manifest.filename}\n${hash(readFileSync(join(out, 'release.json')))}  release.json\n`)
  console.log(JSON.stringify({ prepared: out, sourceCommit, version: pkg.version, consumers }, null, 2))
}

function verify(out) {
  clean()
  const p = read(join(out, 'release.json')); const pkg = read(join(root, 'package.json')); validatePackage(pkg)
  assert.equal(p.schemaVersion, 1); assert.equal(p.name, pkg.name); assert.equal(p.version, pkg.version)
  assert.equal(p.repository, repository); assert.equal(p.registry, registry); assert.equal(p.distTag, 'beta')
  assert.equal(p.sourceCommit, git('rev-parse', 'HEAD'))
  assert.equal(p.sourceLockSha256, hash(readFileSync(join(root, 'package-lock.json'))))
  assert.equal(basename(p.filename), p.filename)
  assert.deepEqual(readdirSync(out).sort(), [p.filename, 'SHA256SUMS', 'release.json'].sort())
  const path = join(out, p.filename)
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink())
  assert.equal(hash(readFileSync(path)), p.sha256)
  assert.equal(`sha512-${hash(readFileSync(path), 'sha512', 'base64')}`, p.integrity)
  assert.deepEqual(inspect(path, pkg), p.files)
  assert.equal(readFileSync(join(out, 'SHA256SUMS'), 'utf8'), `${p.sha256}  ${p.filename}\n${hash(readFileSync(join(out, 'release.json')))}  release.json\n`)
  assert.deepEqual(p.companions.map((p) => p.name), companionNames)
  assert.ok(p.companions.every((p) => p.version === companionVersion && /^sha512-/.test(p.integrity)))
  return p
}

async function publish(out) {
  const p = verify(out)
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.GITHUB_REPOSITORY, 'sentfromai/sentfromai-mcp')
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
  assert.equal(process.env.RELEASE_VERSION, p.version); assert.equal(process.env.RELEASE_COMMIT, p.sourceCommit)
  validateDispatch(p.sourceCommit, process.env.GITHUB_SHA)
  assert.equal(git('rev-parse', `refs/tags/v${p.version}^{commit}`), p.sourceCommit)
  git('merge-base', '--is-ancestor', p.sourceCommit, 'origin/main')
  // A local companion rehearsal cannot silently become an unverified registry release.
  for (const peer of p.companions) {
    const publicPackage = await lookup(peer.name, peer.version)
    assert.equal(publicPackage?.dist?.integrity, peer.integrity, `Publish the exact tested ${peer.name} first`)
  }
  if (!await reconcile(p)) {
    // Recheck immediately before publishing; a concurrent appearance still needs exact integrity.
    if (!await reconcile(p)) run('npm', ['publish', join(out, p.filename), '--ignore-scripts', '--access', 'public', '--tag', 'beta', '--provenance', '--registry', registry], root, { stdio: 'inherit' })
  }
  assert.ok(await reconcile(p), 'Publication must be confirmed by immutable bytes and tags')
  console.log(`Verified published ${p.name}@${p.version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, out, ...rest] = process.argv.slice(2)
    assert.ok(out && isAbsolute(out) && rest.length === 0, 'Usage: node scripts/release.mjs prepare|verify|publish /absolute/bundle')
    if (command === 'prepare') await prepare(out)
    else if (command === 'verify') { const p = verify(out); console.log(`Verified ${p.name}@${p.version}`) }
    else if (command === 'publish') await publish(out)
    else throw new Error('Unknown release command')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
