---
id: log-2026-07-19-kimi-provider-contract-tests
type: log
status: complete
board: false
---

# Kimi Provider Contract Tests

## Session Log — 2026-07-19

### Done

- Added offline model-discovery, K3 `max` effort, prompt-cache, temperature, and
  media-capability contract coverage to the fork.
- Fixed the discovered-video metadata path so OpenCode receives
  `capabilities.input.video` and attachment support.
- Added `bun run verify:live-models`, which validates the authenticated model
  catalog without spending completion quota.
- Verified 80 offline tests and the live catalog: K2.7 Coding, K2.7 Coding
  Highspeed, and K3, all with 262144 context and image/video input; K3 exposes
  `low`, `high`, and `max` thinking efforts.

### Remaining

- Re-run a live completion smoke test after the subscription quota refreshes.

### Caveats

- The Kimi subscription quota is exhausted, so automated coverage must be
  deterministic and use recorded API contracts rather than chat completions.
