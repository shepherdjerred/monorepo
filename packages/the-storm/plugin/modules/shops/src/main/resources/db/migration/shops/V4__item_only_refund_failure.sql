-- A committed refund may leave only escrowed items to return at shutdown.
-- Zero means staff must not transfer crystals. Preserve existing rows and ids.
CREATE TABLE shops_refund_failure_v4 (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    payer_kind    TEXT    NOT NULL,
    payer_id      TEXT    NOT NULL,
    payee_kind    TEXT    NOT NULL,
    payee_id      TEXT    NOT NULL,
    amount        BIGINT  NOT NULL CHECK (amount >= 0),
    reason        TEXT    NOT NULL,
    at            BIGINT  NOT NULL,
    held_item     TEXT,
    held_quantity INTEGER CHECK (held_quantity > 0),
    CHECK ((held_item IS NULL) = (held_quantity IS NULL)),
    CHECK (amount > 0 OR held_item IS NOT NULL)
);

INSERT INTO shops_refund_failure_v4
    (id, payer_kind, payer_id, payee_kind, payee_id, amount, reason, at, held_item, held_quantity)
SELECT id, payer_kind, payer_id, payee_kind, payee_id, amount, reason, at, held_item, held_quantity
FROM shops_refund_failure;

DROP TABLE shops_refund_failure;

ALTER TABLE shops_refund_failure_v4 RENAME TO shops_refund_failure;
