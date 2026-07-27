---
id: litter-robot-sonoff-installation
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/todos/litter-robot-sonoff.md
source_marker: false
---

# Install and approve Litter-Robot power recovery

## Remaining

- [ ] Physically install and pair the spare Sonoff S31 at the Litter-Robot,
      name it `Litter-Robot`, and confirm Home Assistant discovers it.
- [ ] Place the entity in Laundry and verify a supervised off/on cycle restores
      the robot without losing connectivity.
- [ ] Decide whether bounded automatic recovery is approved; after deployment,
      run one supervised canary and confirm notifications and the daily guard.

## Comment Log

- 2026-07-27 — Split from the repository automation card because mains-power
  installation, physical testing, and automation approval are operator work.
