---
title: Bryan Bucks Dares on the dashboard
description: The Dares tab — discovery, lifecycle detail, evidence, processing health, and the advanced editor.
sidebar:
  order: 14
---

Dares live at `/app/bucks/dares` in the web app. Explore is the conversational
Dare authoring surface: `/bb dare` starts a private Explore conversation, and
transcript cards let the author clarify a contract and confirm its next action.

## The Dares tab

The **Dares** tab under Bryan Bucks is the discovery and management surface for
the currently selected server. It appears when Dare authoring is enabled or
when the member has an existing Dare that must remain accessible.

**My Dares** includes your private unfunded drafts and every visible funded
contract involving you. **Guild Dares** includes funded contracts in the
selected server; it never exposes another member's draft. A Dare detail shows
its stable ID, revision, lifecycle state, explicit same-game or cross-game
meaning, targets, queue and time bounds, current pot, evidence progress, and
reproducible proof after settlement.

Nonterminal details refresh every 30 seconds. Their progress view includes
per-condition and per-target values, remaining work, race leaders, rank and
normalized LP movement, frozen improvement baselines, streaks, and sequence
steps when the contract uses them. The evidence list shows each evaluated match
in chronological order with candidate membership, actual values, coverage,
source references, progress before and after, and the structured raw trace.
Processing health distinguishes complete, delayed, stale, and failed polling;
an activating contract also shows snapshot attempts and the next retry.

Draft owners can validate, historically preview, or revise a draft with the
advanced editor, or return to Explore for conversational revision.
The advanced editor exposes the typed contract plan and generated ScoutQL with
diagnostics, semantic explanation, and a meaning diff before revision. Funding,
acceptance, decline, contribution, and cancellation first create a revision-
bound, single-use confirmation; merely opening or sharing a card never moves BB.

## Related

- [Bryan Bucks rules and limits](/docs/reference/bryan-bucks-rules/)
- [Dare contract ScoutQL](/docs/reference/bryan-bucks-dare-scoutql/)
- [Author and revise a Dare](/docs/how-to/bryan-bucks-author-a-dare/)
