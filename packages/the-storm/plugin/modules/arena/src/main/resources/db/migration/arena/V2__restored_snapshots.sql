-- A restored snapshot is marked before the player's data is saved, so it is
-- never restored again (a crash or a failed delete used to roll the player
-- back). Marked rows are deleted afterwards on a best-effort basis.
ALTER TABLE arena_snapshots ADD COLUMN restored_at BIGINT;
