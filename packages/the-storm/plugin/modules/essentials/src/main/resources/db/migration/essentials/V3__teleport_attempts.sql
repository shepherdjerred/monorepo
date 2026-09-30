-- A charge is never attempted until this obligation is durable. Unknown outcomes
-- are reconciled from the keyed economy ledger on the next module start.
CREATE TABLE essentials_teleport_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  payer TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spawn', 'home', 'tpa', 'back', 'warp')),
  cost BIGINT NOT NULL CHECK (cost > 0)
);
