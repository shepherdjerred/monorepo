---
title: Find and interpret a player profile
description: Use the personalized player hub, filter recorded games, compare champion performance, and inspect match scoreboards and timelines.
sidebar:
  order: 0
---

Use Player Profiles when you want Scout's recorded history for a configured
player. Profiles require Discord sign-in and only appear for enabled servers
that you and Scout currently share. You do not need server administrator
permission.

## Start from the player hub

1. Open [Player Profiles](/app/players).
2. Under **Your profiles**, open any configured player linked to your Discord
   account. A profile can appear more than once when different shared servers
   register you separately.
3. Or choose one of the six **Recently active** players, ordered by the newest
   match Scout recorded.
4. To find someone else, search their Scout alias or Riot ID in `Name#Tag`
   form, use the server name to choose the intended registration, and open it.

No result means Scout has no matching configured player inside your enabled
shared servers. It does not reveal whether the same alias or Riot ID exists in
another server.

## Check which accounts are combined

The profile header shows the server alias and how many Riot accounts Scout
combines. Each account card identifies its Riot ID, region, last observed
match, last check time, and last observed solo, flex, and ranked-5s ranks.
Ranked queues use the same crest, division, and league-points treatment as a
post-match report. An unranked queue stays text-only.

Scout combines those accounts because the server configured them as one
player. It does not infer that relationship from similar names. Ask a server
manager to correct the configuration if the grouping is wrong.

## Judge freshness

Use both timestamps:

- **Last observed match** is the newest game Scout recorded for that account.
- **Last checked by Scout** is the latest automatic poll, including checks that
  found no new game.

Opening the profile does not contact Riot or refresh either value. Scout's
normal polling and ingest pipeline remains the source of new data.

## Choose the games to compare

The summary, champion table, and match history share one filter:

1. Choose **Last 20**, **Last 50**, or **All time**.
2. Choose **All games**, **Competitive**, **Solo / duo**, **Flex**, or
   **Clash** for a common queue grouping.
3. Expand **Choose queues** when you need an exact combination. Queues are
   grouped into Competitive, Standard, Rotating, and PvE sections.

**All games** does not add a queue predicate. Use it when older stored games
may have a queue Riot had not mapped at ingest time. A custom selection includes
only the checked queues. The address bar keeps the selected window and queues,
so you can bookmark or share the same view.

## Read combined performance

The summary combines matching games from every Riot account in the profile.
Current rank does not change with the game filters: it is always Scout's newest
known rank.

Champion rows marked with an asterisk have fewer than the displayed minimum
number of games. Treat their win rates as early evidence, not a stable
performance claim.

Use **Previous** and **Next** below the champion table to move through ten
champions at a time.

## Compare players on a champion

1. Select the game window and queues you want on a player profile.
2. Open a champion name in the champion-performance table. The comparison keeps
   those filters.
3. Check or clear accessible servers to change the comparison cohort.
4. Sort by win rate, games, KDA, CS, damage, gold, vision, or alias.

The main leaderboard includes player registrations with at least ten matching
games. Smaller samples stay in a separate table. A player configured in two
servers appears as two labeled entries, and rows linked to your Discord account
are marked **You**.

## Trace a match to an account

Every recorded match card names the Riot account Scout observed for that game.
Use **Previous** and **Next** to move through twenty matches at a time. The
selected Last 20 or Last 50 window is also the end of the list.

Open a victory or defeat label to inspect the match. The match page shows both
complete team scoreboards and highlights the player whose profile you opened.
Use the Riot ID, position, KDA, CS, gold, vision, damage, team-relative shares,
objectives, and any accessible Scout aliases to interpret each participant.

## Explore a captured timeline

When Scout retained the timeline, the match page also provides:

- team-gold and selected-player progression charts;
- a chronological key-event summary;
- a filterable event explorer with 100 rows per page; and
- a frame table with 100 rows per page and every retained frame field.

Choose an event type or participant to narrow the explorer. Open an event to
see every non-empty retained field; this also works for Riot event types Scout
does not recognize by name yet.

If the page says **Timeline not captured**, the scoreboards are still complete
for Scout's stored match row. Scout never contacts Riot from the page to fill
the historical gap.

Every list and detail includes only data Scout retained. It is not a complete
Riot match history, and viewing it never starts a manual refresh.

## If access disappears

Scout checks your current Discord membership and the server rollout flag on
every search and profile request. If you leave the shared server or the feature
is disabled there, search and direct profile links stop returning the player.

## Related

- [Ask and follow up in Explore](/docs/tutorials/first-explore-conversation/)
- [Add and organize tracked players](/docs/how-to/add-players/)
- [How players, accounts, and subscriptions relate](/docs/explanation/players-accounts-subscriptions/)
