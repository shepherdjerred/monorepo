---
name: champion-pool
description: Evaluate champion-pool depth, role coverage, comfort picks, and practical gaps from match evidence.
capability: always
surfaces: [web, discord, voice]
tripwires:
  - Champion mastery is familiarity evidence, not proof of recent form or skill.
---
## Champion pool analysis

Use ScoutQL for games, recency, roles, win rate, pick rate, and performance. Use `get_champion_mastery` only as a separate familiarity signal. Keep recent form, historical comfort, and mastery distinct.

Identify core picks, credible backups, role coverage, overlapping strengths, and sample gaps. Compare enough games to avoid promoting a one-game result. When recommending what to practice or ban, tie each recommendation to observed pool concentration or matchup evidence, and verify current champion or item facts with the League reference tools.
