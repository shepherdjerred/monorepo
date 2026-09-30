-- Every decision the AI staff member made. Player ids are UUID strings;
-- instants are epoch milliseconds. Ids are assigned by the store as one
-- past the current maximum, inside the single writer transaction.

CREATE TABLE agent_decision (
  id INTEGER PRIMARY KEY NOT NULL,
  at_ms BIGINT NOT NULL,
  player TEXT NOT NULL,
  offense TEXT NOT NULL,
  ticket_id INTEGER,
  classification TEXT NOT NULL,
  confidence DOUBLE NOT NULL,
  model TEXT NOT NULL,
  action TEXT NOT NULL,
  shadow INTEGER NOT NULL,
  ladder_step INTEGER,
  cost_micros BIGINT NOT NULL,
  note TEXT NOT NULL,
  overturned_by TEXT,
  overturned_ms BIGINT
);

CREATE INDEX agent_decision_player_offense ON agent_decision (player, offense, at_ms);
