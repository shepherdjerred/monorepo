-- Red Warfare's kit shop: the kits each player owns, and the purchase outbox.
--
-- A purchase is first a PENDING row; its id is also the economy's idempotency
-- key for the rwf_credits transfer from the player to the server. Once the
-- ledger holds that receipt the row turns GRANTED in the same transaction that
-- inserts the ownership, and a purchase the ledger never took turns CANCELLED.
-- A crash between the two leaves the row PENDING; on the next start a receipt
-- grants it and no receipt cancels it, so a player is never charged without
-- the kit. Instants are epoch milliseconds.

CREATE TABLE rwf_kit_owned (
  player TEXT NOT NULL,
  kit TEXT NOT NULL,
  acquired_at BIGINT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('PURCHASE', 'GRANT')),
  PRIMARY KEY (player, kit)
);

CREATE TABLE rwf_kit_purchase (
  id TEXT PRIMARY KEY NOT NULL,
  player TEXT NOT NULL,
  kit TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'rwf_credits'),
  price BIGINT NOT NULL CHECK (price > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'GRANTED', 'CANCELLED')),
  created_at BIGINT NOT NULL,
  settled_at BIGINT
);

-- At most one purchase of a kit in flight per player.
CREATE UNIQUE INDEX rwf_kit_purchase_pending
  ON rwf_kit_purchase (player, kit)
  WHERE status = 'PENDING';
