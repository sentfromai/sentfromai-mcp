# SentFrom MCP beta release

`sentfromai-mcp@0.5.0-beta.1` keeps the 21 mail tools as its default. Agent Login is
an explicit optional companion, pinned to `@agentlogin/mcp@0.2.0-beta.1`; enabling
it adds a separate local server. Existing hosted mail configurations remain mail-only.

The monorepo's `packages/mcp` contains the reviewed application code. This public
repository distributes it with host manifests and independent release checks.
Before a release, compare the runtime files, bundled onboarding/skills, optional
peer version and license with that reviewed source. Do not copy private state or
configuration from a working installation. Host release versions must agree with
`x-sentfromai-host-version` (`0.4.1`), not this npm beta version;
the mailbox API credential remains an environment secret, never a manifest value.

## Prepare

Use Node `22.23.4` and npm `12.2.1`. Commit reviewed source before preparing an
artifact. Public Agent Login dependencies must already exist at the exact tested
versions before the final release can be prepared through CI.

```sh
npm ci --ignore-scripts
npm test
npm audit --omit=dev --audit-level=low
npm run release:prepare -- /absolute/path/outside-checkout/sentfrom-beta
npm run release:verify -- /absolute/path/outside-checkout/sentfrom-beta
```

Preparation packs once, checks every file against the reviewed source and exact
allowlist, then installs that tarball into two fresh consumers with new npm caches:

- **Mail only:** the identity peer is absent, all 21 tools work over real stdio,
  API failures are tool errors, and attempting the optional wrapper gives safe guidance.
- **Mail and identity:** exact companion artifacts are installed without workspace
  links. The wrapper validates the bundled private configuration example and exposes
  the nine Agent Login tools. Mail remains a separate server.

Both consumer dependency audits must be clear. These checks use synthetic credentials
and configuration validation/inventory only; they send no email, approve no keys,
and are not a replacement for the live first-customer acceptance procedure.

For a prepublication local rehearsal only, set `AGENTLOGIN_RELEASE_BUNDLE` to the
reviewed reference release directory containing `release.json` and its tarballs.
The helper checks their hashes, versions and names before installation. The final
publish still requires those exact artifacts to exist publicly; a local rehearsal
cannot bypass the upstream-release requirement.

The output is one tarball, `release.json` and `SHA256SUMS`. Retain these exact bytes,
test results, source SHA, consumer dependency-lock hashes, and registry integrity
readbacks. Never repack between approval/testing and publication.

## Publish

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for
repository `sentfromai/sentfromai-mcp`, workflow `npm-beta.yml`, environment `npm-beta`,
allowing direct publication. The existing package can use its own trusted publisher;
it does not inherit the reference repository's publishing permissions.

1. Merge reviewed source to `main`, record its full SHA, and tag that same commit
   `v0.5.0-beta.1`. Never move an existing release tag.
2. Dispatch **Prepare or publish npm beta** from `main` while that SHA is still its
   HEAD. Set the exact version and SHA. `publish=false` only prepares and archives;
   `publish=true` runs the separate publication job after all checks pass.
3. npm provenance uses the workflow dispatch SHA. The checkout, requested SHA and
   tag must match it exactly. An older commit reachable from `main` is insufficient.
4. The publish job installs no project dependencies and runs no package lifecycle
   scripts. It verifies the archived bytes and public companion integrities before
   publishing explicitly to `beta`. It never updates `latest`.
5. Read back version, integrity and distribution tags. Run the public-registry
   install and live onboarding acceptance before announcing the beta.

On an uncertain result, rerun the failed publish job from the same workflow run so
the original SHA and artifact are retained. Every lookup of an existing version
must match its tested integrity and beta tag. A conflicting artifact stops release;
never overwrite or reuse its version. Corrected code requires a new beta version.

Existing Claude marketplace users are pinned to the verified `v0.4.1` Git commit;
the root stable host manifests continue to launch `sentfromai-mcp@0.4.1`. This
prevents a merge to `main` from silently opting existing users into the npm beta.
Beta participants install the exact npm version and explicitly configure its local
server/companion. A future host-directory beta needs its own explicit channel and
acceptance run. Do not promote this beta to a stable upgrade, or describe an installed
companion as a completed human approval or application sign-in. Git source pinning
follows the [Claude marketplace source reference](https://code.claude.com/docs/en/plugins/marketplace-reference#github-plugin-source).
