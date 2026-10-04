CREATE TABLE npc_warning (
  world TEXT NOT NULL,
  npc TEXT NOT NULL,
  player_uuid TEXT NOT NULL,
  hits INTEGER NOT NULL CHECK (hits BETWEEN 1 AND 2),
  until_tick BIGINT NOT NULL CHECK (until_tick > 0),
  PRIMARY KEY (world, npc, player_uuid)
);
CREATE TABLE npc_wanted (
  world TEXT NOT NULL,
  player_uuid TEXT NOT NULL,
  until_tick BIGINT NOT NULL CHECK (until_tick > 0),
  PRIMARY KEY (world, player_uuid)
);
CREATE TABLE npc_death (
  npc TEXT NOT NULL PRIMARY KEY,
  world TEXT NOT NULL,
  until_tick BIGINT NOT NULL CHECK (until_tick > 0)
);
