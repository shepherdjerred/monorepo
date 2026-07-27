---
id: homekit-secure-video-post-repair-verification
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/superseded/homekit-refresh-followups.md
---

# Verify HKSV after the front-door camera re-pair

The camera was accidentally removed and re-paired on July 9. Apple Home must be
checked directly to confirm recording and person notifications survived the
new pairing.

## Remaining

- [ ] In Apple Home, enable Stream & Allow Recording, Record Any Motion, and
      person notifications for the re-paired front-door camera.
- [ ] Trigger motion at the door and confirm a new clip appears, a person
      notification arrives, and remote live view loads.
- [ ] Record the observation date and settings; do not require pre-repair clip
      history, which may have been reset by pairing.

## Comment Log

### 2026-07-27 — split from HomeKit refresh

- Operator-blocked because Apple Home settings and a physical motion event are
  outside deterministic repository verification.
