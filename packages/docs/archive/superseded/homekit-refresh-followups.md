---
id: homekit-refresh-followups
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-09_ha-registry-cleanup.md
source_marker: false
---

# HomeKit great-refresh follow-ups (2026-07-09)

The refresh itself shipped and verified (71 accessories / 12 canonical rooms /
zero unreachable — see the plan and the original investigation).
These are the deliberate leftovers.

## Split Records

- `homekit-secure-video-post-repair-verification`
- `homekit-lock-hardening`
- `homekit-device-room-renames`
- `homekit-floor-preheat-verification`
- `home-assistant-kumo-humidity-recovery`
- `hkctl-rebuild-promotion`

The Litter-Robot installation and econet reauthentication remain in their
existing dedicated records. The unexplained July 9 restart has not recurred and
has no current action; a recurrence should produce a new evidence-based
incident rather than an indefinite watch task.

## Comment Log

### 2026-07-27 — in-progress board audit

- Archived the mixed agent/operator/tooling umbrella after moving every current
  action to a narrow record with one verification owner.
