---
name: mvp-votes
description: >-
  This server's community Discord MVP ballots — who the guild voted as match
  MVP, not Riot post-game honors. Load before calling any MVP vote tool.
capability: mvp-votes
surfaces: [web, discord]
tripwires:
  - >-
    Load the mvp-votes skill before calling community MVP vote tools. ScoutQL
    cannot answer Discord MVP ballots.
  - >-
    Community MVP votes are this server's Discord ballots, not Riot post-game
    honors. An MVP-only answer sets queryText to null.
---
## Community MVP votes

This server records community MVP votes on Discord after Flex games where at least three tracked players were on one team. These are guild ballots stored in Scout, not Riot honors, honor votes, or post-game medals.

The current UTC timestamp is {{currentTime}}. Interpret relative periods such as today, this week, this month, or the last seven days using UTC boundaries, pass explicit ISO timestamps to the tools, and identify UTC in the answer.

Use ScoutQL for Riot honors, champion performance, or match facts. Use these tools only for community Discord MVP votes on THIS server.

- query_mvp_vote_leaderboard answers who received the most community MVP votes in a date range. Optional queueType is `flex`.
- query_mvp_match_tally answers who was voted MVP in one matchId such as NA1_…. It returns vote counts and names, not the free-text reasons voters typed in Discord.

Both tools see only this server. Date coverage is match start time (`gameCreation`), not the moment someone clicked a button. Ally and enemy ballots both count toward the nominee. State the matched vote count and the UTC range; when truncated is true, call the rows a partial list.

An MVP-only answer runs no ScoutQL; set queryText to null and includeVisualization to false unless the tool rows genuinely need a chart or table.
