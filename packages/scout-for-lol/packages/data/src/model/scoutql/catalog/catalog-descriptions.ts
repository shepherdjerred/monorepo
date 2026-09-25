/**
 * What every ScoutQL column means, in one sentence each.
 *
 * Split out of the catalog because it is a dictionary, not logic: it grows
 * with the lake schema and nothing here decides anything. `describe` throws on
 * a missing entry, so a column added to a lake map without a sentence fails
 * the build rather than reaching a model as a bare name.
 */

const DESCRIPTIONS: Record<string, string> = {
  match_id: "Riot match id (region-qualified).",
  game_id: "Riot numeric game id.",
  platform_id: "Riot platform shard (e.g. NA1).",
  game_creation_at: "When the lobby was created (UTC).",
  game_start_at: "When the game started (UTC).",
  game_end_at: "When the game ended (UTC).",
  game_duration_seconds: "Game length in seconds.",
  queue_id: "Riot numeric queue id.",
  queue: "Queue name (solo, flex, aram, …); NULL for unmapped queues.",
  game_mode: "Riot game mode (CLASSIC, ARAM, …).",
  game_type: "Riot game type (MATCHED_GAME, …).",
  game_version: "Full game version string (see the patch dimension).",
  end_of_game_result: "End-of-game result (GameComplete, or an abort state).",
  map_id: "Riot numeric map id.",
  puuid: "Riot player UUID for this participant.",
  participant_id: "Participant slot within the match (1–10).",
  team_id: "Team id (100 blue, 200 red).",
  riot_id_game_name: "Riot ID game name at match time.",
  riot_id_tagline: "Riot ID tagline at match time.",
  summoner_name: "Legacy summoner name.",
  champion_id: "Numeric champion id (compare with champion('Name')).",
  champion_name: "Champion Data-Dragon key name.",
  team_position: "Riot-assigned team position (TOP, JUNGLE, …).",
  individual_position: "Riot-computed most-likely position.",
  lane: "Reported lane.",
  role: "Reported role.",
  win: "Whether this participant won.",
  surrendered: "Whether this participant's team surrendered.",
  early_surrendered: "Whether the team surrendered early (remake window).",
  game_ended_in_surrender: "Whether the game ended in any surrender.",
  game_ended_in_early_surrender:
    "Whether the game ended in an early surrender.",
  team_early_surrendered: "Whether this participant's team early-surrendered.",
  kills: "Champion kills.",
  deaths: "Deaths.",
  assists: "Assists.",
  kda: "KDA for this game: (kills + assists) / max(deaths, 1).",
  creep_score: "Total creep score (lane + neutral minions).",
  total_minions_killed: "Lane minions killed.",
  neutral_minions_killed: "Neutral (jungle) minions killed.",
  gold_earned: "Gold earned.",
  gold_spent: "Gold spent.",
  total_damage_dealt: "Total damage dealt.",
  total_damage_dealt_to_champions: "Damage dealt to champions.",
  magic_damage_dealt_to_champions: "Magic damage dealt to champions.",
  physical_damage_dealt_to_champions: "Physical damage dealt to champions.",
  true_damage_dealt_to_champions: "True damage dealt to champions.",
  total_damage_taken: "Damage taken.",
  damage_self_mitigated: "Damage self-mitigated.",
  damage_dealt_to_objectives: "Damage dealt to objectives.",
  damage_dealt_to_turrets: "Damage dealt to turrets.",
  total_heal: "Total healing done.",
  total_heals_on_teammates: "Healing done to teammates.",
  vision_score: "Vision score.",
  wards_placed: "Wards placed.",
  wards_killed: "Wards killed.",
  vision_wards_bought_in_game: "Control wards bought.",
  detector_wards_placed: "Control wards placed.",
  all_in_pings: "All-in pings sent.",
  assist_me_pings: "Assist-me pings sent.",
  basic_pings: "Basic pings sent.",
  command_pings: "Command pings sent.",
  danger_pings: "Danger pings sent.",
  enemy_missing_pings: "Enemy-missing pings sent.",
  enemy_vision_pings: "Enemy-vision pings sent.",
  get_back_pings: "Get-back pings sent.",
  hold_pings: "Hold pings sent.",
  need_vision_pings: "Need-vision pings sent.",
  on_my_way_pings: "On-my-way pings sent.",
  push_pings: "Push pings sent.",
  vision_cleared_pings: "Vision-cleared pings sent.",
  double_kills: "Double kills.",
  triple_kills: "Triple kills.",
  quadra_kills: "Quadra kills.",
  penta_kills: "Penta kills.",
  largest_multi_kill: "Largest multikill.",
  killing_sprees: "Killing sprees.",
  first_blood_kill: "Whether this participant took first blood.",
  champ_level: "Final champion level.",
  champ_experience: "Final champion experience.",
  time_played: "Seconds played.",
  total_time_spent_dead: "Seconds spent dead.",
  longest_time_spent_living: "Longest time alive, in seconds.",
  time_ccing_others: "Seconds spent crowd-controlling others.",
  turret_kills: "Turrets destroyed.",
  inhibitor_kills: "Inhibitors destroyed.",
  baron_kills: "Barons killed.",
  dragon_kills: "Dragons killed.",
  placement: "Arena placement (NULL outside Arena).",
  subteam_placement: "Arena subteam placement (NULL outside Arena).",
  player_subteam_id: "Arena subteam id (NULL outside Arena).",
  item0:
    "Item id in inventory slot 1 when the game ended (0 is empty); the items column names the whole build.",
  item1: "Item id in inventory slot 2 when the game ended (0 is empty).",
  item2: "Item id in inventory slot 3 when the game ended (0 is empty).",
  item3: "Item id in inventory slot 4 when the game ended (0 is empty).",
  item4: "Item id in inventory slot 5 when the game ended (0 is empty).",
  item5: "Item id in inventory slot 6 when the game ended (0 is empty).",
  item6: "Trinket item id when the game ended (0 is empty).",
  summoner1_id: "First summoner spell id (the summoner1 column names it).",
  summoner2_id: "Second summoner spell id (the summoner2 column names it).",
  perk_primary_style:
    "Primary rune tree id (the primary_tree column names it). NULL without runes (Arena).",
  perk_sub_style:
    "Secondary rune tree id (the secondary_tree column names it).",
  perk0: "Keystone rune id (the keystone column names it).",
  perk1: "Second primary-tree rune id.",
  perk2: "Third primary-tree rune id.",
  perk3: "Fourth primary-tree rune id.",
  perk4: "First secondary-tree rune id.",
  perk5: "Second secondary-tree rune id.",
  stat_perk_offense: "Offense stat shard id.",
  stat_perk_flex: "Flex stat shard id.",
  stat_perk_defense: "Defense stat shard id.",
  observed_at: "When Scout observed the lobby (UTC).",
  riot_id: "Riot ID as observed in champion select.",
  selected_skin_index: "Selected skin index.",
  bot: "Whether the participant is a bot.",
};

