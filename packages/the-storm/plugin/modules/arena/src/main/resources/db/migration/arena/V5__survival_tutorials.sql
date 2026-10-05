CREATE TABLE arena_survival_tips (
  player TEXT NOT NULL,
  topic TEXT NOT NULL,
  PRIMARY KEY (player, topic)
);
CREATE TABLE arena_survival_tip_preferences (
  player TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);
