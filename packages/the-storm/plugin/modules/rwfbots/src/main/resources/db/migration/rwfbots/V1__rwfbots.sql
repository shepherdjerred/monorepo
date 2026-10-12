-- rwfbots: each personality's record across matches and its place on the
-- shared OpenSkill ladder. Instants are epoch milliseconds.

CREATE TABLE rwfbots_personality_stats (
  personality_id TEXT PRIMARY KEY NOT NULL,
  matches INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  plants INTEGER NOT NULL,
  defuses INTEGER NOT NULL,
  mu DOUBLE NOT NULL,
  sigma DOUBLE NOT NULL,
  last_seen BIGINT NOT NULL
);
