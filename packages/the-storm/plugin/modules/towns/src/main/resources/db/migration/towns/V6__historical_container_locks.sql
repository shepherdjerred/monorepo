-- Offline restoration records provenance and every joint owner without inventing player rows.
-- Ordinary locks have no restoration row and keep their existing permissions and quota.
CREATE TABLE towns_lock_restoration (
    lock_id    TEXT NOT NULL PRIMARY KEY REFERENCES towns_lock(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    holding_id TEXT NOT NULL
);

CREATE TABLE towns_lock_historical_owner (
    lock_id     TEXT NOT NULL REFERENCES towns_lock_restoration(lock_id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL,
    player_name TEXT NOT NULL CHECK (length(player_name) > 0),
    PRIMARY KEY (lock_id, player_id)
);
