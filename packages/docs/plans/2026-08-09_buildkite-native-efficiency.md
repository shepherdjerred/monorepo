---
id: 2026-08-09-buildkite-native-efficiency
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Buildkite native-efficiency fixes

Move main-branch selection into a dependency-aware dynamic pipeline while
keeping PR `if_changed` behavior unchanged. Add explicit timeouts, precise
selector fallback behavior, and size-aware Buildkite handoffs.

The implementation preserves Qodo review gating, the separate OpenTofu and
Scout release phases, and the existing Matomo/Discord tracker commands until
their separately planned removal.

## Remaining

- [ ] Confirm the fixed selector completes Buildkite CI and current-head review
      on PR #2079.
