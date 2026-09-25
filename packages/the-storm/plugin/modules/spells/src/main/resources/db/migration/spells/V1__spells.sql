-- Spells: temporary blocks awaiting revert, Marks and focus bindings.
-- Instants are epoch milliseconds. Worlds are world keys (minecraft:overworld).

-- Written before a temporary block is placed and deleted after it is reverted,
-- so a crash or restart can never leave a spell's wall, tomb, ice or platform
-- behind: the plugin reverts whatever is here when it starts.
CREATE TABLE spells_temporary_block (
    world     TEXT   NOT NULL,
    x         INT    NOT NULL,
    y         INT    NOT NULL,
    z         INT    NOT NULL,
    original  TEXT   NOT NULL CHECK (length(original) > 0),
    placed    TEXT   NOT NULL CHECK (length(placed) > 0),
    revert_at BIGINT NOT NULL,
    PRIMARY KEY (world, x, y, z)
);

-- Each player's Mark, where Recall returns them.
CREATE TABLE spells_mark (
    player_id TEXT   NOT NULL PRIMARY KEY,
    world     TEXT   NOT NULL,
    x         DOUBLE NOT NULL,
    y         DOUBLE NOT NULL,
    z         DOUBLE NOT NULL,
    yaw       DOUBLE NOT NULL,
    pitch     DOUBLE NOT NULL
);

-- The current generation of each player's focus for each spell. A focus item
-- carrying an older generation is a copy or a replaced focus and never casts.
CREATE TABLE spells_focus (
    player_id  TEXT   NOT NULL,
    spell      TEXT   NOT NULL,
    generation BIGINT NOT NULL CHECK (generation > 0),
    PRIMARY KEY (player_id, spell)
);
