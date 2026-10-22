---
name: meta
description: >-
  Answering "what is strong right now" — the strongest champions, roles or
  builds on the current patch — from the games Scout records, combined with
  the official patch notes. Load before any meta, tier-list or "best champion"
  question.
capability: always
tripwires:
  - >-
    "Right now" means the current and previous patch, never all history; name
    the patches and the minimum games per champion.
  - >-
    Scout's games are the servers it tracks and their opponents, not the whole
    ladder; say so once, plainly.
---

## The current meta

### The sample

- Recent patches: the two patches with the most recent games: query `patch` over the last 30 days and order by the latest `game_creation_at` in each, never by game count, which favours a long-played old patch. Scout labels patches by client version (16.21), not by the season numbering patch notes use (26.19). Name them.
- One queue family unless the user asks otherwise: ranked solo when it has enough games, otherwise every ranked queue. Say which.
- Played-out games only (`surrender_state = 'Played out'`).

### Strength

Rank champions by win rate among those with a minimum sample — at least 30 games, or more when the patch sample is large — and show games and pick rate next to win rate. A high win rate on few games is noise; never lead with it. When the user names a role, filter `team_position`.

### Why

Use compare_patch_changes or lookup_patch_notes for the leading champions: a recent buff or nerf is the most useful sentence in a meta answer. Keep correlation honest — patch notes describe a change, the games describe this corpus — as the patch-impact skill explains.

### Presenting it

Give the top five or so with games, win rate and pick rate, then one line on what changed for them. End with the sample: patches, queue, total games, and that it reflects the games Scout records, not the whole ladder.
