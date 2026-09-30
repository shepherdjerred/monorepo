-- The name each player last joined with, recorded on every join, so commands
-- resolve offline players from the economy's own records rather than Paper's
-- profile cache, and only players who have played here can be paid.
-- Rows written before this migration carry no name until that player rejoins.
ALTER TABLE economy_player_seen ADD COLUMN last_name TEXT;
ALTER TABLE economy_player_seen ADD COLUMN updated_at BIGINT;

CREATE INDEX economy_player_seen_by_name
    ON economy_player_seen (last_name COLLATE NOCASE, updated_at DESC);
