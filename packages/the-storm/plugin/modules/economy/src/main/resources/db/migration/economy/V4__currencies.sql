-- Balances and ledger entries name their currency. Every row written before
-- this migration was in crystals. SQLite cannot change a primary key or add a
-- NOT NULL column without a default, so both tables are rebuilt and copied
-- row for row: the same ids, amounts and balances, with currency 'crystals'.
-- No currency has a default, so every later write must name one.

CREATE TABLE economy_account_v4 (
    kind     TEXT   NOT NULL CHECK (kind IN ('player', 'town')),
    id       TEXT   NOT NULL,
    currency TEXT   NOT NULL CHECK (currency IN ('crystals', 'rwf_credits')),
    balance  BIGINT NOT NULL CHECK (balance >= 0),
    PRIMARY KEY (kind, id, currency)
);

INSERT INTO economy_account_v4 (kind, id, currency, balance)
SELECT kind, id, 'crystals', balance FROM economy_account;

DROP TABLE economy_account;

ALTER TABLE economy_account_v4 RENAME TO economy_account;

CREATE INDEX economy_account_by_balance ON economy_account (kind, currency, balance DESC);

CREATE TABLE economy_ledger_v4 (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_kind       TEXT    NOT NULL CHECK (from_kind IN ('player', 'town', 'server')),
    from_id         TEXT    NOT NULL,
    to_kind         TEXT    NOT NULL CHECK (to_kind IN ('player', 'town', 'server')),
    to_id           TEXT    NOT NULL,
    currency        TEXT    NOT NULL CHECK (currency IN ('crystals', 'rwf_credits')),
    amount          BIGINT  NOT NULL CHECK (amount > 0),
    reason          TEXT    NOT NULL CHECK (length(reason) > 0),
    at              BIGINT  NOT NULL,
    idempotency_key TEXT,
    CHECK (from_kind <> to_kind OR from_id <> to_id)
);

INSERT INTO economy_ledger_v4
    (id, from_kind, from_id, to_kind, to_id, currency, amount, reason, at, idempotency_key)
SELECT id, from_kind, from_id, to_kind, to_id, 'crystals', amount, reason, at, idempotency_key
FROM economy_ledger;

-- Keep the AUTOINCREMENT high-water mark, so no ledger id is ever handed out twice.
UPDATE sqlite_sequence
SET seq = (SELECT seq FROM sqlite_sequence WHERE name = 'economy_ledger')
WHERE name = 'economy_ledger_v4'
  AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'economy_ledger');

DROP TABLE economy_ledger;

ALTER TABLE economy_ledger_v4 RENAME TO economy_ledger;

-- Keys stay unique across currencies: one key is one transfer.
CREATE UNIQUE INDEX economy_ledger_idempotency_key
    ON economy_ledger (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
