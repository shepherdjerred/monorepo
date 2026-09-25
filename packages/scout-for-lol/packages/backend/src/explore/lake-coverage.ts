/**
 * What Scout's lake holds that Explore's query surface cannot reach.
 *
 * Every lake table is now a ScoutQL source — team rows, bans, per-minute
 * frames and timeline events each left this list when they became one. What
 * remains is not a table but a shape: questions that compare two rows of the
 * same game. The data for them is in the lake; a query reads one row at a
 * time (AI-18). Streaks, which read games in order, left when LONGEST_STREAK
 * and CURRENT_STREAK did.
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
export const LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH: readonly string[] = [];

/**
 * The rule the agent follows and the judge grades, stated once.
 *
 * "I cannot query that from here" is honest and useful: it tells the user the
 * limit is this surface, which a person can route around. "Scout does not
 * record that" is false and ends the conversation.
 */
export const LAKE_COVERAGE_RULE =
  "Scout HAS this data; this query surface cannot reach it. Say you cannot query it here — never that Scout does not record it, does not track it, or does not have it. If someone asks for one of these, say which of the two it is and offer the nearest thing you can query.";
