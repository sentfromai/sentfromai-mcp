import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { publishAndVerify, lookup, readRegistryTags, preflight, parsePack, reconcile, validateDispatch, validateFiles, validatePackage } from '../scripts/release.mjs'

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


const pendingPackage = {name: 'synthetic-package', version: '0.9.0-beta.2', integrity: 'sha512-reviewed'};
const pendingBaseline = {beta: '0.9.0-beta.1', latest: '0.8.0'};
const visibleVersion = {dist: {integrity: pendingPackage.integrity}};
const visibleTags = {...pendingBaseline, beta: pendingPackage.version};
function fakeReadback({versions = [], tags = [], timeoutMs = 300_000, pollIntervalMs = 10_000} = {}) {
  let clock = 0, uploads = 0, versionReads = 0, tagReads = 0;
  const waits = [];
  return {
    upload: async () => { uploads++; },
    options: {timeoutMs, pollIntervalMs, now: () => clock,
      sleep: async ms => { waits.push(ms); clock += ms; },
      lookup: async () => versions[Math.min(versionReads++, versions.length - 1)],
      lookupTags: async () => tags[Math.min(tagReads++, tags.length - 1)]},
    counts: () => ({clock, uploads, versionReads, tagReads, waits}),
  };
}

test('accepted upload waits for independent version/tag visibility without uploading again', async () => {
  const f = fakeReadback({versions: [null, null, visibleVersion], tags: [pendingBaseline, visibleTags, visibleTags]});
  assert.equal(await publishAndVerify(pendingPackage, pendingBaseline, f.upload, f.options), true);
  assert.deepEqual(f.counts(), {clock: 20_000, uploads: 1, versionReads: 3, tagReads: 3, waits: [10_000, 10_000]});
});

test('visible bytes can wait for the exact old beta or absent tag endpoint, never replace latest', async () => {
  const f = fakeReadback({versions: [visibleVersion], tags: [null, pendingBaseline, visibleTags]});
  assert.equal(await publishAndVerify(pendingPackage, pendingBaseline, f.upload, f.options), true);
  assert.equal(f.counts().uploads, 1);
  assert.equal(f.counts().clock, 20_000);
  const first = fakeReadback({versions: [null, visibleVersion], tags: [null, {beta: pendingPackage.version}]});
  assert.equal(await publishAndVerify(pendingPackage, null, first.upload, first.options), true);
});

test('metadata conflicts and unexpected tag changes fail on their first observation even during 404', async () => {
  for (const [versions, tags, pattern] of [
    [[{dist:{integrity:'sha512-other'}}], [visibleTags], /different bytes/],
    [[null], [{...pendingBaseline, beta:'0.9.0-beta.3'}], /beta dist-tag changed/],
    [[null], [{...pendingBaseline, latest:'0.8.1'}], /latest dist-tag changed/],
    [[null], [{beta:pendingBaseline.beta}], /latest dist-tag changed/],
    [[visibleVersion], [{...visibleTags, latest:pendingPackage.version}], /latest dist-tag changed/],
  ]) {
    const f = fakeReadback({versions, tags});
    await assert.rejects(publishAndVerify(pendingPackage, pendingBaseline, f.upload, f.options), pattern);
    assert.equal(f.counts().uploads, 1); assert.deepEqual(f.counts().waits, []);
  }
  const absentLatest = fakeReadback({versions:[null], tags:[{beta:pendingPackage.version,latest:'0.8.0'}]});
  await assert.rejects(publishAndVerify(pendingPackage, null, absentLatest.upload, absentLatest.options), /latest dist-tag changed/);
});

test('observed expected beta cannot roll back to its previous value while metadata is pending', async () => {
  const f = fakeReadback({versions:[null], tags:[visibleTags,pendingBaseline]});
  await assert.rejects(publishAndVerify(pendingPackage,pendingBaseline,f.upload,f.options), /beta dist-tag changed/);
  assert.deepEqual(f.counts().waits,[10_000]); assert.equal(f.counts().uploads,1);
});

