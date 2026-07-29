---
id: streambot-live-4014-e2e-permission
type: todo
status: planned
board: true
verification: agent
disposition: blocked
origin: packages/docs/plans/2026-07-28_streambot-eof-and-voice-recovery.md
source_marker: false
---

# Provision Streambot test-guild permission for live 4014 verification

The Streambot recovery harness at
`packages/streambot/e2e/voice-recovery.ts` can generate a real Discord voice
close code `4014` by having a moderator disconnect the streaming userbot. The
Streambot command bot and the current default test user identity both receive
Discord API error `50013 Missing Permissions` for that action.

## Remaining

- [ ] Grant **Move Members** in the dedicated Streambot test guild to a
      test-only identity; do not broaden production permissions.
- [ ] Supply that identity through `E2E_MODERATOR_USER_TOKEN` and run
      `bun run e2e:voice-recovery` with the documented test-guild environment.
- [ ] Confirm the run observes close code `4014`, remains disconnected beyond
      the reconnect delay, and records exactly two userbot acquisitions.
- [ ] Attach the Discord evidence to PR #1778 and archive this TODO.

## Comment Log

### 2026-07-28 — acceptance test blocked

- The live natural-EOF phase passed.
- Both available test identities returned `403 / 50013 Missing Permissions`
  when attempting to disconnect `glidiot_`.
- Deterministic unit coverage for direct and gateway-first late `4014`
  classification remains green.
