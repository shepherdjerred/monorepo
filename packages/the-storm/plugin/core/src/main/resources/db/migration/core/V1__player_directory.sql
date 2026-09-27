CREATE TABLE core_player (
  uuid TEXT PRIMARY KEY NOT NULL,
  last_name TEXT NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX core_player_last_name ON core_player (lower(last_name));