test('five-minute visibility limit stops unresolved with one upload and no extra read', async () => {
  const f = fakeReadback({versions:[null],tags:[pendingBaseline]});
  await assert.rejects(publishAndVerify(pendingPackage,pendingBaseline,f.upload,f.options), /remains unresolved.*reconcile/);
  const result=f.counts();
  assert.equal(result.clock,300_000); assert.equal(result.uploads,1);
  assert.equal(result.versionReads,30); assert.equal(result.tagReads,30);
  assert.equal(result.waits.length,30);
});

test('failed upload and unknown read errors never trigger replay or success', async () => {
  const f = fakeReadback({versions:[visibleVersion],tags:[visibleTags]});
  await assert.rejects(publishAndVerify(pendingPackage,pendingBaseline,async()=>{throw new Error('upload outcome unknown');},f.options), /upload outcome unknown/);
  assert.equal(f.counts().versionReads,0);
  for (const field of ['lookup','lookupTags']) {
    const f = fakeReadback({versions:[visibleVersion],tags:[visibleTags]});
    f.options[field]=async()=>{throw new Error('network outcome unknown');};
    await assert.rejects(publishAndVerify(pendingPackage,pendingBaseline,f.upload,f.options), /network outcome unknown/);
    assert.equal(f.counts().uploads,1); assert.deepEqual(f.counts().waits,[]);
  }
  for (const tags of [undefined,[],42,{beta:7}]) {
    const f=fakeReadback({versions:[visibleVersion],tags:[tags]});
    await assert.rejects(publishAndVerify(pendingPackage,pendingBaseline,f.upload,f.options),/Cannot read dist-tags/);
    assert.deepEqual(f.counts().waits,[]);
  }
});

test('read timeout budget and final expiry include time spent reading metadata bodies', async t => {
  let now=0; const limits=[];
  t.mock.method(AbortSignal,'timeout',ms=>{limits.push(ms);return new AbortController().signal;});
  await assert.rejects(publishAndVerify(pendingPackage,pendingBaseline,async()=>{now=5_000;},{
    timeoutMs:100,now:()=>now,sleep:async()=>assert.fail('must not sleep after expiry'),
    lookup:async()=>{now+=40;return visibleVersion;},
    lookupTags:async()=>{now+=60;return visibleTags;},
  }),/remains unresolved/);
  assert.deepEqual(limits,[100,60]);
});


test('preflight blocks partially visible or malformed publications before an upload', async () => {
  for(const tags of [{beta:pendingPackage.version},{latest:pendingPackage.version}]) await assert.rejects(preflight(pendingPackage,async()=>null,async()=>tags),/pending registry visibility/);
  await assert.rejects(preflight(pendingPackage,async()=>visibleVersion,async()=>null),/Cannot read dist-tags/);
  await assert.rejects(preflight(pendingPackage,async()=>null,async()=>{throw new Error('network unknown');}),/network unknown/);
  assert.deepEqual(await preflight(pendingPackage,async()=>null,async()=>null),{exists:false,tags:null});
});

test('metadata readers refuse redirects, malformed success and non404 lookup errors', async () => {
  for(const value of [null,[],false,42,'missing']) await assert.rejects(lookup(pendingPackage.name,pendingPackage.version,async()=>Response.json(value)),/Registry lookup failed/);
  assert.equal(await lookup(pendingPackage.name,pendingPackage.version,async()=>new Response(null,{status:404})),null);
  const calls=[];
  assert.deepEqual(await readRegistryTags(pendingPackage,async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return Response.json(visibleTags);}),visibleTags);
  assert.deepEqual(calls,['https://registry.npmjs.org/-/package/synthetic-package/dist-tags']);
  for(const value of [null,[],{beta:5},{latest:''}]) await assert.rejects(readRegistryTags(pendingPackage,async()=>Response.json(value)),/Cannot read dist-tags/);
  await assert.rejects(readRegistryTags(pendingPackage,async()=>new Response(null,{status:503})),/Cannot read dist-tags/);
});
