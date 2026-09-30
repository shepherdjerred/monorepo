-- A started Paper side effect cannot safely be replayed after a crash without reconciliation.
ALTER TABLE quests_pending_world ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING';
