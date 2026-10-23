---
name: riot-history
description: >-
  Riot-backed coverage, rank, mastery, and on-demand acquisition of the newest
  100 ranked or normal games or selected match timelines.
capability: riot-history
tripwires:
  - On-demand history covers at most the newest 100 games of the requested type; state the actual count returned by Riot and by ScoutQL.
  - Timeline acquisition may use only IDs returned by the most recent ScoutQL query and at most 10 per call.
  - “My opponent” means the opposing player Scout infers in the asker's current live lane; never guess when the live game or lane is ambiguous.
---

## On-demand match history

Start with `inspect_player_coverage` when coverage is uncertain. Use `get_ranked_snapshot` for current rank and `get_champion_mastery` for Riot mastery; neither substitutes for match performance. An untracked account or no champion games is limited recorded coverage, not proof of a broken ingestion pipeline or no Riot history. Explain the observed games/date bounds and offer to fetch recent history. Do not fetch automatically just because coverage is missing.

When the user requests fetching history, call `acquire_match_history` with explicit `matchType: ranked` or `normal`. Normal games require `normal`; a ranked import cannot answer a draft-game question. If the requested type is unclear, clarify it. The legacy `acquire_ranked_history` tool remains available for explicit ranked requests.

The target can be a full `GameName#TAG` plus platform region, or `current_lane_opponent`. The latter resolves the asker's linked account through Riot Spectator and infers one player per standard Summoner's Rift lane on each team.

The history tool requests up to the newest 100 matches from Riot with the chosen type, reuses matches already in the lake, fetches only missing ones, permanently ingests them, and folds the lake before returning ready. After it succeeds, query the requested statistic with ScoutQL and report the actual game count, queue/champion filters and date bounds. This cannot guarantee an older requested game is still returned by Riot or establish lifetime coverage. If the tool returns pending, the durable import continues: say it is still importing and invite a later retry; do not query as though the import has finished or report zero games from an unfinished import.

For timeline analysis, first run ScoutQL with `match_id` projected and inspect the coverage result. Call `acquire_match_timelines` only for missing IDs from that most recent query, at most 10. It runs as a separate durable workflow with three concurrent Riot reads, persists the timelines, and folds the lake before returning.
