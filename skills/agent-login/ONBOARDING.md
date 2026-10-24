# SentFrom.ai Agent Login beta

This guide is for an invited human and their agent. Email access, Owner approval,
and application access are separate permissions. The Owner completes device
prompts and approves access personally; an agent never activates a human factor.

The launch candidate is `sentfromai-mcp@0.5.0-beta.1` with
`agentlogin@0.2.0-beta.1` and `@agentlogin/mcp@0.2.0-beta.1`. Until the release
operator confirms those exact versions are public, use the checked release
artifacts. A successful local package test is not evidence of publication.

## 1. Claim your mailbox and arrange your invitation

Use the [SentFrom console](https://console.sentfrom.ai) to create an account and
mailbox, or ask your agent to follow the
[mailbox setup guide](https://docs.sentfrom.ai/agent-install.md) and open its private
claim link. Sign in as the human who will own the mailbox. Claiming preserves the
address and messages. An unclaimed mailbox cannot enroll an Agent Login identity.

Arrange beta admission with the operator who invited you. They must associate
your actual account's immutable user ID with your claimed workspace; matching an
email address is insufficient. They also arrange an independent human channel
for first-passkey confirmation. This is a staffed beta, not automatic activation.

Keep the mailbox API key in your MCP host's protected credential settings as
`SENTFROMAI_API_KEY`. Do not send it to the operator or paste it into chat. The
mailbox API key cannot approve an agent key.

## 2. Protect your human account

Open [SentFrom identity](https://identity.sentfrom.ai/identity), then sign in with
the same SentFrom account that owns the claimed mailbox.

1. Select **Register your first passkey** and complete your device's prompt.
2. Open **Details for your enrollment operator**. Through the independently
   verified human channel, compare the Owner ID, enrollment generation, and the
   **entire 64-character passkey fingerprint** with the operator.
3. Confirm that you control the device, PIN or biometric approval, and any passkey
   synchronization or recovery account independently of your agent. Never share
   a PIN, recovery secret, or private key.
4. After the operator confirms activation, select **Check activation**, then
   **Verify with passkey**. Operator activation does not sign you in or approve
   an agent key.

Consider adding a second independently protected passkey while the first works.
Select **Add another passkey** after fresh verification. Losing every factor
requires operator recovery and revokes your existing agent identities.

## 3. Configure the local companion

Install the matching reviewed releases using the package README. Use a maintained
Node.js 22 release or newer that satisfies the packages' runtime requirements.
Copy [config.example.json](config.example.json) into a private location:

- Replace the example handle with your exact mailbox address.
- Replace `stateDirectory` with a new absolute directory owned by you, mode `0700`.
- Save the configuration as a regular file owned by you, mode `0600`.
- The example explicitly allows the SentFrom Agent Workspace application. Keep it
  only if you authorize that target. Add other applications individually after
  reviewing their origins and permitted operations.

Validate the file before enabling the helper:

```sh
/absolute/install/node_modules/.bin/agentlogin-mcp --check-config /absolute/private/agentlogin.json
```

Configure the host's local Agent Login server with that absolute configuration
path and the protected `SENTFROMAI_API_KEY` environment value. The mail server and
Agent Login companion are separate MCP servers. The optional `mcp-with-identity.json`
in the package shows how to enable both. Do not copy another user's keys or state
directory to make a new installation appear enrolled.

## 4. Approve the agent's own new key

Ask the agent to run `agentlogin_inventory`, then `agentlogin_enroll` for the
configured `sentfrom` identity. The helper generates the private signing key
locally and returns a public approval link and fingerprint.

Open that link yourself. Compare the exact address, key name, and full fingerprint
with the request your agent started. This agent-key fingerprint is different from
the human passkey fingerprint in step 2. Verify your passkey if asked, then select
**Approve this key**. Decline unexpected requests.

Return to your agent and tell it you approved. If its polling stopped, it calls
`agentlogin_enroll` again for the same configured identity to resume the saved
request. It must retain its original key and request. Wait for **active**: human
approval alone is not completion; the helper must prove possession of its key.

## 5. Sign in and perform a small test

Ask the agent to sign into the configured `workspace` application with
`agentlogin_sign_in`. Review the displayed destination, scopes, disclosure, terms,
and privacy policy before allowing `agentlogin_review`. If a separate Owner
approval is required, complete it yourself at the displayed trusted identity
portal. An agent's review cannot substitute for human consent.

Use the configured `save_note` and `list_notes` operations to save and read a
non-sensitive test note. Give the write a unique ID; reuse that ID only for an
explicit retry of the same uncertain write. Then run `agentlogin_logout` and
confirm an application request requires sign-in again. The authenticated session
belongs to the helper; it does not sign a separate browser in.

## Pausing, expiry, and recovery

| What expired or stopped | What to do |
| --- | --- |
| Device prompt | Retry the prompt. Each ceremony lasts at most five minutes. |
| Owner verification | Select **Verify and return to your request**, verify your passkey, then explicitly submit the decision. Authority lasts at most five minutes. |
| Helper polling | Stop polling when the tool says to stop. Resume explicitly with `agentlogin_enroll` or `agentlogin_sign_in`, as appropriate. |
| Browser sign-in | Sign in again. Use **Resume saved passkey setup** if offered; prove the same pending passkey to recover its fingerprint. |
| Seven-day activation or enrollment deadline | Start a new setup/request. Returning or signing in never extends that original deadline. |
| All human passkeys lost | Contact your beta operator through the arranged independent channel. Email or mailbox access alone cannot recover Owner authority. |
| Response lost after an approval | Reload the saved approval page and check its result. Do not repeat the decision blindly. |

Setup, pending first-passkey activation, and agent enrollment each have their own
seven-day deadline. The helper also preserves a sign-in intention for seven days;
resuming it starts a fresh protocol transaction and requires fresh disclosure
review. It does not preserve consent for an expired transaction.

Keep the local private state protected. If you lose its agent signing key, revoke
that identity in the human portal and follow the documented reset/re-enrollment
flow; another installation cannot recover it from the mailbox. Application
sessions are controlled by each website and may need separate revocation.
