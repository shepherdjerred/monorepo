-- Red Warfare statistics and match history.
--
-- rwf_match and rwf_match_player gain the details of how each match was
-- played. The new columns are NULL for matches finished before this migration:
-- those details were never measured, and NULL says so rather than inventing a
-- zero. Instants are epoch milliseconds and durations milliseconds.
ALTER TABLE rwf_match ADD COLUMN seed BIGINT;
ALTER TABLE rwf_match ADD COLUMN duration_ms BIGINT;
-- LAST_TEAM_STANDING, DRAW or STOPPED.
ALTER TABLE rwf_match ADD COLUMN end_reason TEXT;
-- The vote as JSON: {"candidates": [...], "votes": {"map": n}, "chosen": "map"}.
ALTER TABLE rwf_match ADD COLUMN ballot TEXT;
ALTER TABLE rwf_match ADD COLUMN map_hash TEXT;

ALTER TABLE rwf_match_player ADD COLUMN assists INTEGER;
ALTER TABLE rwf_match_player ADD COLUMN damage_dealt DOUBLE;
ALTER TABLE rwf_match_player ADD COLUMN damage_taken DOUBLE;
ALTER TABLE rwf_match_player ADD COLUMN arms INTEGER;
ALTER TABLE rwf_match_player ADD COLUMN defuses INTEGER;
-- Bombs this player helped arm that went off.
ALTER TABLE rwf_match_player ADD COLUMN explosions INTEGER;
-- Whole killstreak steps reached.
ALTER TABLE rwf_match_player ADD COLUMN streaks_earned INTEGER;
ALTER TABLE rwf_match_player ADD COLUMN ability_uses INTEGER;
ALTER TABLE rwf_match_player ADD COLUMN shots_fired INTEGER;
ALTER TABLE rwf_match_player ADD COLUMN shots_hit INTEGER;
ALTER TABLE rwf_match_player ADD COLUMN steaks INTEGER;
ALTER TABLE rwf_match_player ADD COLUMN time_alive_ms BIGINT;
-- Blocks walked while alive in the live match.
ALTER TABLE rwf_match_player ADD COLUMN distance DOUBLE;
ALTER TABLE rwf_match_player ADD COLUMN kit_switches INTEGER;
-- Red Warfare's AFK mark; NULL until the AFK check records it.
ALTER TABLE rwf_match_player ADD COLUMN afk BOOLEAN;

-- What happened in each match, append-only and in order: kills, deaths, arms,
-- defuses, explosions and the vote. Players are UUIDs; data is a JSON object
-- with whatever else the kind carries (assist shares, weapon, distance).
CREATE TABLE rwf_match_event (
  match_id TEXT NOT NULL REFERENCES rwf_match (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at BIGINT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT,
  target TEXT,
  kit TEXT,
  cause TEXT,
  x DOUBLE,
  y DOUBLE,
  z DOUBLE,
  data TEXT NOT NULL,
  PRIMARY KEY (match_id, seq)
);

-- Each human's lifetime totals, as Red Warfare's GameStatsManager counted
-- them: the best streak is the most whole killstreak steps reached in one
-- match, time is time spent in live matches.
CREATE TABLE rwf_player_stats (
  player TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  matches INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  suicides INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  win_streak INTEGER NOT NULL,
  best_win_streak INTEGER NOT NULL,
  best_streak INTEGER NOT NULL,
  time_ms BIGINT NOT NULL,
  steaks INTEGER NOT NULL
);

CREATE INDEX rwf_player_stats_kills ON rwf_player_stats (kills);
CREATE INDEX rwf_player_stats_wins ON rwf_player_stats (wins);

-- The same totals per kit.
CREATE TABLE rwf_player_kit_stats (
  player TEXT NOT NULL,
  kit TEXT NOT NULL,
  matches INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  suicides INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  best_streak INTEGER NOT NULL,
  time_ms BIGINT NOT NULL,
  steaks INTEGER NOT NULL,
  PRIMARY KEY (player, kit)
);

-- Each human's choices that outlast a match. kit_layouts is a JSON object of
-- kit id to slot order; empty until saved layouts arrive.
CREATE TABLE rwf_player_prefs (
  player TEXT PRIMARY KEY NOT NULL,
  last_kit TEXT,
  team_chat BOOLEAN NOT NULL,
  kit_layouts TEXT NOT NULL
);

-- Maps an operator took out of the rotation with /rwf admin quarantine, kept
-- across restarts until /rwf admin unquarantine. rwf.yml's quarantine stays
-- the repository's record; these are the operator's live decisions.
CREATE TABLE rwf_map_quarantine (
  map_id TEXT PRIMARY KEY NOT NULL,
  reason TEXT NOT NULL,
  quarantined_by TEXT NOT NULL,
  quarantined_at BIGINT NOT NULL
);
