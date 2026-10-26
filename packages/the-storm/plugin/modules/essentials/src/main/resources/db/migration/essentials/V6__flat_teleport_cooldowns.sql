-- Each command keeps its own cooldown. An in-flight shared cooldown still
-- applies to every command until it ends.
CREATE TABLE essentials_teleport_cooldowns (
  player TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spawn', 'home', 'tpa', 'back', 'warp', 'rtp')),
  cooldown_until BIGINT NOT NULL,
  PRIMARY KEY (player, kind)
);

INSERT INTO essentials_teleport_cooldowns (player, kind, cooldown_until)
SELECT player, 'spawn', cooldown_until FROM essentials_teleport_state
UNION ALL
SELECT player, 'home', cooldown_until FROM essentials_teleport_state
UNION ALL
SELECT player, 'tpa', cooldown_until FROM essentials_teleport_state
UNION ALL
SELECT player, 'back', cooldown_until FROM essentials_teleport_state
UNION ALL
SELECT player, 'warp', cooldown_until FROM essentials_teleport_state
UNION ALL
SELECT player, 'rtp', cooldown_until FROM essentials_teleport_state;

CREATE TABLE essentials_teleport_confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  player TEXT NOT NULL,
  kind TEXT NOT NULL,
  cooldown_until BIGINT NOT NULL
);

ALTER TABLE essentials_players ADD COLUMN return_charges INTEGER;
