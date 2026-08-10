---
id: quotabar-live-acceptance
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
source_marker: false
---

# QuotaBar live provider acceptance

Fixture tests and an installed-app smoke test verify that all four authenticated
provider surfaces currently return validated snapshots, but production
correctness still requires comparing the rendered values and reset times with
each provider's own usage screen.

## Human Verification

- [ ] Launch QuotaBar with the configured Claude Code account and compare the
      5-hour, weekly, and any model-scoped windows plus reset times.
- [ ] Compare Codex's returned windows and reset times with the Codex Usage
      page, including any non-five-hour window.
- [ ] Using the discovered Kimi/OpenCode OAuth credential, compare Kimi's
      5-hour, weekly, monthly/shared-credit windows plus reset times.
- [ ] Using the discovered Grok/OpenCode OAuth credential, compare the shared
      weekly pool, product breakdown, extra credits, and reset time.

This cannot be closed by source compilation or fixture tests. All four
credential sources are now discoverable, but the private subscription
endpoints may change independently of this repository and their displayed
values still need human comparison.

## Comment Log

- 2026-08-09 — Claude and Codex authenticated responses returned HTTP 200 during
  implementation; token values were not printed. Kimi Code and Grok credentials
  were unavailable for live comparison.
- 2026-08-09 — QuotaBar now discovers Kimi and Grok through typed, read-only
  OpenCode OAuth entries. Automated fixtures and bundle checks pass; live Usage
  page comparison remains pending for all four providers.
- 2026-08-09 — The installed release bundle fetched current Claude, Codex, Kimi,
  and Grok snapshots without exposing tokens. Claude included Fable and the
  provider-defined Nimbus Quill quota, Codex included one expiring reset, and
  Kimi/Grok used OpenCode-owned credentials. Usage-page comparison remains a
  human acceptance step.
