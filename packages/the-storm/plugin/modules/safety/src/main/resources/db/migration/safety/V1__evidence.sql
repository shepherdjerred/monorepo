CREATE TABLE safety_submission (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  name TEXT NOT NULL,
  surface TEXT NOT NULL,
  audience TEXT NOT NULL,
  object_ref TEXT NOT NULL,
  original_text TEXT NOT NULL,
  components TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX safety_player_time ON safety_submission(player, created_at);
CREATE INDEX safety_surface_time ON safety_submission(surface, created_at);
CREATE INDEX safety_audience_time ON safety_submission(audience, created_at);
CREATE TABLE safety_event (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES safety_submission(id),
  outcome TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX safety_event_submission ON safety_event(submission_id, sequence);
