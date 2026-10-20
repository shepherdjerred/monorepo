-- Creative visit bodies. SURVIVAL is what the player left outside. CREATIVE is the
-- in-session body, kept only so a crash can resume that visit. A clean leave deletes
-- CREATIVE without adding it to SURVIVAL. Instants are epoch milliseconds.

CREATE TABLE creative_bodies (
  player TEXT NOT NULL,
  role TEXT NOT NULL,
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
  allow_flight BOOLEAN NOT NULL,
  flying BOOLEAN NOT NULL,
  fly_speed DOUBLE NOT NULL,
  maximum_no_damage_ticks INTEGER NOT NULL,
  vitals_version INTEGER NOT NULL,
  level INTEGER NOT NULL,
  progress DOUBLE NOT NULL,
  total_experience INTEGER NOT NULL,
  inventory BLOB NOT NULL,
  ender_chest BLOB NOT NULL,
  taken_at BIGINT NOT NULL,
  PRIMARY KEY (player, role)
);

CREATE TABLE creative_body_effects (
  player TEXT NOT NULL,
  role TEXT NOT NULL,
  position INTEGER NOT NULL,
  effect TEXT NOT NULL,
  amplifier INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  ambient BOOLEAN NOT NULL,
  particles BOOLEAN NOT NULL,
  icon BOOLEAN NOT NULL,
  PRIMARY KEY (player, role, position),
  FOREIGN KEY (player, role) REFERENCES creative_bodies (player, role) ON DELETE CASCADE
);
