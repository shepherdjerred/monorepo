---
title: Track Arena mode matches and placements
description: How to configure dedicated Arena notifications, read 18-player scoreboard cards, and track augment selections in Discord.
sidebar:
  order: 11
---

Arena mode uses a different team structure, placement rules, and progression systems from Summoner's Rift or ARAM. Scout treats Arena as a first-class queue: it tracks 18-player matches (six teams of three), displays augment selections on post-match scoreboard cards, and supports dedicated Arena leaderboards.

## Restrict a channel to Arena matches

To route Arena recaps to a dedicated channel (like `#arena-recap`) so they don't mix with ranked 5v5 games:

1. Open **Subscriptions** in the [Scout dashboard](/app/).
2. On the row for the player and channel you want to configure, choose **Edit filters** (or use **Set filters for a channel** to update all players at once).
3. Untick **All queues** and tick **Arena**.
4. Save your changes.

The channel will now only post pre-match loading screens and post-match recaps for Arena games.

## Read an Arena post-match card

Arena post-match report cards differ from standard 5v5 scoreboard cards:

- **Placements**: Teams are ranked from 1st to 6th place (or 1st to 8th in legacy duo Arena) based on elimination order.
- **Team groups**: Participants are grouped into their respective subteams with combined team KDAs and damage shares.
- **Augments**: Each player's card shows the augment icons selected throughout the game rounds (Silver, Gold, and Prismatic).
- **Damage & items**: Scoreboards report individual champion damage dealt, total gold earned, and final item builds.

## Run an Arena server competition

You can create automated server competitions tailored specifically to Arena mode:

1. In the dashboard, navigate to **Competitions** and click **Create competition**.
2. Under **Queues**, select **Arena**.
3. Choose your scoring criteria:
   - **Most Wins**: Counts 1st-place finishes.
   - **Top Placements**: Track podium finishes (top 3 in 6v3 Arena, top 2 in 8v2 Arena).
   - **Games Played**: Track server activity in Arena throughout a split or weekend event.
4. Set the competition schedule and select the announcement channel for daily leaderboard updates.

## Query Arena stats in Explore and ScoutQL

You can analyze Arena performance directly in Explore using natural language (`/scout ask`) or custom ScoutQL queries:

```scoutql
SELECT player,
       COUNT(*) AS games,
       AVG(placement) AS avg_placement,
       COUNT(*) FILTER (WHERE placement = 1) AS wins
FROM match_participants
WHERE queue = 'arena'
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY avg_placement ASC
RENDER table
```

## Related

- [Route notifications to the right channels](/docs/how-to/route-notifications/)
- [Queues and regions reference](/docs/reference/queues-and-regions/)
- [Run competitions and leaderboards](/docs/how-to/run-competitions/)