/**
 * Column meanings that change with the source they sit on.
 *
 * `win`, `dragon_kills` and friends exist on both the participant and the team
 * table, and mean different things on each: one participant's dragons versus
 * the team's. Descriptions are keyed by column name alone, so a source whose
 * columns collide states its own wording here rather than silently inheriting
 * the participant reading.
 */
/**
 * Frame columns are snapshots at one minute of one game, which changes what
 * several shared names mean: `total_damage_taken` is damage taken so far,
 * not by the end, and `observed_at` is ingestion time, not a lobby.
 */
export const TIMELINE_FRAME_DESCRIPTIONS: Record<string, string> = {
  observed_at:
    "When Scout ingested this timeline (UTC) — not when the game was played; use game_creation_at for that.",
  frame_index: "Frame number within the game, normally one per minute from 0.",
  frame_timestamp_ms:
    "Game clock at this frame, in milliseconds (see the minute column).",
  participant_id: "Participant slot within the match (1–10).",
  position_x: "Map x coordinate at this frame.",
  position_y: "Map y coordinate at this frame.",
  current_gold: "Unspent gold at this frame.",
  total_gold: "Gold earned so far, spent or not, at this frame.",
  gold_per_second: "Passive gold income per second at this frame.",
  minions_killed: "Lane minions killed so far at this frame.",
  jungle_minions_killed: "Jungle monsters killed so far at this frame.",
  level: "Champion level at this frame.",
  xp: "Experience earned so far at this frame.",
  time_enemy_spent_controlled:
    "Seconds of crowd control applied to enemies so far.",
  ability_haste: "Ability haste at this frame.",
  ability_power: "Ability power at this frame.",
  armor: "Armor at this frame.",
  attack_damage: "Attack damage at this frame.",
  attack_speed: "Attack speed at this frame.",
  health: "Current health at this frame.",
  health_max: "Maximum health at this frame.",
  magic_resist: "Magic resist at this frame.",
  movement_speed: "Movement speed at this frame.",
  power: "Current mana or energy at this frame.",
  power_max: "Maximum mana or energy at this frame.",
  total_damage_done: "Total damage dealt so far at this frame.",
  total_damage_done_to_champions:
    "Damage dealt to champions so far at this frame.",
  total_damage_taken: "Damage taken so far at this frame.",
};

/**
 * Every event column, spelled out: an event row reuses names like `team_id`
 * and `level` with meanings that depend on the event type.
 */
