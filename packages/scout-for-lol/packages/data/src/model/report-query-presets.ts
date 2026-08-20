export type ReportExampleInfo = {
  title: string;
  query: string;
};

export type ReportCommonPresetInfo = ReportExampleInfo & {
  id: string;
  category?: string;
  description: string;
};

export const REPORT_COMMON_PRESETS: ReportCommonPresetInfo[] = [
  {
    id: "activity-leaders",
    category: "Leaderboards",
    title: "Most games played",
    description: "Find the most active players over the lookback window.",
    query:
      "select games, win_rate from match_participants group by player during last 30 days order by games desc limit 10 render leaderboard",
  },
  {
    id: "ranked-win-rate",
    category: "Leaderboards",
    title: "Best win rate (ranked solo, min 10 games)",
    description: "Rank players by solo queue win rate with a games floor.",
    query:
      "select games, win_rate from match_participants where queue in (solo) and games >= 10 group by player during last 30 days order by win_rate desc render bar_chart with (y = win_rate)",
  },
  {
    id: "surrender-watch",
    category: "Behavior",
    title: "Surrender-happy champions",
    description: "Spot champions most associated with surrender losses.",
    query:
      "select games, surrender_rate from match_participants group by champion during last 30 days order by surrender_rate desc limit 10 render leaderboard",
  },
  {
    id: "champion-pool",
    category: "Champions",
    title: "Most-played champions",
    description: "Show which champions the server has been playing most.",
    query:
      "select games, win_rate from match_participants group by champion during last 30 days order by games desc limit 10 render bar_chart with (y = games)",
  },
  {
    id: "best-groups",
    category: "Groups",
    title: "Most active teammate groups",
    description:
      "List teammate groups of every size (group(2) picks duos only) by games together.",
    query:
      "select games, win_rate from player_groups group by group(all) during last 30 days order by games desc limit 10 render leaderboard",
  },
  {
    id: "kda-leaders",
    category: "Leaderboards",
    title: "KDA leaders",
    description: "Rank players by KDA with a minimum games filter.",
    query:
      "select games, kda from match_participants where games >= 5 group by player during last 30 days order by kda desc limit 10 render leaderboard",
  },
  {
    id: "damage-leaders",
    category: "Combat",
    title: "Damage leaders",
    description: "Find who dealt the most champion damage.",
    query:
      "select games, damage_to_champions from match_participants group by player during last 14 days order by damage_to_champions desc limit 10 render bar_chart with (y = damage_to_champions)",
  },
  {
    id: "champion-select-picks",
    category: "Champions",
    title: "Champion-select picks",
    description: "Use lobby observations to see planned champion picks.",
    query:
      "select prematches from prematch_participants group by champion during last 14 days order by prematches desc limit 10 render bar_chart with (y = prematches)",
  },
  {
    id: "queue-mix",
    category: "Overview",
    title: "Queue mix",
    description: "Break recent server activity down by queue.",
    query:
      "select games, win_rate from match_participants group by queue during last 30 days order by games desc render table",
  },
  {
    id: "daily-activity-trend",
    category: "Trends",
    title: "Daily activity trend",
    description: "Follow daily game volume with a smoothed filled trend.",
    query:
      "select games from match_participants group by all analyze last 30 days bucket by day in time zone 'UTC' order by label asc render area_chart with (y = games, title = \"Daily games\", palette = gold, smooth = true, trend = true, sparkline = true)",
  },
  {
    id: "weekly-results",
    category: "Trends",
    title: "Weekly wins and losses",
    description: "Compare weekly wins and losses as stacked bars.",
    query:
      "select wins, losses from match_participants group by all analyze last 90 days bucket by week compare to previous period in time zone 'UTC' order by label asc render stacked_bar with (y = (wins, losses), palette = team, labels = value)",
  },
  {
    id: "outcome-share",
    category: "Overview",
    title: "Win/loss share",
    description: "Show the share of recent games by outcome.",
    query:
      'select games from match_participants group by outcome during last 30 days order by games desc render donut_chart with (y = games, title = "Recent outcomes", labels = percent)',
  },
  {
    id: "combat-efficiency-scatter",
    category: "Combat",
    title: "Combat efficiency map",
    description: "Compare player damage per game with KDA and game volume.",
    query:
      "select games, per_game(damage_to_champions) as damage_per_game, kda from match_participants group by player having games >= 5 during last 30 days order by damage_per_game desc render scatter_chart with (x = damage_per_game, y = kda, size = games, palette = colorblind)",
  },
  {
    id: "champion-position-heatmap",
    category: "Champions",
    title: "Champion position heatmap",
    description: "Reveal champion win-rate pockets across team positions.",
    query:
      "select games, win_rate from match_participants group by champion, team_position having games >= 3 during last 60 days order by games desc limit 80 render heatmap with (x = champion, series = team_position, value = win_rate, palette = ranked, labels = value)",
  },
  {
    id: "champion-combat-radar",
    category: "Champions",
    title: "Champion combat profiles",
    description:
      "Compare per-game combat and vision profiles for active champions.",
    query:
      "select games, per_game(kills) as kills_per_game, per_game(assists) as assists_per_game, per_game(damage_to_champions) as damage_per_game, per_game(vision_score) as vision_per_game from match_participants group by champion having games >= 5 during last 30 days order by games desc limit 6 render radar_chart with (y = (kills_per_game, assists_per_game, damage_per_game, vision_per_game), legend = top, palette = categorical)",
  },
  {
    id: "server-kpis",
    category: "Overview",
    title: "Server KPI snapshot",
    description:
      "Summarize activity, win rate, KDA, and game length in one card.",
    query:
      'select games, win_rate, kda, avg_game_duration from match_participants group by all during last 30 days render kpi_card with (y = (games, win_rate, kda, avg_game_duration), title = "30-day snapshot", theme = minimal_dark)',
  },
  {
    id: "damage-gold-efficiency",
    category: "Economy",
    title: "Damage per gold",
    description: "Rank players by champion damage produced per gold earned.",
    query:
      "select games, round(damage_to_champions / gold_earned, 3) as damage_per_gold from match_participants group by player having games >= 5 during last 30 days order by damage_per_gold desc limit 15 render bar_chart with (y = damage_per_gold, orientation = horizontal, palette = gold, labels = value)",
  },
  {
    id: "vision-trend",
    category: "Trends",
    title: "Weekly vision trend",
    description: "Track wards and vision score per game over time.",
    query:
      "select per_game(vision_score) as vision_per_game, per_game(wards_placed) as wards_per_game, per_game(wards_killed) as wards_killed_per_game from match_participants group by all analyze last 90 days bucket by week in time zone 'UTC' order by label asc render line_chart with (y = (vision_per_game, wards_per_game, wards_killed_per_game), palette = colorblind, legend = bottom, smooth = true, rolling = 3)",
  },
  {
    id: "arena-placement-share",
    category: "Arena",
    title: "Arena placement share",
    description: "Break Arena games down by final placement.",
    query:
      "select arena_games from match_participants group by arena_placement having arena_games >= 1 during last 30 days order by label asc render donut_chart with (y = arena_games, palette = ranked, labels = percent)",
  },
  {
    id: "objective-pressure",
    category: "Objectives",
    title: "Objective pressure leaders",
    description:
      "Combine objective and turret damage into a per-game pressure score.",
    query:
      "select games, per_game(damage_to_objectives + damage_to_turrets) as objective_pressure from match_participants group by player having games >= 5 during last 30 days order by objective_pressure desc limit 12 render bar_chart with (y = objective_pressure, orientation = horizontal, palette = team)",
  },
  {
    id: "first-blood-position",
    category: "Combat",
    title: "First blood by position",
    description: "Compare first-blood rates across team positions.",
    query:
      "select games, first_blood_rate from match_participants group by team_position having games >= 10 during last 60 days order by first_blood_rate desc render bar_chart with (y = first_blood_rate, palette = ranked, labels = percent)",
  },
  {
    id: "game-length-trend",
    category: "Trends",
    title: "Game length trend",
    description: "Track average match duration by week.",
    query:
      'select avg_game_duration from match_participants group by all analyze last 120 days bucket by week in time zone \'UTC\' order by label asc render line_chart with (y = avg_game_duration, title = "Average game length", y_axis = "Minutes", smooth = true, trend = true)',
  },
  {
    id: "surrender-trend",
    category: "Behavior",
    title: "Surrender trend",
    description: "Follow total and early surrender rates by week.",
    query:
      "select surrender_rate, early_surrender_rate from match_participants group by all analyze last 120 days bucket by week compare to previous period in time zone 'UTC' order by label asc render area_chart with (y = (surrender_rate, early_surrender_rate), palette = colorblind, labels = hide, smooth = true, rolling = 3)",
  },
];

export const REPORT_EXAMPLES: ReportExampleInfo[] = REPORT_COMMON_PRESETS.map(
  (preset) => ({ title: preset.title, query: preset.query }),
);
