---
name: player-tendencies
description: Analyze recent player habits, champion choices, role patterns, and performance with honest samples.
capability: always
surfaces: [web, discord, voice]
tripwires:
  - A tendency requires repeated evidence; label small or mixed samples instead of turning them into a rule.
---
## Player tendencies

Resolve the player, inspect coverage, and acquire ranked history when the requested recent sample is missing. Use ScoutQL to bound exactly the newest requested games and report the actual number returned.

Compare meaningful segments: champion, role, side, queue, patch, win/loss, recent half versus earlier half, and common matchup classes when supported. Prefer rates with denominators and totals over isolated averages. Call out stable patterns, recent changes, and contradictions separately.

For opponent scouting, lead with the most actionable repeated patterns: champion pool concentration, role frequency, aggression and deaths, farm/economy, vision, objective involvement, and performance shifts. Never imply the sample represents their entire account history when it only represents the matches Scout obtained.
