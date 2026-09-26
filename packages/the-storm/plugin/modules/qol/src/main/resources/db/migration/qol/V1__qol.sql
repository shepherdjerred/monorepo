-- Graves: where each one stands, the block it replaced and the items it holds.
-- The database, not the grave block, owns the items, so a lost block never
-- loses them. Instants are epoch milliseconds.

CREATE TABLE qol_graves (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  world TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  -- Block data string of what the grave replaced, put back when it goes.
  replaced_block TEXT NOT NULL,
  UNIQUE (world, x, y, z)
);

CREATE INDEX qol_graves_owner ON qol_graves (owner);

-- One row per stack. idx orders a grave's stacks; slot is the inventory slot the
-- stack was in when its owner died (NULL for drops that were in no slot).
CREATE TABLE qol_grave_items (
  grave TEXT NOT NULL REFERENCES qol_graves (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  slot INTEGER,
  item BLOB NOT NULL,
  PRIMARY KEY (grave, idx)
);

-- Messages for players who were offline when something happened to their
-- graves, delivered and deleted when they next join.
CREATE TABLE qol_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX qol_notices_player ON qol_notices (player, id);
