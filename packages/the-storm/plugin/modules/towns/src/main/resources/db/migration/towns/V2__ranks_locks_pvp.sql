-- The owner's Governor level when last seen online (0 to 5); sets how many
-- chunks the town may hold while they are away.
ALTER TABLE towns_town
    ADD COLUMN governor_level INTEGER NOT NULL DEFAULT 0
        CHECK (governor_level BETWEEN 0 AND 5);

-- Players outside a town trusted to build, open containers and use switches on
-- one of its claims.
CREATE TABLE towns_claim_trust (
    world     TEXT    NOT NULL,
    chunk_x   INTEGER NOT NULL,
    chunk_z   INTEGER NOT NULL,
    player_id TEXT    NOT NULL,
    PRIMARY KEY (world, chunk_x, chunk_z, player_id),
    FOREIGN KEY (world, chunk_x, chunk_z)
        REFERENCES towns_claim (world, chunk_x, chunk_z) ON DELETE CASCADE
);

-- Claims no longer guard containers (locks do), so the container flag is gone.
DELETE FROM towns_claim_flag WHERE flag = 'PUBLIC_CONTAINERS';

-- Locked containers: one block, or both halves of a double chest.
CREATE TABLE towns_lock (
    id       TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL
);

CREATE INDEX towns_lock_by_owner ON towns_lock (owner_id);

-- The blocks each lock covers; a block has at most one lock.
CREATE TABLE towns_lock_block (
    world   TEXT    NOT NULL,
    x       INTEGER NOT NULL,
    y       INTEGER NOT NULL,
    z       INTEGER NOT NULL,
    lock_id TEXT    NOT NULL REFERENCES towns_lock (id) ON DELETE CASCADE,
    PRIMARY KEY (world, x, y, z)
);

CREATE INDEX towns_lock_block_by_lock ON towns_lock_block (lock_id);

-- Players a lock's owner lets open and break it.
CREATE TABLE towns_lock_trust (
    lock_id   TEXT NOT NULL REFERENCES towns_lock (id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    PRIMARY KEY (lock_id, player_id)
);

-- Players' own PvP switches. A player without a row has PvP on and has never
-- changed it.
CREATE TABLE towns_pvp (
    player_id  TEXT    NOT NULL PRIMARY KEY,
    pvp_on     INTEGER NOT NULL CHECK (pvp_on IN (0, 1)),
    changed_at BIGINT  NOT NULL
);
