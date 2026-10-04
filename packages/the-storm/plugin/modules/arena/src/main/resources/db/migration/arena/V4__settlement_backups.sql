CREATE TABLE arena_settlement_backups (
  token TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  changes BLOB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'RESTORING', 'RESTORED'))
);