export const TIMELINE_EVENT_DESCRIPTIONS: Record<string, string> = {
  event_id: "Scout's id for this event.",
  match_id: "Riot match id (region-qualified).",
  observed_at:
    "When Scout ingested this timeline (UTC) — not when the game was played; use game_creation_at for that.",
  frame_index: "Frame (minute) the event fell in.",
  event_index: "Order of the event within its frame.",
  frame_timestamp_ms:
    "Game clock at the start of the event's frame, in milliseconds.",
  event_timestamp_ms:
    "Game clock when the event happened, in milliseconds (see the minute column).",
  event_type:
    "What happened: CHAMPION_KILL, ELITE_MONSTER_KILL, BUILDING_KILL, ITEM_PURCHASED, SKILL_LEVEL_UP, WARD_PLACED, …",
  participant_id:
    "Participant slot the event is about, for purchases, level-ups and similar (1–10).",
  killer_id: "Participant slot that got the kill; 0 when it was not a player.",
  victim_id: "Participant slot that died, for champion kills.",
  creator_id: "Participant slot that placed a ward.",
  team_id:
    "For a building kill, the team that lost the building (100 blue, 200 red).",
  killer_team_id:
    "For a monster kill, the team that took it (100 blue, 200 red).",
  item_id: "Item bought, sold or undone.",
  after_id: "Item after an undo.",
  before_id: "Item before an undo.",
  skill_slot: "Ability levelled (1 Q, 2 W, 3 E, 4 R).",
  level: "Level reached, for a level-up.",
  bounty: "Gold bounty on a champion kill.",
  shutdown_bounty: "Shutdown gold on a champion kill.",
  kill_streak_length: "Victim's kill streak that was ended.",
  gold_gain: "Gold the event awarded.",
  position_x: "Map x coordinate of the event.",
  position_y: "Map y coordinate of the event.",
  ward_type: "Ward kind, for ward events.",
  building_type: "TOWER_BUILDING or INHIBITOR_BUILDING, for building kills.",
  lane_type: "Lane of a building kill.",
  tower_type: "Tower tier, for tower kills (OUTER_TURRET, INNER_TURRET, …).",
  monster_type:
    "DRAGON, BARON_NASHOR, RIFTHERALD, HORDE (void grubs) or ATAKHAN, for monster kills.",
  monster_sub_type:
    "Dragon kind — ELDER_DRAGON, or FIRE/WATER/EARTH/AIR/HEXTECH/CHEMTECH_DRAGON.",
  level_up_type: "How a skill was levelled.",
  winning_team_id: "Team that won, on the game-end event.",
  real_timestamp_ms:
    "Wall-clock time of the event, in milliseconds since the epoch.",
};

export const MATCH_TEAM_BAN_DESCRIPTIONS: Record<string, string> = {
  team_id: "The banning team (100 blue, 200 red).",
  pick_turn: "Which ban slot this was, in draft order (1-10).",
  champion_id:
    "Banned champion's numeric id (compare with champion('Name')); -1 is an unused ban slot.",
};

export const MATCH_TEAM_DESCRIPTIONS: Record<string, string> = {
  team_id: "Team id (100 blue, 200 red) — one row per team, two per match.",
  win: "Whether this team won.",
  baron_kills: "Barons this team killed.",
  first_baron: "Whether this team took the first baron.",
  champion_kills: "Champion kills by this team.",
  first_champion_kill: "Whether this team took first blood.",
  dragon_kills: "Dragons this team killed.",
  first_dragon: "Whether this team took the first dragon.",
  inhibitor_kills: "Inhibitors this team destroyed.",
  first_inhibitor: "Whether this team destroyed the first inhibitor.",
  rift_herald_kills: "Rift Heralds this team killed.",
  first_rift_herald: "Whether this team took the first Rift Herald.",
  tower_kills: "Towers this team destroyed.",
  first_tower: "Whether this team destroyed the first tower.",
  void_grub_kills: "Void Grubs this team killed.",
  first_void_grub: "Whether this team took the first Void Grub.",
  atakhan_kills: "Atakhans this team killed.",
  first_atakhan: "Whether this team took the first Atakhan.",
  epic_monster_feat_state:
    "Riot's feat-of-strength state for epic monsters (0 none, 1 in progress, 2 earned).",
  first_blood_feat_state:
    "Riot's first-blood feat state (0 none, 1 in progress, 2 earned).",
  first_turret_feat_state:
    "Riot's first-turret feat state (0 none, 1 in progress, 2 earned).",
};

export function describe(
  name: string,
  overrides: Record<string, string> | undefined,
): string {
  const description = overrides?.[name] ?? DESCRIPTIONS[name];
  if (description === undefined) {
    throw new Error(`Missing ScoutQL column description for "${name}".`);
  }
  return description;
}
