---
name: clash
description: >-
  Upcoming Clash schedule and which tracked players are registered this
  weekend. Load before calling any Clash tool. Never invent brackets or
  match results.
capability: clash
surfaces: [web, discord]
tripwires:
  - >-
    Current Clash is pre-match only. Never invent brackets, winners, KDA, or
    scores for current Clash games.
  - >-
    Lake rows with queue = 'clash' are stale MATCHED_GAME history from before
    February 2026, not this weekend's games.
---
## Clash schedule and roster

Clash-v1 is a snapshot of upcoming tournaments and tracked-player registrations. It is not match history.

Call `get_clash_schedule` for weekend times and themes. Call `get_clash_roster` for which tracked players in a guild registered, with team name, tag, captain, and declared position.

Riot does not publish current Clash results on Match-v5. Do not answer win rates, recaps, or competition scores for this weekend. If the user asks how a Clash game went, say Scout can only see the lobby (pre-match) and cannot score the result.

Old lake games with `queue = 'clash'` are leftover MATCHED_GAME rows from before February 2026. Do not treat them as this weekend.

For Clash-only answers, set queryText to null and includeVisualization to false.
