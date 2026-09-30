---
name: patch-impact
description: Connect structured patch changes to observed Scout match performance without confusing correlation and cause.
capability: always
surfaces: [web, discord, voice]
tripwires:
  - Patch notes describe changes; Scout match results describe this corpus. Never claim the former caused the latter without evidence.
---
## Patch impact

Use `lookup_patch_notes` for one patch and `compare_patch_changes` for a range or before/after question. Use champion, ability, item, rune, and summoner-spell lookups for current mechanics. Never supply a changed value from memory.

When measuring observed impact, query with ScoutQL, split matches on the exact patch boundary, and report games in both periods. Compare the same population and queue where possible. State separately: what Riot changed, what changed in Scout's sample, and plausible interpretations. Use cautious wording for small samples and do not call correlation causation.
