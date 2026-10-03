-- One row per player the quests module has stored anything for.
-- tracked is the quest shown in the sidebar; board_day and board_week are the
-- local date and week start the player's board was last drawn for ('' if never).
CREATE TABLE quests_player (
    player_id  TEXT    NOT NULL PRIMARY KEY,
    points     BIGINT  NOT NULL CHECK (points >= 0),
    tracked    TEXT,
    board_day  TEXT    NOT NULL,
    board_week TEXT    NOT NULL
);

-- Quests a player has taken and not finished. Times are epoch millis.
CREATE TABLE quests_active (
    player_id        TEXT    NOT NULL REFERENCES quests_player (player_id) ON DELETE CASCADE,
    quest_id         TEXT    NOT NULL,
    stage            TEXT    NOT NULL,
    phase            TEXT    NOT NULL CHECK (phase IN ('in_progress', 'waiting', 'choosing')),
    started_at       BIGINT  NOT NULL,
    stage_started_at BIGINT  NOT NULL,
    PRIMARY KEY (player_id, quest_id)
);

-- Each objective's count in an active quest's current stage.
CREATE TABLE quests_objective (
    player_id TEXT    NOT NULL,
    quest_id  TEXT    NOT NULL,
    position  INTEGER NOT NULL CHECK (position >= 0),
    progress  INTEGER NOT NULL CHECK (progress >= 0),
    PRIMARY KEY (player_id, quest_id, position),
    FOREIGN KEY (player_id, quest_id)
        REFERENCES quests_active (player_id, quest_id) ON DELETE CASCADE
);

-- How often and when a player last completed each quest (for repeat rules).
CREATE TABLE quests_completion (
    player_id TEXT    NOT NULL REFERENCES quests_player (player_id) ON DELETE CASCADE,
    quest_id  TEXT    NOT NULL,
    times     INTEGER NOT NULL CHECK (times >= 1),
    last_at   BIGINT  NOT NULL,
    PRIMARY KEY (player_id, quest_id)
);

-- Quest variables and flags.
CREATE TABLE quests_variable (
    player_id TEXT   NOT NULL REFERENCES quests_player (player_id) ON DELETE CASCADE,
    name      TEXT   NOT NULL,
    value     BIGINT NOT NULL,
    PRIMARY KEY (player_id, name)
);

-- Reputation per faction.
CREATE TABLE quests_reputation (
    player_id TEXT   NOT NULL REFERENCES quests_player (player_id) ON DELETE CASCADE,
    faction   TEXT   NOT NULL,
    value     BIGINT NOT NULL,
    PRIMARY KEY (player_id, faction)
);

-- The player's radiant board: each slot's template and what was drawn for it,
-- snapshotted so template edits do not change a drawn quest.
CREATE TABLE quests_board (
    player_id TEXT    NOT NULL REFERENCES quests_player (player_id) ON DELETE CASCADE,
    slot      TEXT    NOT NULL,
    template  TEXT    NOT NULL,
    period    TEXT    NOT NULL CHECK (period IN ('daily', 'weekly')),
    kind      TEXT    NOT NULL CHECK (kind IN ('kill', 'deliver')),
    target    TEXT    NOT NULL,
    amount    INTEGER NOT NULL CHECK (amount >= 1),
    stars     INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    reward    BIGINT  NOT NULL CHECK (reward >= 0),
    minutes   INTEGER NOT NULL CHECK (minutes >= 1),
    PRIMARY KEY (player_id, slot)
);

-- Markers quests pinned above NPCs for the player.
CREATE TABLE quests_marker (
    player_id TEXT NOT NULL REFERENCES quests_player (player_id) ON DELETE CASCADE,
    npc       TEXT NOT NULL,
    mark      TEXT NOT NULL CHECK (mark IN ('available', 'turn_in')),
    PRIMARY KEY (player_id, npc)
);

CREATE INDEX quests_player_points ON quests_player (points DESC);

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
