-- Player towns. Names are unique ignoring case.
-- BIGINT has SQLite's INTEGER affinity and makes jOOQ generate Long columns.
CREATE TABLE towns_town (
    id         TEXT   NOT NULL PRIMARY KEY,
    name       TEXT   NOT NULL CHECK (length(name) BETWEEN 3 AND 20),
    created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX towns_town_name ON towns_town (name COLLATE NOCASE);

-- Town members. A player belongs to at most one town.
CREATE TABLE towns_member (
    player_id TEXT NOT NULL PRIMARY KEY,
    town_id   TEXT NOT NULL REFERENCES towns_town (id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('OWNER', 'ASSISTANT', 'MEMBER'))
);

CREATE INDEX towns_member_by_town ON towns_member (town_id);

-- Exactly one owner per town.
CREATE UNIQUE INDEX towns_member_one_owner ON towns_member (town_id) WHERE role = 'OWNER';

-- Claimed chunks, one town per chunk.
CREATE TABLE towns_claim (
    world      TEXT    NOT NULL,
    chunk_x    INTEGER NOT NULL,
    chunk_z    INTEGER NOT NULL,
    town_id    TEXT    NOT NULL REFERENCES towns_town (id) ON DELETE CASCADE,
    claimed_at BIGINT  NOT NULL,
    PRIMARY KEY (world, chunk_x, chunk_z)
);

CREATE INDEX towns_claim_by_town ON towns_claim (town_id);

-- The flags switched on for each claim; a flag without a row is off.
CREATE TABLE towns_claim_flag (
    world   TEXT    NOT NULL,
    chunk_x INTEGER NOT NULL,
    chunk_z INTEGER NOT NULL,
    flag    TEXT    NOT NULL CHECK (flag IN (
        'PVP', 'EXPLOSIONS', 'FIRE_SPREAD', 'MOB_GRIEFING',
        'PUBLIC_BUILD', 'PUBLIC_CONTAINERS', 'PUBLIC_SWITCHES', 'PUBLIC_ENTITIES')),
    PRIMARY KEY (world, chunk_x, chunk_z, flag),
    FOREIGN KEY (world, chunk_x, chunk_z)
        REFERENCES towns_claim (world, chunk_x, chunk_z) ON DELETE CASCADE
);
