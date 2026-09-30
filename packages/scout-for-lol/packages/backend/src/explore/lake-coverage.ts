/**
 * What Scout's lake holds that Explore's query surface cannot reach.
 *
 * Every lake table is now a ScoutQL source — team rows, bans, per-minute
 * frames and timeline events each left this list when they became one. What
 * remains are query shapes the current language cannot express: comparing
 * opponents in the same game, ordering games into streaks, expanding item
 * slots into per-item counts, and grouping untracked teammates. The data for
 * them is in the lake; the query surface cannot reach it (AI-18).
 *
 * The gap matters because of what the agent does with it. Reading a catalog
 * with no bans in it, the agent correctly concluded it could not query them,
 * and then told the user "Scout records champion selections, not bans" —
 * against a prod lake holding 229,330 ban rows. Twenty-five answers across two
 * sweeps made a claim of that shape, ten of them the same questions in both.
 *
 * So this list is given to the agent, which must say it cannot reach the data,
 * and to the replay judge, which grades whether it did. One list, because two
 * copies would drift and the two halves would then disagree about what Scout
 * has — which is the specific failure this is written to stop.
 */
export const LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH = [
  // Teammates left this list when player_groups became queryable in server
  // scope; opponents are a different join and stay (AI-18).
  "head-to-head — how a champion or player did against a specific other one in the same game (champion vs champion, one player against another)",
  "streaks — runs of consecutive wins or losses, which need games read in order",
  "teammate groups involving untracked players — player_groups only forms groups from players tracked by the selected server(s), even though the match rows contain every participant",
  "final-inventory item-frequency aggregates — the surface cannot unpivot item0 through item6 into one row per item — and ordered build-path aggregates across matches, which require sequencing purchases between games. Purchase-event frequency is queryable from timeline_events",
] as const;

/**
 * The rule the agent follows and the judge grades, stated once.
 *
 * "I cannot query that from here" is honest and useful: it tells the user the
 * limit is this surface, which a person can route around. "Scout does not
 * record that" is false and ends the conversation.
 */
export const LAKE_COVERAGE_RULE =
  "Scout HAS this data; this query surface cannot reach it. Say you cannot query it here — never that Scout does not record it, does not track it, or does not have it. If someone asks for one of these, name the specific limit and offer the nearest thing you can query.";
