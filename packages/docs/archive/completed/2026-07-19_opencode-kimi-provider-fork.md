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
