---
id: stash-hardware-encoding-setting
type: todo
status: planned
board: true
verification: operator
disposition: blocked
source_marker: false
---

# Enable the Stash FFmpeg hardware-encoding setting

## Remaining

- [ ] Sign in to the private Stash UI and enable the persisted
      `FFmpeg hardware encoding` setting. It is application state rather than a
      `config.yml` field, so neither the authentication init container nor the
      GitOps chart can set it.
- [ ] Once the setting is persisted, confirm Stash startup logs report the
      supported hardware codecs.

## Comment Log

- 2026-08-13 — Split out of the Stash Intel GPU acceleration plan. Changing
  persisted application state through an authenticated UI is a privileged
  operator action, so it must not sit on the board as active agent work. The
  deterministic post-deployment checks (GPU limit, `/dev/dri/renderD128`
  readability, and the direct `h264_vaapi` FFmpeg smoke encode) stay
  agent-owned in that plan and do not depend on this setting.
