---
title: Competitive progression reference
description: Routes, supported Hall records, challenge reducers, and duel formats and limits.
sidebar:
  order: 10
---

## Routes

| Surface            | Route                                                |
| ------------------ | ---------------------------------------------------- |
| Guild Hall         | `/app/halls/<server id>`                             |
| Hall configuration | `/app/g/<server id>/hall-of-fame`                    |
| Challenge catalog  | `/app/challenges`                                    |
| Challenge template | `/app/challenges/<template id>`                      |
| Challenge run      | `/app/challenge-runs/<run id>`                       |
| Duel overview      | `/app/duels/<server id>`                             |
| Event              | `/app/duels/<server id>/events/<event id>`           |
| Event standings    | `/app/duels/<server id>/events/<event id>/standings` |
| Series             | `/app/duels/<server id>/series/<series id>`          |
| Head-to-head       | `/app/duels/<server id>/head-to-head`                |

## Hall queue families

| Family                   | Included queues                          | Initially selected |
| ------------------------ | ---------------------------------------- | ------------------ |
| Ranked Summoner's Rift   | Solo, Flex, Ranked 5s                    | Yes                |
| Unranked Summoner's Rift | Normal, Draft Pick, Quickplay, Swiftplay | Yes                |
| ARAM                     | ARAM                                     | Yes                |
| Summoner's Rift Clash    | Clash                                    | No                 |
| ARAM Clash               | ARAM Clash                               | No                 |
| URF and ARURF            | URF, ARURF                               | No                 |
| Arena                    | Arena                                    | Yes                |
| Brawl                    | Brawl                                    | No                 |
| Classic Summoner's Rift  | Classic                                  | No                 |
| ARAM Mayhem              | ARAM Mayhem                              | No                 |
| Classic ARAM Mayhem      | Classic ARAM Mayhem                      | No                 |
| Doom Bots                | Separate Easy, Normal, and Hard families | No                 |

Custom games and Scout duel matches are excluded.

## Hall records

- Kills, assists, and largest multikill
- Champion damage and champion damage per minute
- Damage taken and damage mitigated
- CS and CS per minute
- Gold earned
- Teammate healing
- Vision score and wards cleared
- Objective damage and turret damage
- Crowd-control time
- Longest life and total time dead

All records compare higher values. Exact ties have multiple holders. Eligible
matches are completed, non-remake games played after the account began guild
tracking by a player who is still tracked.

## Challenge contract version 1

The contract supports observable match predicates and these bounded progress
reducers:

- count and sum,
- maximum or best,
- consecutive streak,
- distinct coverage over champions, roles, queues, or explicit values, and
- Boolean combinations of progress goals.

Template versions are immutable. A run retains its starting version and any
catalog, such as the A–Z champion list, frozen when the run began.

Run statuses are active, completed, archived, or failed. A separate evaluation
revision may be queued, running, ready, stale, or failed. During recomputation, the
last complete progress snapshot remains readable.

Coverage reports evaluated matches, the selected period, and missing timeline
evidence.

## Duel rules and limits

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

At least one objective is required. Kill and first-turret timestamps use exact
timeline events. Lane-CS crossings use participant frames and exclude jungle
CS. Missing or ambiguous evidence produces organizer review rather than an
automatic result.

Rolling records include games, wins, losses, win rate, streak, and head-to-head.
Win-rate placement requires five played games. Structured events also track
series wins and losses. Round-robin ordering is series wins, two-way head-to-
head, then game differential; a remaining tie requires a tiebreak series.

## Availability flags

The three independent, default-off flags are:

- `hall_of_fame_enabled`
- `challenge_runs_enabled`
- `duels_enabled`

Hall and challenge runs may be enabled in beta first. Duels remain hard-
disabled outside approved development or stub paths until the applicable Riot
approval is recorded.
