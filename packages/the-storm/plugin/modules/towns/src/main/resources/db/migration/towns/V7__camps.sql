-- Camps are towns with a kind. Existing rows stay towns and keep no activity clock.
ALTER TABLE towns_town
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'TOWN' CHECK (kind IN ('CAMP', 'TOWN'));

ALTER TABLE towns_town
    ADD COLUMN last_active_at BIGINT;

ALTER TABLE towns_town
    ADD COLUMN expiry_warned INTEGER NOT NULL DEFAULT 0 CHECK (expiry_warned IN (0, 1));

-- A member who holds one chunk as their own. Empty means the whole group may build.
ALTER TABLE towns_claim
    ADD COLUMN resident_id TEXT;

-- Shown once, on the next login, after a camp lapses or is deleted while the player is away.
CREATE TABLE towns_camp_notice (
    player_id TEXT NOT NULL PRIMARY KEY,
    message   TEXT NOT NULL
);
