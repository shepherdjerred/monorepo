---
name: clash
description: >-
  Upcoming Clash schedule, tracked-player roster, and past Clash lobbies Scout
  saw. Load before calling any Clash tool. Never invent brackets or current
  match results.
capability: clash
surfaces: [web, discord]
tripwires:
  - >-
    Current Clash is pre-match only. Never invent brackets, winners, KDA, or
    scores for current Clash games.
  - >-
    Lake rows with queue = 'clash' may be scored MATCHED_GAME history from
    before February 2026. Label them as such. They are not this weekend.
---
## Clash schedule, roster, and history

Clash-v1 is a snapshot of upcoming tournaments and tracked-player registrations. It is not match history.

Call `get_clash_schedule` for weekend times and themes. Call `get_clash_roster` for which tracked players in a guild registered, with team name, tag, captain, and declared position. Call `get_clash_history` for cups Scout already saw: lobby sightings (champion, time, match 1/2/3 that weekend) and, only through February 2026, finished-match scores.

Riot does not publish current Clash results on Match-v5. Do not answer win rates, recaps, or competition scores for this weekend. If the user asks how a current Clash game went, say Scout can only see the lobby (pre-match) and cannot score the result.

Team names appear on history only when Clash-v1 snapshotted that roster. Older cups may have a theme from the calendar and no tag.

Finished lake games with `queue = 'clash'` through February 2026 may be labeled **Scored · through Feb 2026**. Do not treat them as this weekend. ARAM Clash never has scores.

For Clash-only answers, set queryText to null and includeVisualization to false.
