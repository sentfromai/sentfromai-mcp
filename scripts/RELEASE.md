# Beta publication readback

The release workflow publishes the reviewed tarball with the explicit `beta`
tag. Version metadata must match that tarball's integrity. The existing `latest`
tag must remain unchanged, including when it was absent. The exact optional
Agent Login dependencies must already be visible with their tested integrity.

After one successful upload, read-only reconciliation checks version metadata
and the direct distribution-tag endpoint with ten seconds between attempts, for
at most five minutes. A 404 or the exact previous beta tag can remain pending within that
budget. Conflicting bytes, an unexpected tag, malformed metadata or a network
error fail the run immediately. The 15-minute publishing-job cap leaves time
for setup, dependency verification and the upload. Neither limit guarantees
completion.

npm distinguishes [validation from publication](https://api-docs.npmjs.com/#tag/Packages)
and [never permits reuse of a published name/version](https://docs.npmjs.com/cli/v12/commands/npm-publish/).
There is no assumed five-minute npm visibility guarantee. A successful upload
followed by an expired readback is unresolved, not absent. Preserve the original
bundle and reconcile its exact version, integrity and tags before rerunning the
failed publishing job. Never repack, replay an uncertain upload, move a release
tag or overwrite a version to resolve a delay. A resumed job verifies identical
existing bytes and tags before skipping an upload; partial visibility fails its
preflight. Public-registry installation and acceptance tests still follow a
confirmed release.
