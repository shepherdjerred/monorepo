CREATE TABLE arena_survival_credits (
  player TEXT NOT NULL,
  run TEXT NOT NULL,
  event TEXT NOT NULL,
  xp BIGINT NOT NULL CHECK (xp > 0),
  PRIMARY KEY (player, run, event)
);
