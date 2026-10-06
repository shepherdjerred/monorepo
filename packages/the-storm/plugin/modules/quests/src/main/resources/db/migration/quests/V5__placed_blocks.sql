-- Blocks players placed (or the world generated, such as cobblestone from
-- lava), so breaking them again does not count for mine objectives. placer is
-- the player who placed it, or NULL for generated blocks. Rows older than
-- quests.yml placedBlockDays are deleted at enable.
CREATE TABLE quests_placed (
    world     TEXT    NOT NULL,
    x         INTEGER NOT NULL,
    y         INTEGER NOT NULL,
    z         INTEGER NOT NULL,
    placer    TEXT,
    placed_at BIGINT  NOT NULL,
    PRIMARY KEY (world, x, y, z)
);

CREATE INDEX quests_placed_age ON quests_placed (placed_at);
