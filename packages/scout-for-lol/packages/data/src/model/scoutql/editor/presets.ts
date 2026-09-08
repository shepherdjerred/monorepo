// ── Report presets ───────────────────────────────────────────────────────────
// The ready-made reports the app offers ("Most games played", "Weekly wins and
// losses", …), rewritten in ScoutQL v2. They are ordinary queries with no
// privileged status: each one compiles through the same analyzer as anything a
// person or an agent types, which the preset test asserts.
//
// Every `query` is canonically formatted (`formatScoutQl` is a fixed point on
// it), so the editor's Format button never reflows a preset the moment it is
// inserted.

export type ScoutQlPreset = {
  id: string;
  category: string;
  title: string;
  description: string;
  query: string;
};

const RELATIVE = (days: number): string =>
  `game_creation_at >= CURRENT_TIMESTAMP - INTERVAL ${String(days)} DAY`;

export const SCOUTQL_PRESETS: readonly ScoutQlPreset[] = [
  {
    id: "activity-leaders",
    category: "Leaderboards",
    title: "Most games played",
    description: "Find the most active players over the last 30 days.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY player
ORDER BY games DESC
LIMIT 10
RENDER leaderboard`,
  },
  {
    id: "ranked-win-rate",
    category: "Leaderboards",
    title: "Best win rate (ranked solo, min 10 games)",
    description: "Rank players by solo queue win rate with a games floor.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE queue IN ('solo')
  AND ${RELATIVE(30)}
GROUP BY player
HAVING games >= 10
ORDER BY win_rate DESC
RENDER bar_chart WITH (y = win_rate)`,
  },
  {
    id: "surrender-watch",
    category: "Behavior",
    title: "Surrender-happy champions",
    description: "Spot champions most associated with surrender losses.",
    query: `SELECT COUNT(*) AS games, AVG(surrendered::INT) AS surrender_rate
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY champion
ORDER BY surrender_rate DESC
LIMIT 10
RENDER leaderboard`,
  },
  {
    id: "champion-pool",
    category: "Champions",
    title: "Most-played champions",
    description: "Show which champions the server has been playing most.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY champion
ORDER BY games DESC
LIMIT 10
RENDER bar_chart WITH (y = games)`,
  },
  {
    id: "best-groups",
    category: "Groups",
    title: "Most active teammate groups",
    description:
      "List teammate groups of every size (group(2) picks duos only) by games together.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM player_groups
WHERE ${RELATIVE(30)}
GROUP BY group(all)
ORDER BY games DESC
LIMIT 10
RENDER leaderboard`,
  },
  {
    id: "kda-leaders",
    category: "Leaderboards",
    title: "KDA leaders",
    description: "Rank players by KDA with a minimum games filter.",
    query: `SELECT COUNT(*) AS games, kda() AS kda
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY player
HAVING games >= 5
ORDER BY kda DESC
LIMIT 10
RENDER leaderboard`,
  },
  {
    id: "damage-leaders",
    category: "Combat",
    title: "Damage leaders",
    description: "Find who dealt the most champion damage.",
    query: `SELECT COUNT(*) AS games, SUM(total_damage_dealt_to_champions) AS damage_to_champions
FROM match_participants
WHERE ${RELATIVE(14)}
GROUP BY player
ORDER BY damage_to_champions DESC
LIMIT 10
RENDER bar_chart WITH (y = damage_to_champions)`,
  },
  {
    id: "champion-select-picks",
    category: "Champions",
    title: "Champion-select picks",
    description: "Use lobby observations to see planned champion picks.",
    query: `SELECT COUNT(*) AS prematches
FROM prematch_participants
WHERE observed_at >= CURRENT_TIMESTAMP - INTERVAL 14 DAY
GROUP BY champion
ORDER BY prematches DESC
LIMIT 10
RENDER bar_chart WITH (y = prematches)`,
  },
  {
    id: "queue-mix",
    category: "Overview",
    title: "Queue mix",
    description: "Break recent server activity down by queue.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY queue
ORDER BY games DESC
RENDER table`,
  },
  {
    id: "daily-activity-trend",
    category: "Trends",
    title: "Daily activity trend",
    description: "Follow daily game volume with a smoothed filled trend.",
    query: `SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS games
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY DATE_TRUNC('day', game_creation_at)
ORDER BY day ASC
RENDER area_chart WITH (y = games, title = 'Daily games', palette = gold, smooth = true, trend = true, sparkline = true)`,
  },
  {
    id: "weekly-results",
    category: "Trends",
    title: "Weekly wins and losses",
    description: "Compare weekly wins and losses as stacked bars.",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) FILTER (WHERE win) AS wins, COUNT(*) FILTER (WHERE NOT win) AS losses
FROM match_participants
WHERE ${RELATIVE(90)}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER stacked_bar WITH (y = (wins, losses), palette = team, labels = value, compare = previous_period)`,
  },
  {
    id: "outcome-share",
    category: "Overview",
    title: "Win/loss share",
    description: "Show the share of recent games by outcome.",
    query: `SELECT COUNT(*) AS games
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY outcome
ORDER BY games DESC
RENDER donut_chart WITH (y = games, title = 'Recent outcomes', labels = percent)`,
  },
  {
    id: "combat-efficiency-scatter",
    category: "Combat",
    title: "Combat efficiency map",
    description: "Compare player damage per game with KDA and game volume.",
    query: `SELECT COUNT(*) AS games, AVG(total_damage_dealt_to_champions) AS damage_per_game, kda() AS kda
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY player
HAVING games >= 5
ORDER BY damage_per_game DESC
RENDER scatter_chart WITH (x = damage_per_game, y = kda, size = games, palette = colorblind)`,
  },
  {
    id: "champion-position-heatmap",
    category: "Champions",
    title: "Champion position heatmap",
    description: "Reveal champion win-rate pockets across team positions.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE ${RELATIVE(60)}
GROUP BY champion, team_position
HAVING games >= 3
ORDER BY games DESC
LIMIT 80
RENDER heatmap WITH (x = champion, series = team_position, value = win_rate, palette = ranked, labels = value)`,
  },
  {
    id: "champion-combat-radar",
    category: "Champions",
    title: "Champion combat profiles",
    description:
      "Compare per-game combat and vision profiles for active champions.",
    query: `SELECT COUNT(*) AS games, AVG(kills) AS kills_per_game, AVG(assists) AS assists_per_game, AVG(total_damage_dealt_to_champions) AS damage_per_game, AVG(vision_score) AS vision_per_game
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY champion
HAVING games >= 5
ORDER BY games DESC
LIMIT 6
RENDER radar_chart WITH (y = (kills_per_game, assists_per_game, damage_per_game, vision_per_game), legend = top, palette = categorical)`,
  },
  {
    id: "server-kpis",
    category: "Overview",
    title: "Server KPI snapshot",
    description:
      "Summarize activity, win rate, KDA, and game length in one card.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate, kda() AS kda, AVG(game_duration_seconds) AS avg_game_duration
FROM match_participants
WHERE ${RELATIVE(30)}
RENDER kpi_card WITH (y = (games, win_rate, kda, avg_game_duration), title = '30-day snapshot', theme = minimal_dark)`,
  },
  {
    id: "damage-gold-efficiency",
    category: "Economy",
    title: "Damage per gold",
    description: "Rank players by champion damage produced per gold earned.",
    query: `SELECT COUNT(*) AS games, ROUND(SUM(total_damage_dealt_to_champions) / NULLIF(SUM(gold_earned), 0), 3) AS damage_per_gold
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY player
HAVING games >= 5
ORDER BY damage_per_gold DESC
LIMIT 15
RENDER bar_chart WITH (y = damage_per_gold, orientation = horizontal, palette = gold, labels = value)`,
  },
  {
    id: "vision-trend",
    category: "Trends",
    title: "Weekly vision trend",
    description: "Track wards and vision score per game over time.",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, AVG(vision_score) AS vision_per_game, AVG(wards_placed) AS wards_per_game, AVG(wards_killed) AS wards_killed_per_game
FROM match_participants
WHERE ${RELATIVE(90)}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = (vision_per_game, wards_per_game, wards_killed_per_game), palette = colorblind, legend = bottom, smooth = true, rolling = 3)`,
  },
  {
    id: "arena-placement-share",
    category: "Arena",
    title: "Arena placement share",
    description: "Break Arena games down by final placement.",
    query: `SELECT COUNT(*) AS arena_games
FROM match_participants
WHERE queue = 'arena'
  AND ${RELATIVE(30)}
GROUP BY arena_placement
ORDER BY arena_placement ASC
RENDER donut_chart WITH (y = arena_games, palette = ranked, labels = percent)`,
  },
  {
    id: "objective-pressure",
    category: "Objectives",
    title: "Objective pressure leaders",
    description:
      "Combine objective and turret damage into a per-game pressure score.",
    query: `SELECT COUNT(*) AS games, AVG(damage_dealt_to_objectives + damage_dealt_to_turrets) AS objective_pressure
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY player
HAVING games >= 5
ORDER BY objective_pressure DESC
LIMIT 12
RENDER bar_chart WITH (y = objective_pressure, orientation = horizontal, palette = team)`,
  },
  {
    id: "first-blood-position",
    category: "Combat",
    title: "First blood by position",
    description: "Compare first-blood rates across team positions.",
    query: `SELECT COUNT(*) AS games, AVG(first_blood_kill::INT) AS first_blood_rate
FROM match_participants
WHERE ${RELATIVE(60)}
GROUP BY team_position
HAVING games >= 10
ORDER BY first_blood_rate DESC
RENDER bar_chart WITH (y = first_blood_rate, palette = ranked, labels = percent)`,
  },
  {
    id: "game-length-trend",
    category: "Trends",
    title: "Game length trend",
    description: "Track average match duration by week.",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, AVG(game_duration_seconds) AS avg_game_duration
FROM match_participants
WHERE ${RELATIVE(120)}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = avg_game_duration, title = 'Average game length', y_axis = 'Minutes', smooth = true, trend = true)`,
  },
  {
    id: "surrender-trend",
    category: "Behavior",
    title: "Surrender trend",
    description: "Follow total and early surrender rates by week.",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, AVG(surrendered::INT) AS surrender_rate, AVG(early_surrendered::INT) AS early_surrender_rate
FROM match_participants
WHERE ${RELATIVE(120)}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER area_chart WITH (y = (surrender_rate, early_surrender_rate), palette = colorblind, labels = hide, smooth = true, rolling = 3, compare = previous_period)`,
  },
  {
    id: "game-length-histogram",
    category: "Overview",
    title: "Game length distribution",
    description:
      "Show how recent games are distributed across five-minute length buckets.",
    query: `SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games
FROM match_participants
WHERE ${RELATIVE(30)}
GROUP BY FLOOR(game_duration_seconds / 300) * 300
ORDER BY bucket ASC
RENDER histogram WITH (x = bucket, y = games, x_axis = 'Game length (seconds)')`,
  },
  {
    id: "activity-versus-last-period",
    category: "Trends",
    title: "Activity against the previous period",
    description:
      "Overlay weekly game volume with the equally long span before it.",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
WHERE ${RELATIVE(56)}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = games, compare = previous_period, smooth = true)`,
  },
];

/** Title/query pairs, for surfaces that only offer a query to insert. */
export const SCOUTQL_PRESET_EXAMPLES: readonly {
  title: string;
  query: string;
}[] = SCOUTQL_PRESETS.map((preset) => ({
  title: preset.title,
  query: preset.query,
}));
