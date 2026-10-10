CREATE TABLE core_analytics_player (
  player_uuid TEXT NOT NULL,
  stage TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (player_uuid, stage)
);

CREATE TABLE core_analytics_session (
  session_id TEXT PRIMARY KEY NOT NULL,
  stage TEXT NOT NULL,
  player_uuid TEXT NOT NULL,
  player_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  checkpoint_at INTEGER NOT NULL,
  connected_ms INTEGER NOT NULL CHECK (connected_ms >= 0),
  active_ms INTEGER NOT NULL CHECK (active_ms >= 0 AND active_ms <= connected_ms),
  ended INTEGER NOT NULL CHECK (ended IN (0, 1))
);
CREATE INDEX core_analytics_session_open ON core_analytics_session (ended);

CREATE TABLE core_analytics_outbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  stage TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX core_analytics_outbox_time ON core_analytics_outbox (occurred_at);
