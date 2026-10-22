---
name: game-review
description: Review one or several games with evidence-backed turning points, strengths, and next actions.
capability: always
tripwires:
  - Never claim a turning point from timeline events unless every analyzed match has complete timeline coverage.
  - Preserve champion and player names returned by the data, including unfamiliar names; never substitute a familiar champion. Join killers and victims by participant ID and verify team identity before naming threats.
---

## Game review

Use the ScoutQL field guide and language reference in the core instructions to identify the requested player and matches before interpreting them. Start with outcome, role, champion, matchup, kills/deaths/assists, farm, gold, vision, damage, objectives, duration, and game count. Report results include a grouping-label column, so select at most 19 outputs when using `run_report_query`; split additional stats into a second query that retains match identity. Separate direct evidence from interpretation. When analysis tools are available, load `data-analysis` to inspect full raw documents and compute joins, ordered sequences, or nested damage.

For one game, project `match_id` and attach a match card when it adds context. Every later participant or matchup query must retain `match_id` if you intend to attach that card: eligibility comes from the most recent successful query. For several games, distinguish recurring behavior from a one-off. If the question depends on event order, check stored timeline coverage first. With analysis tools available, materialize the selected match's raw timeline and inspect its frames/events before claiming there is no timeline. A postmatch table lacking event columns does not mean the stored timeline is missing. Prematch coverage is independent of timeline coverage; absent prematch data does not prevent a postmatch/timeline review.

When available, use `summarize_match_timeline` as the first analysis path for a game review. Select the reviewed player's `participant_id` alongside `match_id`, materialize the match and timeline documents, then call it with that raw dataset, match ID, participant ID and offset 0. It returns the full roster and stats, coverage counts, and pages of named deaths/objective events with preceding gold snapshots. Follow `nextOffset` to finish the sequence. Copy its `gameTime` labels instead of converting milliseconds mentally. Call a death a shutdown only when its `shutdownBounty` is positive; a lead alone does not establish a shutdown. Gold snapshots precede the event at the displayed snapshot time. These facts support a detailed review without JavaScript or raw frame dumps; use JavaScript only for a further question the summary cannot answer.

Once `nextOffset` is null and the summary supplies the requested stats and events, write the final answer from those facts. Do not inspect or page the raw dataset schema to reconfirm fields that the summary already explains. Open further analysis only for a specific unanswered question, and state that question before selecting the additional evidence. Keep the final review concise: key stats, the recorded death sequence, a few relevant objectives and at most three adjustments, with explicit coverage limits. For a single-game review when `match-cards` is listed as available, load it and attach the reviewed match's card, retaining its `match_id` in the most recent successful report query.

Use `acquire_match_timelines` only for genuinely missing timelines, for up to 10 eligible match IDs returned by the most recent query. Do not treat absent timeline events as zero when coverage is incomplete. When analysis tools are unavailable, explain that limitation precisely and review the available postmatch evidence; do not assert that complete stored timelines are absent.

Keep analysis replies compact: return the reviewed player's stats, named killers with team identities, selected death/objective events and coverage counts. Keep full participant objects, damage arrays and frame histories inside the datasets. Preserve unfamiliar champion names exactly when explaining the returned events.

For standard Riot captures, the match's `document.info.participants` maps `participantId` to champion, team, and player identity; the timeline's `document.info.frames` contains ordered `events` and `participantFrames`. Join a `CHAMPION_KILL` event's `killerId` and `victimId` to those match participants. Select the reviewed player's deaths and a few objective events, with timestamp, named killer, team and position. Do not return every raw event, participant object or frame. Compute frame/event counts and missing-document coverage alongside the selected events in the same execution.

End with no more than three concrete adjustments tied to observed evidence. Do not prescribe a build or matchup rule from model memory; use League reference tools for current facts.
