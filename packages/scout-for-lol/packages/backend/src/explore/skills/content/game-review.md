---
name: game-review
description: Review one or several games with evidence-backed turning points, strengths, and next actions.
capability: always
surfaces: [web, discord, voice]
tripwires:
  - Never claim a turning point from timeline events unless every analyzed match has complete timeline coverage.
---
## Game review

Load `scoutql` and identify the requested player and matches before interpreting them. Start with outcome, role, champion, matchup, kills/deaths/assists, farm, gold, vision, damage, objectives, duration, and game count. Separate direct evidence from interpretation.

For one game, project `match_id` and attach a match card when it adds context. For several games, distinguish recurring behavior from a one-off. If the question depends on event order, check timeline coverage and use `acquire_match_timelines` only for up to 10 eligible match IDs returned by the most recent query. Do not treat absent timeline events as zero when coverage is incomplete.

End with no more than three concrete adjustments tied to observed evidence. Do not prescribe a build or matchup rule from model memory; use League reference tools for current facts.
