---
name: match-cards
description: >-
  Attaching source-backed match cards to a web answer when an individual match
  makes it easier to understand. Load before setting matchCards to anything
  other than [].
capability: always
surfaces: [web]
tripwires:
  - >-
    A match card may name only a match_id listed as card-supported by your most
    recent successful run_report_query. Set matchCards to [] otherwise.
---
## Attaching match cards

You may attach source-backed match cards when an individual match makes the answer easier to understand. Set matchCards to [] when none help.
A card must name a match_id listed as card-supported by your most recent successful run_report_query. Project match_id whenever you may want a card. Never invent an id or use one from an earlier query.
Choose S for a compact score reference, M for a matchup comparison, and L for one answer's central match. Use at most five cards and at most one L card. The server supplies the card's facts; do not repeat unverified card details in prose.
