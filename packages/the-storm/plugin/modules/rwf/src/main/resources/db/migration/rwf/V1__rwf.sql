-- Red Warfare Search and Destroy: snapshots of players inside a match (restored
-- on leave, or on their next join after a crash), finished matches, who fought
-- in them with the payout outbox, and each player's daily match earnings.
-- Instants are epoch milliseconds; days are ISO dates in the configured zone.

CREATE TABLE rwf_snapshots (
  player TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  world TEXT NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  z DOUBLE NOT NULL,
  yaw DOUBLE NOT NULL,
  pitch DOUBLE NOT NULL,
  health DOUBLE NOT NULL,
  food INTEGER NOT NULL,
  saturation DOUBLE NOT NULL,
  exhaustion DOUBLE NOT NULL,
  game_mode TEXT NOT NULL,
  level INTEGER NOT NULL,
  progress DOUBLE NOT NULL,
  total_experience INTEGER NOT NULL,
  inventory BLOB NOT NULL,
  taken_at BIGINT NOT NULL,
  -- Set once the player has been restored; the row is deleted after a later
  -- login proves the restored inventory reached player data.
  restored_at BIGINT
);

CREATE TABLE rwf_snapshot_effects (
  player TEXT NOT NULL REFERENCES rwf_snapshots (player) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  effect TEXT NOT NULL,
  amplifier INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  ambient BOOLEAN NOT NULL,
  particles BOOLEAN NOT NULL,
  icon BOOLEAN NOT NULL,
  PRIMARY KEY (player, position)
);

CREATE TABLE rwf_match (
  id TEXT PRIMARY KEY NOT NULL,
  map TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL,
  winner TEXT,
  humans INTEGER NOT NULL,
  bots INTEGER NOT NULL,
  recording_file TEXT,
  recording_bytes BIGINT NOT NULL,
  dropped_frames INTEGER NOT NULL
);

-- The payout outbox: a human's credits wait here until the economy ledger
-- confirms the keyed transfer rwf:<match>:<player>.
CREATE TABLE rwf_match_player (
  match_id TEXT NOT NULL REFERENCES rwf_match (id) ON DELETE CASCADE,
  player TEXT NOT NULL,
  team TEXT NOT NULL,
  kit TEXT NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  result TEXT NOT NULL,
  credits_owed BIGINT NOT NULL,
  payout_status TEXT NOT NULL,
  credits_paid BIGINT NOT NULL,
  PRIMARY KEY (match_id, player)
);

CREATE INDEX rwf_match_player_status ON rwf_match_player (payout_status);

CREATE TABLE rwf_daily_earnings (
  player TEXT NOT NULL,
  day TEXT NOT NULL,
  credits BIGINT NOT NULL,
  PRIMARY KEY (player, day)
);
