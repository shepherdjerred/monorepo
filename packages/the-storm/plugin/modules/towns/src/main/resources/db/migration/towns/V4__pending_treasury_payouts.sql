CREATE TABLE towns_pending_payout (
  town_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  transfer_key TEXT NOT NULL UNIQUE
);
