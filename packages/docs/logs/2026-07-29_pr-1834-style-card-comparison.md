---
id: log-2026-07-29-pr-1834-style-card-comparison
type: log
status: complete
board: false
---

# PR #1834 old/new style-card comparison

## Scope

Compared all 13 style cards in generated-context PR
[#1834](https://github.com/shepherdjerred/monorepo/pull/1834) at head
`43a529a0bacd129f0e89f66104565c3ca166d479` against its exact base
`7fa22ca71eb51484f50cb35cfaf8951ba57d3b24`.

The audit measured serialized size, descriptive word count, coverage metadata,
sample and quote counts, exact sample retention, and approximate token-set
similarity. It also reviewed summaries, topics, relationships, concerns, and
the generation path that produced the cards.

## Outcome

The refresh is mechanically safe but content-lossy. It improves three
previously thin cards substantially, preserves the central identity of several
others, and removes sensitive or weakly supported details. However, it is not
an incremental update in practical terms: all 13 cards are complete rewrites,
only five exact old sample messages survive, and the average substantive
token-set similarity is 18.2%.

The main metadata issue is that `coverage.messages` now reports every unique
message by the person in the verified corpus, while the model receives only the
latest 200 safe messages plus the existing card. The PR body discloses a bounded
sample, but the card note says only that it was generated from the verified
corpus. The old cards generally used `coverage.messages` to describe the
analyzed sample, so the same field has changed meaning without saying so.

## Aggregate comparison

| Metric                              |     Old |     New | Change |
| ----------------------------------- | ------: | ------: | -----: |
| Serialized JSON bytes               | 232,213 | 156,612 | -32.6% |
| All substantive words               |  31,207 |  19,010 | -39.1% |
| Descriptive words excluding samples |  20,208 |  16,814 | -16.8% |
| `sample_messages` entries           |   1,320 |     130 | -90.2% |
| `quotes` entries                    |     261 |     135 | -48.3% |
| Exact old samples retained          |         |       5 |        |

The large overall reduction is mostly intentional sample compression: every
new card has exactly 10 verified samples. Descriptive prose still falls 16.8%
overall, but that aggregate hides a split between three large improvements and
ten reductions.

## Per-card comparison

The old and new coverage counts are shown for completeness but are not directly
comparable because the field changed meaning.

| Card    | Coverage old → new | Descriptive words old → new |  Change | Assessment                                                                                                                                                                                  |
| ------- | -----------------: | --------------------------: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aaron   |     5,011 → 10,036 |               1,993 → 1,929 |   -3.2% | Core voice and social/League identity survive; newer guessing-game, music, and server-lore evidence replaces some older IRL breadth.                                                        |
| Brian   |      2,446 → 8,611 |               1,720 → 1,229 |  -28.5% | Social connector and lobby organizer survive; other-game, sports, and broader server-lore detail becomes much thinner.                                                                      |
| Caitlyn |      1,851 → 3,184 |                   307 → 679 | +121.2% | Clear improvement from a generic card to specific cadence, logistics, hosting, gaming, and teasing patterns.                                                                                |
| Colin   |      1,184 → 2,517 |                   358 → 801 | +123.7% | Clear improvement with concrete Wordle, music, League, banter, and relationship evidence.                                                                                                   |
| Danny   |     6,690 → 20,103 |               1,876 → 1,334 |  -28.9% | Organizer/practical-explainer identity survives, but finance, career, politics, food, vehicle, and older lore breadth is lost.                                                              |
| Edward  |      5,328 → 9,720 |               2,012 → 1,494 |  -25.7% | League/event/creative organizer remains. Sensitive personal material is appropriately removed, but broader creative and life context narrows.                                               |
| Hirza   |     6,953 → 10,878 |               2,176 → 1,519 |  -30.2% | Lobby organizer, League, Wordle, warmth, and short cadence survive; cars, technology, travel, and wider game context recede.                                                                |
| Irfan   |      6,188 → 8,857 |               2,005 → 1,602 |  -20.1% | League/Wordle/Palworld coordination survives; career mentoring, finance, vehicles, and broader game/social context narrows.                                                                 |
| Jerred  |     3,989 → 10,863 |               1,906 → 1,219 |  -36.0% | Largest descriptive regression. Organizer and technical-caretaker identity survives, but systems/programming, cooking, coffee, school, hardware, and longer explanations largely disappear. |
| Long    |      1,295 → 2,704 |               1,652 → 1,398 |  -15.4% | Concise lobby-wrangler identity survives with useful recent Palworld, outings, storage, and music updates; some older technical and game breadth is lost.                                   |
| Richard |        758 → 1,327 |                   362 → 914 | +152.5% | Strongest improvement: the old generic card becomes specific about cadence, cars, cameras, hardware, spending jokes, activities, and supportiveness.                                        |
| Ryan    |      5,105 → 6,953 |               1,776 → 1,260 |  -29.1% | Vehicle/outdoor/social-organizer core survives and current Tacoma/Palworld arcs improve, but work, finance, and wider hobby context narrows.                                                |
| Virmel  |     8,210 → 20,567 |               2,065 → 1,436 |  -30.5% | Organizer/server-steward core survives, but the card is heavily biased toward recent music-bot commands and loses fashion, finance, governance, and lore depth.                             |

## Generation-path findings

1. `selectStyleRefreshCandidates` groups the complete verified projection by
   author, but sends only the latest 200 messages that pass the safety filter to
   the model.
2. The prompt includes the full existing card and explicitly asks the model to
   preserve useful prior observations. The output nevertheless rewrites every
   generated field and frequently drops uncontradicted prior breadth.
3. `coverage.messages` and its date range are finalized from all messages for
   the author, not the 200 supplied messages. The note does not distinguish
   corpus coverage from model evidence coverage.
4. The 10 `sample_messages` per card are byte-for-byte corpus values and are
   enforced against the safe supplied set. The output contains no URLs,
   addresses, credentials, email addresses, or exposed Discord user IDs. One
   sample contains a normal custom-emote token with its Discord asset ID.
5. New `concerns` improve safety and evidence discipline. The refresh
   appropriately avoids carrying forward several sensitive personal
   disclosures from the old cards.

## Recommendation

Do not treat PR #1834 as a routine refresh. Before acceptance:

1. Make the metadata explicit: distinguish total verified corpus messages from
   the bounded evidence sample and record the sample size/time window.
2. Decide whether style cards are snapshots of recent behavior or cumulative
   personas. The current implementation claims preservation but behaves closer
   to a recent-window rewrite.
3. If cumulative personas are intended, use a time-stratified sample and/or a
   field-level merge that retains uncontradicted observations. Re-review Jerred,
   Virmel, Brian, Danny, Edward, Hirza, Irfan, and Ryan after that change.
4. Caitlyn, Colin, and Richard are clear content improvements and provide useful
   examples of the desired specificity.

## Session Log — 2026-07-29

### Done

- Verified PR #1834's exact base and head through the GitHub connector.
- Compared all 13 old/new JSON cards with executable measurements.
- Reviewed summaries, topics, relationships, concerns, samples, and the
  generation/selection code.
- Identified the coverage-metadata semantic change and recent-window content
  bias.

### Remaining

- Decide whether to revise the refresh implementation before accepting PR
  #1834.
- If the implementation changes, regenerate or deterministically re-finalize
  the proposal, rerun the comparison, and complete human persona review.

### Caveats

- Word counts and token-set similarity quantify change but do not alone measure
  persona accuracy.
- Old coverage counts often describe truncated samples; new counts describe the
  complete verified per-author projection.
- The qualitative assessment evaluates preservation and evidence quality, not
  whether every personal characterization is socially acceptable to its
  subject.
