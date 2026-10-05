-- Previous records cannot reconstruct individual trips. Preserve the longest
-- cooldown, while starting the new rolling history empty once on rollout.
CREATE TABLE essentials_teleport_state (
  player TEXT PRIMARY KEY NOT NULL,
  cooldown_until BIGINT NOT NULL
);
INSERT INTO essentials_teleport_state (player, cooldown_until)
SELECT player, MAX(cooldown_until) FROM essentials_teleport_usage GROUP BY player;
DROP TABLE essentials_teleport_usage;

CREATE TABLE essentials_teleport_uses (
  id TEXT PRIMARY KEY NOT NULL,
  player TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spawn', 'home', 'tpa', 'back', 'warp', 'rtp')),
  half_points INTEGER NOT NULL CHECK (half_points > 0),
  completed_at BIGINT NOT NULL
);
CREATE INDEX essentials_teleport_uses_player_time
ON essentials_teleport_uses (player, completed_at);

-- SQLite needs a table rebuild to widen the existing kind constraint.
ALTER TABLE essentials_teleport_attempts RENAME TO essentials_teleport_attempts_old;
CREATE TABLE essentials_teleport_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  payer TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spawn', 'home', 'tpa', 'back', 'warp', 'rtp')),
  cost BIGINT NOT NULL CHECK (cost > 0)
);
INSERT INTO essentials_teleport_attempts SELECT * FROM essentials_teleport_attempts_old;
DROP TABLE essentials_teleport_attempts_old;
