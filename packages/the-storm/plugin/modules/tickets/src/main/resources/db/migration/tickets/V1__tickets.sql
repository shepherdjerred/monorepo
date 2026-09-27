-- Player report tickets. Player ids are UUID strings; instants are epoch
-- milliseconds. Ids are assigned by the store as one past the current
-- maximum, inside the single writer transaction.

CREATE TABLE ticket (
  id INTEGER PRIMARY KEY NOT NULL,
  reporter TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  summary TEXT NOT NULL,
  world TEXT,
  x INTEGER,
  y INTEGER,
  z INTEGER,
  created_ms BIGINT NOT NULL,
  updated_ms BIGINT NOT NULL,
  claimer TEXT
);

-- Follow-ups on a ticket, oldest first by id.
CREATE TABLE ticket_comment (
  id INTEGER PRIMARY KEY NOT NULL,
  ticket_id INTEGER NOT NULL REFERENCES ticket (id),
  author TEXT NOT NULL,
  staff_only INTEGER NOT NULL,
  body TEXT NOT NULL,
  at_ms BIGINT NOT NULL
);

-- The agent's working of a ticket; a re-triage replaces the row.
CREATE TABLE ticket_triage (
  ticket_id INTEGER PRIMARY KEY NOT NULL REFERENCES ticket (id),
  priority TEXT NOT NULL,
  evidence TEXT NOT NULL,
  draft_reply TEXT NOT NULL,
  at_ms BIGINT NOT NULL
);

-- Likely-duplicate tickets named by a triage.
CREATE TABLE ticket_triage_duplicate (
  ticket_id INTEGER NOT NULL REFERENCES ticket (id),
  duplicate_id INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, duplicate_id)
);
