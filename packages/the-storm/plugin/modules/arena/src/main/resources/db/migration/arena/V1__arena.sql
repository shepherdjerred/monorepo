-- Arena: snapshots of players inside an arena (restored on leave, or on their
-- next join after a crash), the best-wave leaderboard, vault claims, and vault
-- loot waiting to be handed out. Instants are epoch milliseconds.

CREATE TABLE arena_snapshots (
  player TEXT PRIMARY KEY NOT NULL,
  arena TEXT NOT NULL,
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
  taken_at BIGINT NOT NULL
);

CREATE TABLE arena_snapshot_effects (
  player TEXT NOT NULL REFERENCES arena_snapshots (player) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  effect TEXT NOT NULL,
  amplifier INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  ambient BOOLEAN NOT NULL,
  particles BOOLEAN NOT NULL,
  icon BOOLEAN NOT NULL,
  PRIMARY KEY (player, position)
);

CREATE TABLE arena_best_waves (
  player TEXT NOT NULL,
  arena TEXT NOT NULL,
  name TEXT NOT NULL,
  best_wave INTEGER NOT NULL,
  reached_at BIGINT NOT NULL,
  PRIMARY KEY (player, arena)
);

CREATE INDEX arena_best_waves_rank ON arena_best_waves (arena, best_wave DESC, reached_at);

-- One vault per player per milestone wave per day, across every arena.
CREATE TABLE arena_vault_claims (
  player TEXT NOT NULL,
  wave INTEGER NOT NULL,
  day TEXT NOT NULL,
  claimed_at BIGINT NOT NULL,
  PRIMARY KEY (player, wave, day)
);

-- Vault loot is handed out once the player is out of the arena and restored.
CREATE TABLE arena_pending_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  reason TEXT NOT NULL,
  items BLOB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX arena_pending_rewards_player ON arena_pending_rewards (player);
