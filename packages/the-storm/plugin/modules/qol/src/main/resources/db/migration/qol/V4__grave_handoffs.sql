-- Grave items remain in storage while a player-data handoff or expired-world
-- drop is in progress. The item row is deleted only after the recipient's
-- player data proves delivery; drop projections never own the stored copy.

-- This receipt survives deletion of an emptied grave so replay of an old
-- player-data death handoff can never recreate items already claimed.
CREATE TABLE qol_grave_creations (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL
);

INSERT INTO qol_grave_creations (id, owner)
SELECT id, owner FROM qol_graves;

CREATE TABLE qol_grave_claims (
  grave TEXT NOT NULL,
  idx INTEGER NOT NULL,
  token TEXT NOT NULL,
  taker TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (grave, idx),
  FOREIGN KEY (grave, idx) REFERENCES qol_grave_items (grave, idx) ON DELETE CASCADE
);

CREATE INDEX qol_grave_claims_taker ON qol_grave_claims (taker, token);

-- One row records that expiry was committed and its owner notice created.
CREATE TABLE qol_grave_expiries (
  grave TEXT PRIMARY KEY,
  expired_at BIGINT NOT NULL,
  FOREIGN KEY (grave) REFERENCES qol_graves (id) ON DELETE CASCADE
);

-- One row means this item has been offered on the ground. The actual
-- ItemDisplay is a replaceable projection and may be recreated after a crash.
CREATE TABLE qol_grave_drops (
  grave TEXT NOT NULL,
  idx INTEGER NOT NULL,
  world TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  owner_only INTEGER NOT NULL CHECK (owner_only IN (0, 1)),
  PRIMARY KEY (grave, idx),
  FOREIGN KEY (grave, idx) REFERENCES qol_grave_items (grave, idx) ON DELETE CASCADE
);
