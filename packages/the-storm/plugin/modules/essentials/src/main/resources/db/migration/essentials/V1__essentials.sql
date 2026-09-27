-- Essentials: homes, warps, /back history, kit claims, teleport usage,
-- the moderation audit log and known players. Instants are epoch milliseconds.

CREATE TABLE essentials_players (
  player TEXT PRIMARY KEY NOT NULL,
  last_name TEXT NOT NULL,
  first_joined_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);

CREATE INDEX essentials_players_last_name ON essentials_players (last_name COLLATE NOCASE);

CREATE TABLE essentials_homes (
  player TEXT NOT NULL,
  name TEXT NOT NULL,
  world TEXT NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  z DOUBLE NOT NULL,
  yaw DOUBLE NOT NULL,
  pitch DOUBLE NOT NULL,
  PRIMARY KEY (player, name)
);

CREATE TABLE essentials_warps (
  name TEXT PRIMARY KEY NOT NULL,
  world TEXT NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  z DOUBLE NOT NULL,
  yaw DOUBLE NOT NULL,
  pitch DOUBLE NOT NULL
);

CREATE TABLE essentials_back_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  world TEXT NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  z DOUBLE NOT NULL,
  yaw DOUBLE NOT NULL,
  pitch DOUBLE NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN ('teleport', 'death')),
  at BIGINT NOT NULL
);

CREATE INDEX essentials_back_history_player ON essentials_back_history (player, id);

CREATE TABLE essentials_kit_claims (
  player TEXT NOT NULL,
  kit TEXT NOT NULL,
  claimed_at BIGINT NOT NULL,
  PRIMARY KEY (player, kit)
);

CREATE TABLE essentials_teleport_usage (
  player TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spawn', 'home', 'tpa', 'back', 'warp')),
  multiplier_hundredths BIGINT NOT NULL CHECK (multiplier_hundredths >= 100),
  last_used_at BIGINT NOT NULL,
  cooldown_until BIGINT NOT NULL,
  PRIMARY KEY (player, kind)
);

CREATE TABLE essentials_moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('kick', 'ban', 'unban')),
  actor TEXT,
  actor_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  at BIGINT NOT NULL,
  expires_at BIGINT
);

CREATE INDEX essentials_moderation_log_target ON essentials_moderation_log (target, id);
