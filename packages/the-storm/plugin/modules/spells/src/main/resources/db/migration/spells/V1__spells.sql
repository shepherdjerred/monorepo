-- Spells: temporary blocks awaiting revert, Marks and focus bindings.
-- Instants are epoch milliseconds. Worlds are world keys (minecraft:overworld).

-- Written before a temporary block is placed. After the revert the row is only
-- marked reverted; it is deleted once the world (or its chunk) has been saved,
-- so a crash before that save, which rolls the world back to the placed block,
-- still finds the row and reverts again. Reverting is idempotent. The plugin
-- re-reverts every row here when it starts.
CREATE TABLE spells_temporary_block (
    world     TEXT   NOT NULL,
    x         INT    NOT NULL,
    y         INT    NOT NULL,
    z         INT    NOT NULL,
    original  TEXT   NOT NULL CHECK (length(original) > 0),
    placed    TEXT   NOT NULL CHECK (length(placed) > 0),
    revert_at BIGINT NOT NULL,
    reverted  BOOLEAN NOT NULL DEFAULT FALSE,
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
