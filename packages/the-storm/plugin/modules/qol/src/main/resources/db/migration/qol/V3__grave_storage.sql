-- Old grave items live only in world chests and cannot be reconstructed from
-- SQL. Stop this migration until every V1 chest has been collected or expired
-- under the old implementation. Flyway rolls back the guard if it fails.
CREATE TABLE qol_legacy_grave_guard (
  empty INTEGER NOT NULL CONSTRAINT legacy_graves_must_be_collected CHECK (empty = 0)
);

INSERT INTO qol_legacy_grave_guard (empty)
SELECT COUNT(*) FROM qol_grave;

DROP TABLE qol_legacy_grave_guard;

-- New graves keep their items in SQLite. Keep V1's empty legacy table and
-- migration checksum intact.
CREATE TABLE qol_graves (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  world TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  replaced_block TEXT NOT NULL,
  UNIQUE (world, x, y, z)
);

CREATE INDEX qol_graves_owner ON qol_graves (owner);

CREATE TABLE qol_grave_items (
  grave TEXT NOT NULL REFERENCES qol_graves (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  slot INTEGER,
  item BLOB NOT NULL,
  PRIMARY KEY (grave, idx)
);

CREATE TABLE qol_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX qol_notices_player ON qol_notices (player, id);
