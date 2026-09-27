-- A stable operation key makes compensating transfers safe to retry after an
-- ambiguous network, database, or process failure. Existing unkeyed transfers
-- keep a NULL key and their original behavior.
ALTER TABLE economy_ledger ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX economy_ledger_idempotency_key
    ON economy_ledger (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
