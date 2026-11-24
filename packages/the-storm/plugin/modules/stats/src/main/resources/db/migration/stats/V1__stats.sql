-- Human player summaries, open session recovery state, and durable ingest outbox
-- for the stats module.

CREATE TABLE stats_player (
  player_uuid TEXT PRIMARY KEY NOT NULL,
  player_name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  first_seen_ms BIGINT NOT NULL,
  last_seen_ms BIGINT NOT NULL,
  connected_ms BIGINT NOT NULL,
  active_ms BIGINT NOT NULL,
  sessions_count INTEGER NOT NULL,
  pvp_kills INTEGER NOT NULL,
  pvp_deaths INTEGER NOT NULL,
  mob_kills INTEGER NOT NULL
);

CREATE INDEX idx_stats_player_name_lower ON stats_player (name_lower);

CREATE TABLE stats_open_session (
  session_id TEXT PRIMARY KEY NOT NULL,
  player_uuid TEXT NOT NULL,
  player_name TEXT NOT NULL,
  started_ms BIGINT NOT NULL,
  checkpoint_ms BIGINT NOT NULL,
  connected_ms BIGINT NOT NULL,
  active_ms BIGINT NOT NULL
);

CREATE TABLE stats_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  occurred_ms BIGINT NOT NULL,
  event_json TEXT NOT NULL
);
