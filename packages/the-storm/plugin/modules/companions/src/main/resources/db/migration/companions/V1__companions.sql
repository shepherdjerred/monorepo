CREATE TABLE companion_state (
  id TEXT NOT NULL PRIMARY KEY,
  npc_uuid TEXT NOT NULL UNIQUE,
  snapshot BLOB NOT NULL,
  pending TEXT
);
