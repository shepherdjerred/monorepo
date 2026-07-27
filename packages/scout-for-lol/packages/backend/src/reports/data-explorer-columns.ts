/**
 * Column catalogs for the report data explorer.
 *
 * Every column here must exist on the corresponding lake row schema
 * (`#src/report-lake/schema.ts`) — the explorer selects them verbatim from the
 * lake parquet. Internal/PII columns (puuid, game_id, platform_id, month,
 * dedupe_key, participant_id) are deliberately not exposed.
 *
 * `defaultVisible` marks the compact starter set the UI selects initially;
 * `group` drives the sectioned column picker.
 */

export type ExplorerColumnType = "string" | "number" | "boolean" | "timestamp";

export type ExplorerColumn = {
  id: string;
  label: string;
  type: ExplorerColumnType;
  description: string;
  group: string;
  defaultVisible: boolean;
};

type ColumnSpec = [
  id: string,
  label: string,
  type: ExplorerColumnType,
  description: string,
  defaultVisible?: boolean,
];

function columnGroup(group: string, specs: ColumnSpec[]): ExplorerColumn[] {
  return specs.map(([id, label, type, description, defaultVisible]) => ({
    id,
    label,
    type,
    description,
    group,
    defaultVisible: defaultVisible ?? false,
  }));
}

/**
 * Explorer columns that surface Riot account identity (game name / tagline /
 * summoner name). The player serializer redacts this data unless the caller has
 * `accounts:read`, so `browseData` applies the same gate when any of these is
 * selected, filtered, or sorted.
 */
export const ACCOUNT_IDENTITY_COLUMN_IDS: ReadonlySet<string> = new Set([
  "riot_id_game_name",
  "riot_id_tagline",
  "summoner_name",
  "riot_id",
]);

