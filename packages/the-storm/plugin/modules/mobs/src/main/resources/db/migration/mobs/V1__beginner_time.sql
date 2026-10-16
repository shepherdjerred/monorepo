CREATE TABLE mobs_beginner_time (
  player TEXT PRIMARY KEY NOT NULL,
  active_ms INTEGER NOT NULL CHECK (active_ms >= 0)
);
