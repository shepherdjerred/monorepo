-- Which server a decision belongs to. Each server reads only its own
-- rows, so shared surfaces never mix servers up.

ALTER TABLE agent_decision ADD COLUMN server TEXT NOT NULL DEFAULT 'survival';

CREATE INDEX agent_decision_server ON agent_decision (server);