export const MATCH_COLUMNS: ExplorerColumn[] = [
  ...columnGroup("Core", [
    ["player_alias", "Player", "string", "Tracked Scout player.", true],
    [
      "game_creation_at",
      "Played at",
      "timestamp",
      "Match creation time.",
      true,
    ],
    ["queue", "Queue", "string", "Normalized queue type.", true],
    ["champion_name", "Champion", "string", "Champion display name.", true],
    ["win", "Win", "boolean", "Whether the player's team won.", true],
    ["kills", "Kills", "number", "Champion kills.", true],
    ["deaths", "Deaths", "number", "Champion deaths.", true],
    ["assists", "Assists", "number", "Champion assists.", true],
    ["kda", "KDA", "number", "(Kills + assists) / deaths."],
    [
      "creep_score",
      "Creep score",
      "number",
      "Minions and monsters killed.",
      true,
    ],
    [
      "total_damage_dealt_to_champions",
      "Champion damage",
      "number",
      "Damage dealt to enemy champions.",
      true,
    ],
    ["gold_earned", "Gold earned", "number", "Total gold earned.", true],
    ["vision_score", "Vision score", "number", "Vision score.", true],
  ]),
  ...columnGroup("Match", [
    ["match_id", "Match ID", "string", "Riot match identifier."],
    ["game_start_at", "Started at", "timestamp", "Game start time."],
    ["game_end_at", "Ended at", "timestamp", "Game end time."],
    [
      "game_duration_seconds",
      "Duration (s)",
      "number",
      "Game duration in seconds.",
    ],
    ["game_mode", "Game mode", "string", "Riot game mode."],
    ["game_type", "Game type", "string", "Riot game type."],
    ["game_version", "Patch", "string", "Full game version the match ran on."],
    ["map_id", "Map", "number", "Riot map identifier."],
    ["team_id", "Team", "number", "Riot team identifier (100 blue / 200 red)."],
  ]),
  ...columnGroup("Identity", [
    [
      "riot_id_game_name",
      "Riot ID name",
      "string",
      "Riot ID game name at match time.",
    ],
    [
      "riot_id_tagline",
      "Riot ID tag",
      "string",
      "Riot ID tagline at match time.",
    ],
    ["summoner_name", "Summoner name", "string", "Legacy summoner name."],
  ]),
  ...columnGroup("Position", [
    [
      "team_position",
      "Team position",
      "string",
      "Assigned team position (TOP/JUNGLE/…).",
    ],
    [
      "individual_position",
      "Individual position",
      "string",
      "Riot's best-guess individual position.",
    ],
    ["lane", "Lane", "string", "Reported lane."],
    ["role", "Role", "string", "Reported role."],
  ]),
  ...columnGroup("Outcome", [
    ["surrendered", "Surrendered", "boolean", "Player's team surrendered."],
    [
      "early_surrendered",
      "Early surrender",
      "boolean",
      "Player's team surrendered early.",
    ],
    [
      "game_ended_in_surrender",
      "Game ended in surrender",
      "boolean",
      "Either team surrendered.",
    ],
    [
      "game_ended_in_early_surrender",
      "Game ended in early surrender",
      "boolean",
      "Either team surrendered early (remake).",
    ],
    [
      "team_early_surrendered",
      "Team early surrender",
      "boolean",
      "Player's team early-surrendered.",
    ],
    [
      "first_blood_kill",
      "First blood",
      "boolean",
      "Player scored first blood.",
    ],
  ]),
  ...columnGroup("Farm & economy", [
    ["total_minions_killed", "Lane minions", "number", "Lane minions killed."],
    [
      "neutral_minions_killed",
      "Neutral monsters",
      "number",
      "Jungle monsters killed.",
    ],
    ["gold_spent", "Gold spent", "number", "Total gold spent."],
  ]),
  ...columnGroup("Damage & healing", [
    ["total_damage_dealt", "Total damage", "number", "Total damage dealt."],
    ["total_damage_taken", "Damage taken", "number", "Total damage taken."],
    [
      "damage_self_mitigated",
      "Damage mitigated",
      "number",
      "Damage mitigated on self.",
    ],
    [
      "damage_dealt_to_objectives",
      "Objective damage",
      "number",
      "Damage dealt to objectives.",
    ],
    [
      "damage_dealt_to_turrets",
      "Turret damage",
      "number",
      "Damage dealt to turrets.",
    ],
    ["total_heal", "Healing", "number", "Total healing done."],
    [
      "total_heals_on_teammates",
      "Ally healing",
      "number",
      "Healing done to teammates.",
    ],
  ]),
  ...columnGroup("Vision", [
    ["wards_placed", "Wards placed", "number", "Wards placed."],
    ["wards_killed", "Wards killed", "number", "Enemy wards destroyed."],
    [
      "vision_wards_bought_in_game",
      "Control wards bought",
      "number",
      "Control wards purchased.",
    ],
    [
      "detector_wards_placed",
      "Control wards placed",
      "number",
      "Control wards placed.",
    ],
  ]),
  ...columnGroup("Multikills", [
    ["double_kills", "Double kills", "number", "Double kills."],
    ["triple_kills", "Triple kills", "number", "Triple kills."],
    ["quadra_kills", "Quadra kills", "number", "Quadra kills."],
    ["penta_kills", "Penta kills", "number", "Penta kills."],
    [
      "largest_multi_kill",
      "Largest multikill",
      "number",
      "Largest multikill in the match.",
    ],
    ["killing_sprees", "Killing sprees", "number", "Killing sprees."],
  ]),
  ...columnGroup("Progression & time", [
    ["champ_level", "Final level", "number", "Champion level at game end."],
    ["champ_experience", "Experience", "number", "Champion experience earned."],
    ["time_played", "Time played (s)", "number", "Seconds played."],
    ["total_time_spent_dead", "Time dead (s)", "number", "Seconds spent dead."],
    [
      "longest_time_spent_living",
      "Longest life (s)",
      "number",
      "Longest time alive in seconds.",
    ],
    [
      "time_ccing_others",
      "CC time (s)",
      "number",
      "Seconds spent crowd-controlling enemies.",
    ],
  ]),
  ...columnGroup("Objectives", [
    ["turret_kills", "Turret kills", "number", "Turrets destroyed."],
    ["inhibitor_kills", "Inhibitor kills", "number", "Inhibitors destroyed."],
    ["baron_kills", "Baron kills", "number", "Barons slain."],
    ["dragon_kills", "Dragon kills", "number", "Dragons slain."],
  ]),
  ...columnGroup("Arena", [
    ["placement", "Arena placement", "number", "Final Arena placement."],
    [
      "subteam_placement",
      "Subteam placement",
      "number",
      "Arena subteam placement.",
    ],
    [
      "player_subteam_id",
      "Arena subteam",
      "number",
      "Arena subteam identifier.",
    ],
  ]),
];

export const PREMATCH_COLUMNS: ExplorerColumn[] = [
  ...columnGroup("Core", [
    ["player_alias", "Player", "string", "Tracked Scout player.", true],
    [
      "observed_at",
      "Observed at",
      "timestamp",
      "Lobby observation time.",
      true,
    ],
    ["queue", "Queue", "string", "Normalized queue type.", true],
    ["champion_id", "Champion ID", "number", "Selected champion ID.", true],
    // Not default-visible: it's an ACCOUNT_IDENTITY_COLUMN gated on
    // accounts:read, so auto-selecting it would 403 a reports:read-only caller
    // who never opted into Riot identity data.
    ["riot_id", "Riot ID", "string", "Observed Riot ID."],
    ["team_id", "Team", "number", "Riot team identifier.", true],
    ["game_mode", "Game mode", "string", "Riot game mode.", true],
  ]),
  ...columnGroup("Match", [
    [
      "game_start_at",
      "Started at",
      "timestamp",
      "Game start time, when known.",
    ],
    ["game_type", "Game type", "string", "Riot game type."],
    ["map_id", "Map", "number", "Riot map identifier."],
    [
      "summoner_name",
      "Summoner name",
      "string",
      "Legacy summoner name, when known.",
    ],
    [
      "selected_skin_index",
      "Skin index",
      "number",
      "Selected champion skin index.",
    ],
    ["bot", "Bot", "boolean", "Whether the participant is a bot."],
    [
      "player_subteam_id",
      "Arena subteam",
      "number",
      "Arena subteam identifier.",
    ],
  ]),
];
