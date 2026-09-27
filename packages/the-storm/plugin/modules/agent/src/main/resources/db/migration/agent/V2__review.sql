-- Spot-check sampling and reviewer endorsements on the decision log.
-- Sampled rows surface in the review queue next to escalations; an
-- endorsement marks a sampled row reviewed-as-good and clears it.

ALTER TABLE agent_decision ADD COLUMN sampled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_decision ADD COLUMN endorsed_by TEXT;
ALTER TABLE agent_decision ADD COLUMN endorsed_ms BIGINT;

CREATE INDEX agent_decision_sample ON agent_decision (sampled, overturned_by, endorsed_by);
