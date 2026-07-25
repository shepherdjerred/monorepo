---
id: plan-2026-06-13-gmail-mcp-server-swap
type: plan
status: planned
board: true
verification: agent
disposition: active
---

# Plan: replace the Gmail MCP server (mcp-gateway)

## Problem

`gmail` in the mcp-gateway hangs on MCP `initialize` in-cluster, so it never registers tools. It's currently kept non-fatal (`panicIfInvalid: false`) so it doesn't crashloop the gateway.

Ruled out (verified 2026-06-13):

| Check                                                           | Result           |
| --------------------------------------------------------------- | ---------------- |
| IMAP egress from cluster (`imap.gmail.com:993`)                 | open             |
| App-password IMAP login (`imaplib`, `shepherdjerred@gmail.com`) | OK, 12 mailboxes |
| `GMAIL_TOKEN` secret key present                                | yes              |

So it's the `@automatearmy/email-reader-mcp@1.0.3` server itself, not creds/network/config.

## Approach

1. **Diagnose first (cheap).** Run the server standalone with the real creds and a timeout to capture its stderr (tbxark hides subprocess output):
   - `kubectl run gmail-mcp-debug --rm -it --image=node:24-slim --env USER_EMAIL=… --env USER_PASS=… -- sh -c 'timeout 40 npx -y @automatearmy/email-reader-mcp; echo EXIT=$?'` (set a PodSecurity-compliant securityContext, or run locally with the same env). See where it blocks (IMAP handshake? waiting on stdin? missing env like IMAP host/port?).
   - If it's a one-line fix (extra env var / newer version), keep it and flip `panicIfInvalid` back to `true`.
2. **Else swap the server.** Google has no official MCP. Evaluate (read-only first):
   - A maintained IMAP-based MCP (same creds model — least migration).
   - A Gmail-API/OAuth server (e.g. `GongRzhe/Gmail-MCP-Server`): more setup (OAuth client + refresh token in 1Password) but no IMAP, richer tools. Heavier.
   - Pin the chosen package in `versions.ts` (`datasource=npm`), wire it in `config.json` like the others.
3. **Verify** in the gateway logs: `<gmail> Successfully listed N tools`; then set `gmail` back to `panicIfInvalid: true` (default) so it's no longer the silent exception.

## Acceptance

- gmail server registers tools through the gateway (not stuck at `Connecting`).
- `panicIfInvalid` removed/true for gmail.
- Credential model documented; any new secret in the `mcp-gateway-credentials` 1Password item.

## Notes

- Keep it read-only unless there's a reason to grant send — the other servers (fastmail/github) already cover writes.

## Remaining

- [ ] Complete and verify the work described in `Plan: replace the Gmail MCP server (mcp-gateway)`.
