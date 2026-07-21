---
id: plan-2026-07-19-opencode-kimi-provider-fork
type: plan
status: complete
board: false
---

# OpenCode Kimi Provider Fork

## Goal

Fork `lemon07r/opencode-kimi-full` and align its Kimi subscription provider with
the current Kimi CLI and the live Moonshot Coding API.

## Scope

- Retain the existing OAuth device flow, refresh behavior, and OpenCode auth-store
  integration.
- Remove model-id gating that prevents Kimi-specific request fields from applying
  to the account's other discovered models.
- Align supported effort controls and temperature handling with the live API.
- Add focused regression tests for request rewriting and model discovery.
- Keep the fork usable through a global OpenCode plugin entry.

## Evidence

- The current Kimi CLI discovers and retains all models returned by `/models`.
- The live subscription API exposes `kimi-for-coding`,
  `kimi-for-coding-highspeed`, and `k3` for this account.
- The API requires `temperature` to be exactly `1` when present.
- `k3` accepts `reasoning_effort: max`; the upstream plugin currently clamps it
  to `high`.
- The upstream plugin only injects `prompt_cache_key` and thinking fields when
  the OpenCode model id is `kimi-for-coding`, leaving the other discovered models
  without equivalent request behavior.

## Implementation Direction

1. Fork the plugin under `shepherdjerred` and work on an isolated branch.
2. Audit its current source and test surface against current Kimi CLI behavior.
3. Update model discovery/configuration and request transformations so all models
   under the Kimi OAuth provider receive compatible handling.
4. Verify locally, publish the branch, and replace the local OpenCode plugin
   registration with the fork once it is ready.

## Session Log — 2026-07-19

### Done

- Forked `lemon07r/opencode-kimi-full` as `shepherdjerred/opencode-kimi-full`.
- Pushed `b92ca8a` on `fix/kimi-api-compatibility`.
- Updated the fork to discover and expose every entitled Kimi Coding model,
  preserve `max` effort, add session cache keys to every Kimi model, and force
  explicit temperatures to the API-required value of `1`.
- Aligned the plugin fingerprint and new device-id storage with Kimi Code v0.27.0
  while retaining legacy device ids.
- Switched live and chezmoi-managed OpenCode configuration to the local fork and
  added the K3 `max` effort variant.
- Verified TypeScript checks, syntax build, all 78 unit tests, and OpenCode model
  discovery for K3, K2.7 Coding, and K2.7 Coding Highspeed.

### Remaining

- Open a PR for the fork branch when it is ready for external review.
- Re-run a live chat smoke test after the Kimi subscription quota refreshes.

### Caveats

- A live completion could not be verified because the subscription reports its
  billing-cycle quota is exhausted. Authenticated `/models` discovery succeeds.
- The fork must be periodically rebased against upstream and current Kimi Code
  releases.
