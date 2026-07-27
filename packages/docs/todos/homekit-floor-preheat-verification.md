---
id: homekit-floor-preheat-verification
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/homekit-refresh-followups.md
---

# Verify the master-bathroom floor preheat schedule

The deployed schedules start preheat at 05:45 on weekdays and 06:45 on
weekends, targeting approximately 40 C by 08:00.

## Remaining

- [ ] Query Home Assistant history for at least one weekday and one weekend run,
      correlating schedule time, floor temperature, target, and any unavailable
      intervals.
- [ ] If the floor misses 40 C by 08:00, adjust only the lead time, deploy, and
      repeat the same observation before changing temperature policy.
- [ ] Record the final lead time and the two successful history windows.

## Comment Log

### 2026-07-27 — split from HomeKit refresh

- Retained as agent-owned production observation because HA history provides a
  deterministic signal without physical user acceptance.
