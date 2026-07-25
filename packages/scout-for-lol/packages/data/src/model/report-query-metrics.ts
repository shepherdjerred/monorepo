import type { ReportMetric } from "#src/model/report-query-spec.ts";

export type ReportMetricKind = "count" | "rate" | "ratio" | "score";
export type ReportMetricInfo = {
  id: ReportMetric;
  label: string;
  description: string;
  kind: ReportMetricKind;
};

const METRIC_DATA: [ReportMetric, string, string, ReportMetricKind][] = [
  ["games", "Games", "Number of games played.", "count"],
  ["wins", "Wins", "Number of wins.", "count"],
  ["losses", "Losses", "Number of losses (games − wins).", "count"],
  [
    "surrenders",
    "Surrenders",
    "Number of games that ended in a surrender.",
    "count",
  ],
  [
    "surrender_rate",
    "Surrender rate",
    "Fraction of games that ended in a surrender (0–1).",
    "rate",
  ],
  ["win_rate", "Win rate", "Fraction of games won (0–1).", "rate"],
  ["kills", "Kills", "Total kills.", "count"],
  ["deaths", "Deaths", "Total deaths.", "count"],
  ["assists", "Assists", "Total assists.", "count"],
  [
    "kda",
    "KDA",
    "(kills + assists) / deaths (or takedowns when deaths = 0).",
    "ratio",
  ],
  [
    "creep_score",
    "Creep score",
    "Total minions/monsters killed (CS).",
    "count",
  ],
  [
    "damage_to_champions",
    "Damage to champions",
    "Total damage dealt to enemy champions.",
    "count",
  ],
  ["gold_earned", "Gold earned", "Total gold earned.", "count"],
  ["vision_score", "Vision score", "Total vision score.", "count"],
  ["damage_taken", "Damage taken", "Total damage taken.", "count"],
  [
    "total_damage_dealt",
    "Total damage",
    "Total damage dealt to all targets (not just champions).",
    "count",
  ],
  ["wards_placed", "Wards placed", "Total wards placed.", "count"],
  [
    "multikills",
    "Multikills",
    "Double + triple + quadra + penta kills combined.",
    "count",
  ],
  [
    "avg_game_duration",
    "Avg game length",
    "Average game duration in minutes.",
    "ratio",
  ],
  [
    "cs_per_minute",
    "CS / min",
    "Creep score per minute of time played.",
    "ratio",
  ],
  [
    "prematches",
    "Prematches",
    "Number of prematch observations (alias of games for prematch_participants).",
    "count",
  ],
  [
    "score",
    "Score",
    "Competition score / rank value (context-dependent for rank sources).",
    "score",
  ],
  ["early_surrenders", "Early surrenders", "Early surrender games.", "count"],
  [
    "early_surrender_rate",
    "Early surrender rate",
    "Fraction of games ended by early surrender.",
    "rate",
  ],
  ["lane_minions", "Lane minions", "Lane minions killed.", "count"],
  ["neutral_minions", "Neutral minions", "Neutral monsters killed.", "count"],
  ["gold_spent", "Gold spent", "Total gold spent.", "count"],
  ["damage_mitigated", "Damage mitigated", "Damage self-mitigated.", "count"],
  [
    "damage_to_objectives",
    "Objective damage",
    "Damage dealt to objectives.",
    "count",
  ],
  ["damage_to_turrets", "Turret damage", "Damage dealt to turrets.", "count"],
  ["healing", "Healing", "Total healing.", "count"],
  [
    "teammate_healing",
    "Teammate healing",
    "Healing applied to teammates.",
    "count",
  ],
  ["wards_killed", "Wards killed", "Enemy wards killed.", "count"],
  [
    "control_wards_bought",
    "Control wards bought",
    "Control wards purchased.",
    "count",
  ],
  [
    "detector_wards_placed",
    "Detector wards placed",
    "Detector wards placed.",
    "count",
  ],
  ["double_kills", "Double kills", "Double kills earned.", "count"],
  ["triple_kills", "Triple kills", "Triple kills earned.", "count"],
  ["quadra_kills", "Quadra kills", "Quadra kills earned.", "count"],
  ["penta_kills", "Penta kills", "Penta kills earned.", "count"],
  [
    "largest_multikill",
    "Largest multikill",
    "Largest multikill in one game.",
    "count",
  ],
  ["killing_sprees", "Killing sprees", "Killing sprees earned.", "count"],
  ["first_bloods", "First bloods", "First-blood kills.", "count"],
  [
    "first_blood_rate",
    "First-blood rate",
    "Fraction of games with first blood.",
    "rate",
  ],
  [
    "avg_champion_level",
    "Avg champion level",
    "Average end-of-game champion level.",
    "ratio",
  ],
  [
    "avg_champion_experience",
    "Avg champion XP",
    "Average end-of-game champion experience.",
    "ratio",
  ],
  ["time_dead_seconds", "Time dead", "Total seconds spent dead.", "count"],
  ["longest_life_seconds", "Longest life", "Longest life in seconds.", "count"],
  [
    "cc_time_seconds",
    "CC time",
    "Seconds spent crowd-controlling opponents.",
    "count",
  ],
  ["turret_kills", "Turret kills", "Turrets destroyed.", "count"],
  ["inhibitor_kills", "Inhibitor kills", "Inhibitors destroyed.", "count"],
  ["dragon_kills", "Dragon kills", "Dragons secured.", "count"],
  ["baron_kills", "Baron kills", "Barons secured.", "count"],
  ["arena_games", "Arena games", "Arena participant games.", "count"],
  ["average_placement", "Avg placement", "Average Arena placement.", "ratio"],
  [
    "top_two_rate",
    "Top-two rate",
    "Fraction of Arena games finishing top two.",
    "rate",
  ],
  [
    "first_place_rate",
    "First-place rate",
    "Fraction of Arena games won.",
    "rate",
  ],
];

export const REPORT_METRICS: ReportMetricInfo[] = METRIC_DATA.map(
  ([id, label, description, kind]) => ({ id, label, description, kind }),
);
