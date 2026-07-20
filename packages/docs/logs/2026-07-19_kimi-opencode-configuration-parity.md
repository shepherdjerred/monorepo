---
id: log-2026-07-19-kimi-opencode-configuration-parity
type: log
status: complete
board: false
---

# Kimi OpenCode Configuration Parity

## Session Log — 2026-07-19

### Done

- Compared OpenCode configuration with current Kimi Code's managed model
  configuration and the authenticated `/models` response.
- Matched all model names, video input, always-thinking configuration, and
  K3-only advertised effort variants in both live and chezmoi-managed config.
- Disabled the temperature control for all Kimi models; the API accepts only
  `temperature: 1` and the provider still enforces it on the wire.
- Updated the plugin's generated configuration to derive effort variants solely
  from server-advertised `think_efforts` data.
- Made `verify:live-models` refresh expired OAuth credentials through the same
  lock-protected flow as the plugin.
- Verified 80 offline tests, live model discovery, and OpenCode model loading.
- Ran live OpenCode completions successfully through K3 and K2.7 Coding.
- Kept K2.7 Coding Highspeed visible because `/models` advertises it, matching
  Kimi CLI catalog behavior, despite the current subscription rejecting chat
  requests for that model.
- Switched OpenCode from the feature worktree to the fork's primary checkout,
  `~/git/opencode-kimi-full`, so future pulls on the default `master` branch are
  used directly.

### Remaining

- Re-run a live completion smoke test after the subscription quota refreshes.

### Caveats

- The API reports `supports_thinking_type: "only"` for every currently entitled
  model. OpenCode does not expose a separate always-thinking capability, so the
  provider represents it with `reasoning: true` and no off/auto variants.
- Highspeed availability is inconsistent between `/models` and chat completion
  entitlement checks. It remains listed intentionally for Kimi CLI parity.
