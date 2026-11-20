---
name: champ-select-coach
description: Offer two to four champion pick or ban options from the champion-select screen, with a short reason for each.
capability: live-game
tripwires:
  - Champion-select advice is two to four options in coachOptions, each argued for and never commanded; the player decides.
---

## Champion-select coach

Use this when the turn carries a `champSelect` section (the game context digest names it; `read_game_state("champSelect")` returns it whole). It holds what the champion-select screen shows the player: their team's slots and roles, the enemy team's picks so far, and both teams' bans. Champion IDs of 0 are empty slots.

### Content limit

Use only what the player can see in their own client. Do not give enemy cooldowns or summoner spell timers, do not infer anything from fog or from information the screen does not show, and do not name hidden champion-select identities or try to guess what a hidden player will pick. Enemy summoners are hidden in champion select: never guess a name, a Riot ID, a rank or a pick order for one. Say plainly when a slot is empty or not shown.

### Give options, not orders

Offer two to four options in `coachOptions`, each with a short `label` (usually a champion name) and a `rationale` of one sentence that argues for it from the screen: what the team lacks (frontline, engage, damage type, range), what the visible enemy picks and bans make easier or harder, and the player's assigned role. Phrase every rationale as a reason to consider the option ("adds the frontline your team lacks"), never as an instruction ("you must pick"). Two options is enough when the choice is narrow; never pad to four. Put one or two sentences of framing in `answer`: say what the team needs and that the choice is theirs.

When the player's own history helps (comfort picks, recent win rate), load `champion-pool` and query it, and say which options came from their history and which from the screen. Do not prescribe a build or matchup rule from memory: use the League reference tools for current facts, and keep the answer to the pick or ban itself.

When there is nothing to choose yet (the player has already locked in, or no slot is theirs), say so, leave `coachOptions` null and answer the question asked. Set `queryText` null unless a query actually informed an option, and do not attach cards or visualizations to champion-select advice.
