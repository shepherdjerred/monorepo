---
title: Why competitive progress is deterministic
description: How Scout turns retained match evidence into reproducible Hall records, challenge progress, and duel results.
sidebar:
  order: 8
---

Scout's competitive features use the model to understand a person's request,
but never to decide whether a match satisfied it. The durable decision is made
by a versioned contract evaluated against retained match evidence.

## Evidence comes before state

The report lake supplies participant facts shared by the Hall and community
challenges. Timeline-dependent challenges and every duel additionally require
the retained Riot timeline. The timeline must be durable before Scout advances
an account cursor for a feature that depends on it.

This ordering matters because a progress counter is only a summary. If the
underlying evidence disappeared first, Scout could neither reproduce the result
nor safely recompute it after an account or rule change.

## Interpretation freezes into a contract

Explore may translate a conversational challenge into canonical rules. Scout
then parses, validates, explains, and previews those rules. Publication requires
explicit confirmation.

After publication, only the frozen typed contract evaluates matches. A new edit
creates a new immutable template version instead of changing the meaning of
runs already underway. A run also freezes moving inputs, such as the champion
catalog for an A–Z challenge.

This separates two jobs:

1. The model helps an author express an observable goal.
2. Deterministic code decides progress from match evidence.

Subjective or unobservable requests fail during compilation rather than being
guessed at during evaluation.

## Baselines and revisions prevent false announcements

A Hall cell stores its baseline, current value, holders, and match evidence.
Building or rebuilding a baseline is silent. Only a strictly greater value from
a later ingested match creates a record-break event, and one match's breaks are
grouped behind an idempotent delivery key.

A challenge account change creates a new evaluation revision. The new snapshot
is built separately while readers see the last complete snapshot marked as
recomputing. One atomic replacement makes the new revision current, so a page
never mixes old and new progress.

## Workflows own long-running coordination

Temporal workflows own Hall baselines, challenge recomputation, and active duel
series deadlines. Stable business identifiers make activity retries and
duplicate signals safe. A recurring reconciliation pass reconnects committed
database intent to a workflow if a process stopped between those two actions.

The database remains authoritative for member-visible state. Workflows
coordinate retries, paging, and deadlines; they do not hide an uncommitted
side-effect in workflow history.

## Duels fail into review

A duel result needs a complete roster and timeline. Exact events identify kill
and turret crossings; participant frames identify lane-CS crossings. Scout
compares the first configured objective to occur.

Simultaneous crossings, missing evidence, unexpected players, or a complete
game with no winning objective cannot produce a trustworthy automatic result.
Those cases enter an audited organizer review. Likewise, an expired deadline
marks a series overdue but never invents a no-show winner.

## Consent and friendly competition stay separate

Custom-match results become member-visible only after every invited participant
accepts the versioned disclosure. That is also why custom and duel games do not
feed the server-wide Hall.

Competitive progression does not depend on Bryan Bucks. It creates no entry
fees, prizes, wagers, or bracket markets, and verified duel results cannot
mutate the friendly betting ledger.

## Related

- [Set up a Hall of Fame](/docs/how-to/set-up-hall-of-fame/)
- [Start a community challenge run](/docs/how-to/run-community-challenge/)
- [Run a duel or tournament](/docs/how-to/run-duel-event/)
