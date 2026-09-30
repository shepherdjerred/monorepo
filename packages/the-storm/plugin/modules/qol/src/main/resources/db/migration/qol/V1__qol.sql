-- When qol first saw a player, and their last random teleport.
-- BIGINT has SQLite's INTEGER affinity and makes jOOQ generate Long columns.
CREATE TABLE qol_player (
    player     TEXT   NOT NULL PRIMARY KEY,
    first_seen BIGINT NOT NULL,
    last_rtp   BIGINT
);

-- Grave chests. Items live in the chest; this row is the owner and the expiry.
CREATE TABLE qol_grave (
    id      TEXT    NOT NULL PRIMARY KEY,
    owner   TEXT    NOT NULL,
    world   TEXT    NOT NULL,
    x       INTEGER NOT NULL,
    y       INTEGER NOT NULL,
    z       INTEGER NOT NULL,
    expires BIGINT  NOT NULL
);

CREATE INDEX qol_grave_expires ON qol_grave (expires);
CREATE INDEX qol_grave_at ON qol_grave (world, x, y, z);
