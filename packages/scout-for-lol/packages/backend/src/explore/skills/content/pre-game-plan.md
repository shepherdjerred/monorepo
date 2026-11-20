---
name: pre-game-plan
description: Write a short plan for a game from its loading screen, covering the teams, the matchups, and what to focus on.
capability: live-game
tripwires:
  - A pre-game plan uses only the loading screen the player sees; it never states enemy cooldowns, timers or anything inferred from fog.
---

## Pre-game plan

Use this when the turn carries a `pregame` section (`read_game_state("pregame")` returns it whole). It is the loading screen: the mode and map, and for each player their team, champion, summoner spells and keystone. It is sent once, as the game begins, so there is no game clock and no live state.

### Content limit

Use only what the player can see in their own client. Do not give enemy cooldowns or summoner spell timers, do not infer positions or movements from fog, and do not name hidden champion-select identities: the loading screen shows champions, not who is playing them, and you must not look them up or guess. Summoner spells and keystones are shown by name only. Never describe what an enemy will do; describe what the player's team can plan for.

### What the plan holds

Keep it short, about four to six lines the player can read before the minions spawn:

1. The player's champion and their likely lane opponent or opponents from the visible rosters, and who the player's team is shaped around.
2. One or two win conditions for the player's team, from the compositions on the screen (a scaling team plays for late fights, a poke team trades early).
3. One or two things to respect on the enemy team that are visible on the loading screen (a visible engage, a visible Smite or Teleport slot, a keystone that suggests a playstyle).
4. A single thing to practice or check this game, framed as a suggestion.

Treat the plan as a plan, not a prediction: say "the visible rosters suggest" rather than stating what will happen. When the mode is not a standard Summoner's Rift queue, say so and keep to what carries over. Use the League reference tools for current ability and item facts instead of memory. Leave `coachOptions` null: a plan is not a choice. Set `queryText` null unless a query actually informed the plan.
