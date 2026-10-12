-- Discord accounts linked to Minecraft players. Player ids are UUID strings;
-- Discord user ids are snowflakes as text; instants are epoch milliseconds.
-- A player and a Discord user each have at most one link.

CREATE TABLE discord_link (
  player TEXT PRIMARY KEY NOT NULL,
  discord_user TEXT NOT NULL UNIQUE,
  dms BOOLEAN NOT NULL,
  linked_ms BIGINT NOT NULL
);
