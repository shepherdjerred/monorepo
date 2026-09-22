---
title: Duels reference
description: Duel routes, formats, rules, limits, and how results settle or fall into review.
sidebar:
  order: 16
---

## Routes

| Surface         | Route                                                |
| --------------- | ---------------------------------------------------- |
| Duel overview   | `/app/duels/<server id>`                             |
| Event           | `/app/duels/<server id>/events/<event id>`           |
| Event standings | `/app/duels/<server id>/events/<event id>/standings` |
| Series          | `/app/duels/<server id>/series/<series id>`          |
| Head-to-head    | `/app/duels/<server id>/head-to-head`                |

## Rules and limits

| Setting          | Values                                                     |
| ---------------- | ---------------------------------------------------------- |
| Competitor size  | 1v1 or exact-pair 2v2                                      |
| Event formats    | Single elimination, double elimination, single round robin |
| Series length    | Best-of-1, best-of-3, best-of-5, with round overrides      |
| Kill target      | 1–10                                                       |
| Lane-CS target   | 10–500                                                     |
| Turret condition | First turret on or off                                     |
| Match window     | 24 hours–14 days; seven-day default                        |
| Elimination cap  | 64 entrants                                                |
| Round-robin cap  | 16 entrants                                                |
| Lobby creation   | Either participant creates a normal custom lobby           |
| Client coverage  | At least one assigned player runs a paired Scout Client    |

At least one objective is required. Kill and first-turret timestamps use exact
timeline events. Lane-CS crossings use participant frames and exclude jungle
CS. Missing or ambiguous evidence produces organizer review rather than an
automatic result.

Rolling records include games, wins, losses, win rate, streak, and head-to-head.
Win-rate placement requires five played games. Structured events also track
series wins and losses. Round-robin ordering is series wins, two-way head-to-
head, then game differential; a remaining tie requires a tiebreak series.

## Results fail into review

A duel result needs a complete roster and timeline. Exact events identify kill
and turret crossings; participant frames identify lane-CS crossings. Scout
compares the first configured objective to occur.

The observed lobby roster must exactly match one pending duel. Scout does not
guess when more than one pending duel matches. Riot result data wins when it is
available; complete local evidence may fill the gap after Riot has had two
minutes to provide the match.

Simultaneous crossings, missing evidence, unexpected players, or a complete
game with no winning objective cannot produce a trustworthy automatic result.
Those cases enter an audited organizer review. Likewise, an expired deadline
marks a series overdue but never invents a no-show winner.

## Availability

Duels are gated per server by the default-off `duels_enabled` flag. Custom and
duel games do not feed the server-wide Hall, and duels create no entry fees,
prizes, wagers, or Bryan Bucks markets.

## Related

- [Run a duel or tournament](/docs/how-to/run-duel-event/)
- [Competitive progression reference](/docs/reference/competitive-progression/)
