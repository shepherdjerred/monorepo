---
id: bazarr-whisper-model-configuration
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/2026-06-27_bazarr-subtitles-chinese-gating.md
source_marker: false
---

# Configure Bazarr Whisper model explicitly

The Whisper endpoint correction is documented, but model-selection environment
configuration remains absent from the homelab source of truth.

## Remaining

- [ ] Confirm the current Bazarr/Whisper image's supported model setting and resource requirements from pinned-version documentation.
- [ ] Add the explicit model configuration to cdk8s/secret inputs without embedding credentials.
- [ ] Add synth validation that the expected setting reaches the workload.
- [ ] Run homelab synth, tests, lint, and affected repository verification.
- [ ] Verify one authorized subtitle generation job reports the configured model.

## Comment Log

- 2026-07-27 — Split from the mixed Chinese-subtitle plan because this is a
  deterministic repository configuration change. Board audit verified the
  endpoint is corrected but model configuration is still absent.
