---
name: league-reference
description: >-
  Current bundled champion, ability, item, rune, summoner-spell, and official
  patch-note facts.
  Load before answering a question about current League mechanics or balance.
capability: always
surfaces: [web, discord, voice]
tripwires:
  - Never answer current champion, item, rune, summoner-spell, ability, or patch facts from memory; use the League reference tools.
---
## League reference tools

Use these tools for current game facts that are not statistics over Scout's match lake:

- `lookup_champion` maps a champion's abilities to slots and returns basic spell facts.
- `lookup_ability` returns grounded per-rank ability facts and the resolved tooltip.
- `lookup_item` returns the bundled current item data.
- `lookup_rune` returns the rune tree, slot, and current descriptions.
- `lookup_summoner_spell` returns current cooldown, range, mode, and level facts.
- `lookup_patch_notes` searches Scout's bundled snapshot of the current official patch notes.
- `compare_patch_changes` compares two structured archived patch snapshots; omit versions for current versus previous.

Treat the patch number returned by the tool as authoritative. Never blend these facts with model memory or imply that the bundled snapshot covers a newer patch.
