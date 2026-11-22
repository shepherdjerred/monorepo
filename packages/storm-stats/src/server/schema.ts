import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  OnlinePlayerSummarySchema,
  TownSummarySnapshotSchema,
  type GameMode,
  type OnlinePlayerSummary,
  type TownSummarySnapshot,
  type WorldBucket,
} from "@shepherdjerred/storm-stats/shared/contract.ts";

export const WORLD_LABELS: Readonly<Record<WorldBucket, string>> = {
  world: "Overworld",
  world_nether: "The Nether",
  world_the_end: "The End",
  skylands: "Skylands",
  creative: "Creative",
  arena: "Mob Arena",
  rwf: "Race for Wool",
  other: "Other Worlds",
};

export const MODE_LABELS: Readonly<Record<GameMode, string>> = {
  survival: "Survival",
  creative: "Creative",
  arena: "Arena",
  rwf: "Race for Wool",
};

const OnlinePlayersArraySchema = z.array(OnlinePlayerSummarySchema);
const TownsArraySchema = z.array(TownSummarySnapshotSchema);
const NumberRecordSchema = z.record(z.string(), z.number().int().min(0));

export function parseOnlinePlayersJson(raw: string): OnlinePlayerSummary[] {
  const parsed: unknown = JSON.parse(raw);
  return OnlinePlayersArraySchema.parse(parsed);
}

export function parseTownsJson(raw: string): TownSummarySnapshot[] {
  const parsed: unknown = JSON.parse(raw);
  return TownsArraySchema.parse(parsed);
}

export function parseNumberRecordJson(raw: string): Record<string, number> {
  const parsed: unknown = JSON.parse(raw);
  return NumberRecordSchema.parse(parsed);
}

export type PlayerRow = {
  readonly uuid: string;
  readonly name: string;
  readonly name_lower: string;
  readonly nickname: string | null;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly platform: "java" | "bedrock";
  readonly client_version: string;
  readonly primary_group: string;
  readonly connected_ms: number;
  readonly active_ms: number;
  readonly sessions_count: number;
  readonly longest_session_ms: number;
  readonly ping_min_ms: number | null;
  readonly ping_sum_ms: number;
  readonly ping_count: number;
  readonly ping_max_ms: number | null;
  readonly pvp_kills: number;
  readonly pvp_deaths: number;
  readonly mob_kills: number;
  readonly mob_deaths: number;
  readonly env_deaths: number;
  readonly last_country_code: string | null;
  readonly last_country_name: string | null;
  readonly last_join_address: string | null;
  readonly bounces_count: number;
};

export type SessionRow = {
  readonly session_id: string;
  readonly player_uuid: string;
  readonly player_name: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly ongoing: number;
  readonly connected_ms: number;
  readonly active_ms: number;
  readonly interval_connected_ms: number;
  readonly interval_active_ms: number;
  readonly ended_connected_ms: number | null;
  readonly ended_active_ms: number | null;
  readonly platform: "java" | "bedrock";
  readonly client_version: string;
  readonly client_brand: string | null;
  readonly join_address: string | null;
  readonly country_code: string | null;
  readonly country_name: string | null;
  readonly ping_min_ms: number | null;
  readonly ping_avg_ms: number | null;
  readonly ping_max_ms: number | null;
  readonly interval_ping_sum_ms: number;
  readonly interval_ping_count: number;
  readonly end_reason: string | null;
  readonly pvp_kills: number;
  readonly mob_kills: number;
  readonly deaths: number;
};

export type PlayerGameplayRow = {
  readonly player_uuid: string;
  readonly player_name: string;
  readonly captured_at: string;
  readonly coins: number;
  readonly town_name: string | null;
  readonly town_role: string | null;
  readonly town_claims: number;
  readonly power_level: number;
  readonly top_skill: string | null;
  readonly top_skill_level: number;
  readonly skills_json: string;
  readonly tracks_json: string;
  readonly quests_completed: number;
  readonly arena_waves_json: string;
  readonly rwf_matches: number;
  readonly rwf_wins: number;
  readonly rwf_losses: number;
  readonly rwf_kills: number;
  readonly rwf_deaths: number;
};

export type ServerStateRow = {
  readonly id: number;
  readonly server_name: string;
  readonly last_ingest_at: string | null;
  readonly snapshot_captured_at: string | null;
  readonly max_players: number;
  readonly online_players_json: string;
  readonly peak_online_all_time: number;
  readonly peak_online_at: string | null;
  readonly towns_json: string;
};

const SCHEMA_DDL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  nickname TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'java',
  client_version TEXT NOT NULL DEFAULT 'unknown',
  primary_group TEXT NOT NULL DEFAULT 'default',
  connected_ms INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  sessions_count INTEGER NOT NULL DEFAULT 0,
  longest_session_ms INTEGER NOT NULL DEFAULT 0,
  ping_min_ms INTEGER,
  ping_sum_ms INTEGER NOT NULL DEFAULT 0,
  ping_count INTEGER NOT NULL DEFAULT 0,
  ping_max_ms INTEGER,
  pvp_kills INTEGER NOT NULL DEFAULT 0,
  pvp_deaths INTEGER NOT NULL DEFAULT 0,
  mob_kills INTEGER NOT NULL DEFAULT 0,
  mob_deaths INTEGER NOT NULL DEFAULT 0,
  env_deaths INTEGER NOT NULL DEFAULT 0,
  last_country_code TEXT,
  last_country_name TEXT,
  last_join_address TEXT,
  bounces_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_players_name_lower ON players(name_lower);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_first_seen ON players(first_seen_at ASC);
