---
title: Dare contract ScoutQL
description: The relational contract profile Dares compile to — closed functions, timeline relations, and authoring rules.
sidebar:
  order: 15
---

The editor syntax documented on the [ScoutQL](/docs/reference/scoutql/) page is
report ScoutQL: one bounded data source plus grouping, aggregation, ordering,
and rendering. Dare v2 contracts use a relational profile of ScoutQL with
qualified columns, aliases, non-recursive CTEs, bounded joins, scalar
subqueries, and deterministic first-N game sets. Explore can parse, validate,
canonically format, explain, and historically preview that profile without
executing submitted SQL. Model-based authoring generates the query and typed
evaluator plan together; the advanced draft editor instead compiles edited
ScoutQL back into that same versioned plan before it can save a new revision.

Contract ScoutQL always returns exactly one nullable Boolean named `achieved`:
`true` means proven, `false` means conclusively not achieved, and `null` means
the bounded evidence is insufficient. Its compiler accepts only the closed
match and timeline catalog, freezes every `dare_target('Tn')` binding at
funding, parameterizes values, and rejects wall-clock or dynamic player
resolution. Validation first serializes the DuckDB AST, then applies Scout's
closed-world source, function, target, statement, and complexity policy. A
successful compilation returns canonical text plus the hash of its immutable
AST, the reconstructed evaluator plan, and its exact plain-language meaning; it
never runs the submitted query. Only a canonical query that round-trips to the
same immutable AST is accepted. The ordinary report editor does not accept this
relational profile; inspect and revise contracts through Explore.

An arbitrary relational query is limited to 20 CTEs, 8 joined relations, 60
predicates, and expression depth 12. Canonical Dare text contains mechanical
candidate, eligibility, and bounded-set CTEs and joins. The compiler allows
that exact physical envelope only long enough to reverse-compile it, then
requires an immutable-AST round trip and enforces the semantic limits: at most
20 game sets, 8 joined relations within each game set, 60 predicates across the
contract, and expression depth 12. Renaming the supporting structure or using
the wider envelope for another SQL shape is rejected.

The contract profile keeps participant columns qualified (`p0.kills`) and uses
a small closed set of Dare functions for semantics that must round-trip without
ambiguity:

- `dare_target('T1')` binds the frozen accounts for target `T1`.
- `dare_rate('T1', 'cs_per_minute')` computes a supported participant rate.
- `dare_related_participant_count(...)` expresses ally or opponent context.
- `dare_timeline_event_count(...)` counts covered timeline evidence. Its
  arguments are positional and documented below.
- `dare_matching_games(...)` and `dare_aggregate(...)` produce the final
  three-valued `achieved` result from bounded game sets.

These are contract compiler primitives, not executable user-defined functions.
The closed compiler recognizes their AST shapes and turns them into evaluator
nodes; adding an unrecognized function or rearranging deterministic ordering is
rejected.

This separation is deliberate. A contract must remain reproducible after a
player rename, prompt change, or compiler upgrade, while an interactive report
is allowed to resolve today's player aliases and render rows for exploration.
Each saved revision records the compiler and evaluator versions. Compiler v2
also stores the immutable DuckDB AST and its SHA-256 plan hash; activation copies
those artifacts into the funded contract, and settlement records the same
identity in evidence rows and the final proof. Compiler v1 contracts remain
readable so funded work never depends on a rollout flag or migration rewrite.

## Counting timeline events

```text
dare_timeline_event_count(
  event_type,    -- required, e.g. 'CHAMPION_KILL' or 'ELITE_MONSTER_KILL'
  target,        -- a bound target key, or NULL for the whole match
  role,          -- 'subject', 'killer', 'victim', 'assist', 'creator', or NULL
  after_ms,      -- count only events at or after this game timestamp, or NULL
  before_ms,     -- count only events at or before this game timestamp, or NULL
  item_id,       -- restrict to one item, or NULL
  monster_type,  -- narrows ELITE_MONSTER_KILL, or NULL
  building_type  -- narrows BUILDING_KILL, or NULL
)
```

`monster_type` and `building_type` are the two newest arguments and are
**appended** rather than inserted. The macro is positional, so moving an
existing argument would change the canonical text of every stored contract and
break its plan-hash round trip.

They exist because the event type alone cannot tell one objective from another:
every elite monster is an `ELITE_MONSTER_KILL` and every structure a
`BUILDING_KILL`, so before these arguments a dragon dare and a baron dare
compiled to the same predicate.

| Argument        | Accepted values                                            |
| --------------- | ---------------------------------------------------------- |
| `monster_type`  | `ATAKHAN`, `BARON_NASHOR`, `DRAGON`, `HORDE`, `RIFTHERALD` |
| `building_type` | `INHIBITOR_BUILDING`, `TOWER_BUILDING`                     |

Three rules are enforced when a contract is authored, and each of them exists
because breaking it produces a predicate that counts zero — or counts the wrong
side — rather than an error:

- A narrowing must match its event type. `monster_type` applies only to
  `ELITE_MONSTER_KILL` and `building_type` only to `BUILDING_KILL`; Riot leaves
  the other column empty on every other event, so a mismatched pair is false in
  every game that could ever be played.
- The two narrowings cannot be combined. An event is either an elite monster
  kill or a building kill.
- An `ELITE_MONSTER_KILL` or `BUILDING_KILL` count must name a `target`. These
  objectives belong to the side that took them, so an unbound count includes the
  enemy team's dragons and towers, and an enemy objective would settle the dare.
  Bind the target with role `killer` or `assist`. A team-relative objective
  count is not expressible in a version-two contract.

These rules apply when a contract is written, never when one is read. A dare
already funded against a plan that predates them keeps rendering and settling
exactly as its participants agreed.

## Dare contract timeline relations

Dare v2's generated contract profile can additionally read four normalized
relations that are not available as top-level report-editor sources:

| Relation                      | Contents                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `timeline_events`             | Stable event IDs, match IDs, event types, timestamps, item IDs, objective types, and event context |
| `timeline_event_participants` | A timeline event's participant PUUID and semantic role, such as killer or victim                   |
| `timeline_participant_frames` | Per-participant frame values at a timeline timestamp                                               |
| `timeline_coverage`           | A complete-coverage marker for each retained, supported match timeline                             |

`timeline_events` carries `monster_type` and `building_type` alongside the event
type, which is what lets a contract say "dragon" rather than "elite monster" and
"inhibitor" rather than "structure". A v2 contract reaches them through the
[`dare_timeline_event_count`](#counting-timeline-events)
arguments of the same names; a v3 contract compares the columns directly.

Coverage is evidence, not a convenience flag. A coverage row means Scout
retained and completely normalized the supported timeline. No row means the
required evidence is missing and propagates `null`; unsupported queue choices
are rejected before a contract can be funded. A complete timeline with no
matching event evaluates to zero. That distinction prevents “Scout did not
retain this timeline” from being treated as “the event did not happen.” These
relations are joined only through the generated, bounded contract compiler and
inherit the same guild/player scope as the match rows.

## Related

- [ScoutQL](/docs/reference/scoutql/)
- [Bryan Bucks Dares on the dashboard](/docs/reference/bryan-bucks-dares/)
- [Bryan Bucks rules and limits](/docs/reference/bryan-bucks-rules/)
