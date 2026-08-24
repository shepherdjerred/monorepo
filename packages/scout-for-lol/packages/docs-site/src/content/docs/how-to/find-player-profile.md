---
title: Find and interpret a player profile
description: Search a shared server's configured players, distinguish combined Riot accounts, and read ranks, recent form, champion samples, and recorded match cards.
sidebar:
  order: 0
---

Use Player Profiles when you want Scout's recorded history for a configured
player. Profiles require Discord sign-in and only appear for enabled servers
that you and Scout currently share. You do not need server administrator
permission.

## Find the player

1. Open [Player Profiles](/app/players).
2. Search the player's Scout alias or a Riot ID in `Name#Tag` form.
3. Use the server name on each result to choose the intended player.
4. Open the result.

No result means Scout has no matching configured player inside your enabled
shared servers. It does not reveal whether the same alias or Riot ID exists in
another server.

## Check which accounts are combined

The profile header shows the server alias and how many Riot accounts Scout
combines. Each account card identifies its Riot ID, region, last observed
match, last check time, and last observed solo and flex ranks.

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

## Read combined performance

The summary combines games from every account in the profile. Use the queue
buttons to compare all recorded queues, ranked solo/duo, and ranked flex.

Champion rows marked with an asterisk have fewer than the displayed minimum
number of games. Treat their win rates as early evidence, not a stable
performance claim.

## Trace a match to an account

Every recorded match card names the Riot account Scout observed for that game.
Use that label when a rank change, champion result, or queue entry appears to
come from the wrong account.

The list is paginated and includes only games Scout recorded. It is not a
complete Riot match history, and viewing it never starts a manual refresh.

## If access disappears

Scout checks your current Discord membership and the server rollout flag on
every search and profile request. If you leave the shared server or the feature
is disabled there, search and direct profile links stop returning the player.

## Related

- [Ask and follow up in Explore](/docs/tutorials/first-explore-conversation/)
- [Add and organize tracked players](/docs/how-to/add-players/)
- [How players, accounts, and subscriptions relate](/docs/explanation/players-accounts-subscriptions/)
