#!/usr/bin/env node
// Optional local identity companion. Mail credentials are provided only through
// protected environment configuration; keys and app sessions remain on this host.
try {
  const { main } = await import('@agentlogin/mcp/cli')
  await main()
} catch {
  console.error('sentfromai identity: install the matching @agentlogin/mcp release and configure AGENTLOGIN_MCP_CONFIG. See the bundled README. No credentials were printed.')
  process.exitCode = 1
}
