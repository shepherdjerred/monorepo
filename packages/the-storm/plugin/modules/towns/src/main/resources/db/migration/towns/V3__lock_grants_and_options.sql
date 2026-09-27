-- Existing trusted players could open and break their locks. Keep that grant
-- when assigning the new per-player access level.
ALTER TABLE towns_lock_trust
    ADD COLUMN grant_level TEXT NOT NULL DEFAULT 'MANAGE'
        CHECK (grant_level IN ('USE', 'MANAGE'));

-- The V2 policy shared existing locks with the owner's town by default.
-- Preserve the ability to open those locks while making new lock options
-- explicit in application writes. Town members no longer gain break access.
ALTER TABLE towns_lock
    ADD COLUMN shared_with_town INTEGER NOT NULL DEFAULT 1
        CHECK (shared_with_town IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN redstone INTEGER NOT NULL DEFAULT 0
        CHECK (redstone IN (0, 1));
