---
id: log-2026-07-19-opencode-usage-visibility
type: log
status: complete
board: false
---

# OpenCode Usage Visibility

Evaluated subscription quota and local token/cost visibility for the configured OpenAI Codex and Kimi Code OAuth providers.

## Session Log — 2026-07-19

### Done

- Confirmed `opencode stats --days 7 --models 10` reports local token usage by Codex and Kimi model; subscription requests currently show `$0.00` because OpenCode has no metered API charge for these OAuth routes.
- Confirmed `@slkiser/opencode-quota@3.11.2` can read the current OpenAI OAuth credential and report the Codex Pro weekly quota; the live check reported 71% remaining.
- Confirmed the quota plugin provides `/quota`, `/quota_status`, `/tokens_*`, a sidebar panel, and an optional compact TUI status line.
- Confirmed the installed `opencode-kimi-full@1.4.0` plugin already provides `/kimi:usage` for Kimi weekly and rolling-window limits.
- Identified that `@slkiser/opencode-quota@3.11.2` does not recognize the Kimi bridge's `kimi-for-coding-oauth` credential because its Kimi adapter currently supports API-key auth under canonical Kimi provider IDs only.

### Remaining

- Install and configure `@slkiser/opencode-quota` if unified Codex quota and token/cost TUI surfaces are desired.
- Add OAuth support for `kimi-for-coding-oauth` to the quota plugin if Kimi must appear in the same compact status line and sidebar rather than through `/kimi:usage`.

### Caveats

- Token-based cost is an API-price equivalent, not an actual subscription bill. The current OAuth sessions correctly report no API spend.
- OpenCode upstream PR `anomalyco/opencode#9545` proposes native OAuth quota tracking for OpenAI and other providers, but it is still open and does not include Kimi.
