CREATE TABLE essentials_staff_state (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE TABLE essentials_staff_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  command TEXT NOT NULL,
  targets TEXT NOT NULL,
  at TEXT NOT NULL
);
