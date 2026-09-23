/**
 * What Scout's lake holds that Explore's query surface cannot reach.
 *
 * ScoutQL has a closed set of sources — `match_participants`,
 * `prematch_participants` and four that Explore may not use — while the lake
 * also holds team rows, champion bans and four timeline tables. Those are
 * reachable today only by the Dare v3 SQL surface.
 *
 * The gap matters because of what the agent does with it. Reading its catalog
 * and finding no bans, it correctly concludes it cannot query them, and then
 * tells the user "Scout records champion selections, not bans" — against a prod
 * lake holding 229,330 ban rows. Twenty-five answers across two sweeps made a
 * claim of that shape, ten of them the same questions in both.
 *
 * So this list is given to the agent, which must say it cannot reach the data,
 * and to the replay judge, which grades whether it did. One list, because two
 * copies would drift and the two halves would then disagree about what Scout
 * has — which is the specific failure this is written to stop.
 */
export const LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH = [
  "champion bans, and the order they were picked in (match_team_bans)",
  "WHEN an objective was taken — the clock time of a dragon, baron, herald, tower or inhibitor (timeline_events). Which team took each first is queryable, from match_teams",
  "per-minute gold, XP, level and CS for every participant (timeline_participant_frames)",
  "item purchases and skill-up order (timeline_events)",
] as const;

/**
 * The rule the agent follows and the judge grades, stated once.
 *
 * "I cannot query that from here" is honest and useful: it tells the user the
 * limit is this surface, which a person can route around. "Scout does not
 * record that" is false and ends the conversation.
 */
export const LAKE_COVERAGE_RULE =
  "Scout HAS this data; this query surface cannot reach it. Say you cannot query it here — never that Scout does not record it, does not track it, or does not have it. If someone asks for one of these, say which of the two it is and offer the nearest thing you can query.";
