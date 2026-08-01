---
id: log-2026-07-29-pr-1810-ci-diagnosis
type: log
status: complete
board: false
---

# PR 1810 CI Diagnosis

## Scope

Diagnose the current-head Buildkite failure on pull request 1810 without changing
code, branches, pull request state, or CI state.

## Session Log — 2026-07-29

### Done

- Confirmed pull request 1810 currently points to
  `45f54c78d639ea5dd907314cff8266e44f862095`.
- Inspected authoritative Buildkite build 7107 and its failed job logs.
- Traced the only hard current-head failure to
  `@homelab/cdk8s#test`: the adaptive-lighting GitHub release archive fetch
  failed with `ConnectionRefused` before the SHA-256 assertion ran.
- Confirmed the review-gate job was waiting normally and was terminated after
  the verify failure; it was fallout rather than an independent current-head
  finding.
- Rechecked the exact archive URL successfully (`302` to `200`) and reran
  `HA_CUSTOM_COMPONENT_TARBALL_TEST=1 bun test packages/homelab/src/cdk8s/src/ha-custom-component-integrity.test.ts`;
  all 9 tests passed, including adaptive-lighting.
- Reviewed earlier builds on the bot-managed branch and found repeated
  1200-second Codex review-provider timeouts on prior heads.

### Remaining

- Retry CI on the unchanged current head if a fresh hosted result is desired.
- Confirm that Codex produces a current-head review; earlier heads repeatedly
  timed out in the review gate.

### Caveats

- No CI retry, code change, PR update, or review-provider mutation was made.
- A successful local rerun demonstrates that the archive and recorded digest
  are currently valid, but it does not replace a green hosted Buildkite run.
