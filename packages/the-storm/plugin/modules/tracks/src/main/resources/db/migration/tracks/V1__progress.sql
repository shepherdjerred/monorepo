-- One row per player who owns a track level or has ever bought one.
-- last_purchase_at (epoch millis) drives the cooldown between purchases; it is
-- NULL when every level came from an administrator.
CREATE TABLE tracks_player (
    player_id        TEXT   NOT NULL PRIMARY KEY,
    last_purchase_at BIGINT
);

-- A player's level in each track they own. position is the order in which the
-- player first bought the track: 0 is the primary, and it sets the price
-- multiplier. Tracks at level 0 have no row.
CREATE TABLE tracks_level (
    player_id TEXT    NOT NULL REFERENCES tracks_player (player_id) ON DELETE CASCADE,
    track     TEXT    NOT NULL
        CHECK (track IN ('shopkeeper', 'mechanic', 'engineer', 'spellcaster', 'governor')),
    level     INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
    position  INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
    PRIMARY KEY (player_id, track),
    UNIQUE (player_id, position)
);