CREATE INDEX IF NOT EXISTS idx_players_active_ms ON players(active_ms DESC);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  player_uuid TEXT NOT NULL REFERENCES players(uuid) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  ongoing INTEGER NOT NULL DEFAULT 1,
  connected_ms INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  interval_connected_ms INTEGER NOT NULL DEFAULT 0,
  interval_active_ms INTEGER NOT NULL DEFAULT 0,
  ended_connected_ms INTEGER,
  ended_active_ms INTEGER,
  platform TEXT NOT NULL DEFAULT 'java',
  client_version TEXT NOT NULL DEFAULT 'unknown',
  client_brand TEXT,
  join_address TEXT,
  country_code TEXT,
  country_name TEXT,
  ping_min_ms INTEGER,
  ping_avg_ms INTEGER,
  ping_max_ms INTEGER,
  interval_ping_sum_ms INTEGER NOT NULL DEFAULT 0,
  interval_ping_count INTEGER NOT NULL DEFAULT 0,
  end_reason TEXT,
  pvp_kills INTEGER NOT NULL DEFAULT 0,
  mob_kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_uuid, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_join_address ON sessions(join_address);
CREATE INDEX IF NOT EXISTS idx_sessions_country ON sessions(country_code);

CREATE TABLE IF NOT EXISTS session_intervals (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  player_uuid TEXT NOT NULL REFERENCES players(uuid) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  pacific_day TEXT NOT NULL,
  pacific_dow INTEGER NOT NULL,
  pacific_hour INTEGER NOT NULL,
  world TEXT NOT NULL,
  mode TEXT NOT NULL,
  connected_ms INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  ping_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_intervals_day ON session_intervals(pacific_day);
CREATE INDEX IF NOT EXISTS idx_intervals_player_day ON session_intervals(player_uuid, pacific_day);
CREATE INDEX IF NOT EXISTS idx_intervals_started ON session_intervals(started_at);
CREATE INDEX IF NOT EXISTS idx_intervals_session ON session_intervals(session_id);
CREATE INDEX IF NOT EXISTS idx_intervals_dow_hour ON session_intervals(pacific_dow, pacific_hour);

CREATE TABLE IF NOT EXISTS combat_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  session_id TEXT,
  combat_kind TEXT NOT NULL,
  killer_uuid TEXT,
  killer_name TEXT,
  victim_uuid TEXT,
  victim_name TEXT,
  mob_type TEXT,
  weapon TEXT NOT NULL,
  world TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_combat_occurred ON combat_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_killer ON combat_events(killer_uuid);
CREATE INDEX IF NOT EXISTS idx_combat_victim ON combat_events(victim_uuid);
CREATE INDEX IF NOT EXISTS idx_combat_kind ON combat_events(combat_kind);

CREATE TABLE IF NOT EXISTS connection_bounces (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  player_uuid TEXT,
  player_name TEXT NOT NULL,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  join_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_bounces_occurred ON connection_bounces(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounces_player ON connection_bounces(player_uuid);
CREATE INDEX IF NOT EXISTS idx_bounces_category ON connection_bounces(category);

CREATE TABLE IF NOT EXISTS player_gameplay (
  player_uuid TEXT PRIMARY KEY REFERENCES players(uuid) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  town_name TEXT,
  town_role TEXT,
  town_claims INTEGER NOT NULL DEFAULT 0,
  power_level INTEGER NOT NULL DEFAULT 0,
  top_skill TEXT,
  top_skill_level INTEGER NOT NULL DEFAULT 0,
  skills_json TEXT NOT NULL DEFAULT '{}',
  tracks_json TEXT NOT NULL DEFAULT '{}',
  quests_completed INTEGER NOT NULL DEFAULT 0,
  arena_waves_json TEXT NOT NULL DEFAULT '{}',
  rwf_matches INTEGER NOT NULL DEFAULT 0,
  rwf_wins INTEGER NOT NULL DEFAULT 0,
  rwf_losses INTEGER NOT NULL DEFAULT 0,
  rwf_kills INTEGER NOT NULL DEFAULT 0,
  rwf_deaths INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_gameplay_coins ON player_gameplay(coins DESC);
CREATE INDEX IF NOT EXISTS idx_gameplay_power ON player_gameplay(power_level DESC);
CREATE INDEX IF NOT EXISTS idx_gameplay_town ON player_gameplay(town_name);

CREATE TABLE IF NOT EXISTS server_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_name TEXT NOT NULL DEFAULT 'The Storm',
  last_ingest_at TEXT,
  snapshot_captured_at TEXT,
  max_players INTEGER NOT NULL DEFAULT 64,
  online_players_json TEXT NOT NULL DEFAULT '[]',
  peak_online_all_time INTEGER NOT NULL DEFAULT 0,
  peak_online_at TEXT,
  towns_json TEXT NOT NULL DEFAULT '[]'
);

INSERT OR IGNORE INTO server_state (
  id, server_name, max_players, online_players_json, peak_online_all_time, towns_json
) VALUES (1, 'The Storm', 64, '[]', 0, '[]');

CREATE TABLE IF NOT EXISTS online_peaks (
  pacific_day TEXT PRIMARY KEY,
  peak_online INTEGER NOT NULL DEFAULT 0
);
`;

export function initializeSchema(db: Database): void {
  db.run(SCHEMA_DDL);
}
