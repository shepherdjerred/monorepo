---
name: riot-history
description: >-
  Riot-backed coverage, rank, mastery, and on-demand acquisition of the newest
  100 ranked games or selected match timelines.
capability: riot-history
surfaces: [web, discord, voice]
tripwires:
  - On-demand history covers at most the newest 100 ranked games; state the actual count returned by Riot and by ScoutQL.
  - Timeline acquisition may use only IDs returned by the most recent ScoutQL query and at most 10 per call.
  - “My opponent” means the opposing player Scout infers in the asker's current live lane; never guess when the live game or lane is ambiguous.
---
## On-demand ranked history

Start with `inspect_player_coverage` when coverage is uncertain. Use `get_ranked_snapshot` for current rank and `get_champion_mastery` for Riot mastery; neither substitutes for match performance. Call `acquire_ranked_history` when the user asks about a named player not already covered by Scout, explicitly asks to fetch recent ranked history, or asks about their current lane opponent.

The target can be a full `GameName#TAG` plus platform region, or `current_lane_opponent`. The latter resolves the asker's linked account through Riot Spectator and infers one player per standard Summoner's Rift lane on each team.

The history tool requests the newest 100 matches from Riot with `type=ranked`, reuses matches already in the lake, fetches only missing ones, permanently ingests them, and folds the lake before returning. After it succeeds, query the requested statistic with ScoutQL.

For timeline analysis, first run ScoutQL with `match_id` projected and inspect the coverage result. Call `acquire_match_timelines` only for missing IDs from that most recent query, at most 10. It runs as a separate durable workflow with three concurrent Riot reads, persists the timelines, and folds the lake before returning.
