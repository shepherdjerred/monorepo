-- Balances of player and town accounts. The server account is the unlimited
-- source and sink of crystals, so it has ledger entries but never a balance.
-- BIGINT has SQLite's INTEGER affinity and makes jOOQ generate Long columns.
CREATE TABLE economy_account (
    kind    TEXT   NOT NULL CHECK (kind IN ('player', 'town')),
    id      TEXT   NOT NULL,
    balance BIGINT NOT NULL CHECK (balance >= 0),
    PRIMARY KEY (kind, id)
);

CREATE INDEX economy_account_by_balance ON economy_account (kind, balance DESC);

-- Every transfer ever made. Replaying it from empty reproduces every balance.
CREATE TABLE economy_ledger (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    from_kind TEXT    NOT NULL CHECK (from_kind IN ('player', 'town', 'server')),
    from_id   TEXT    NOT NULL,
    to_kind   TEXT    NOT NULL CHECK (to_kind IN ('player', 'town', 'server')),
    to_id     TEXT    NOT NULL,
    amount    BIGINT  NOT NULL CHECK (amount > 0),
    reason    TEXT    NOT NULL CHECK (length(reason) > 0),
    at        BIGINT  NOT NULL,
    CHECK (from_kind <> to_kind OR from_id <> to_id)
);

-- Players who have joined at least once, so the starting balance is paid once.
CREATE TABLE economy_player_seen (
    player_id  TEXT   NOT NULL PRIMARY KEY,
    first_seen BIGINT NOT NULL
);
