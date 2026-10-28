-- Lock type and the flags an owner can turn on. Existing locks stay private
-- with every flag off, which is how they already behave.
ALTER TABLE towns_lock
    ADD COLUMN lock_type TEXT NOT NULL DEFAULT 'PRIVATE'
        CHECK (lock_type IN ('PRIVATE', 'PUBLIC', 'PASSWORD', 'DONATION', 'SUPPLY', 'DISPLAY'));

ALTER TABLE towns_lock
    ADD COLUMN password TEXT NOT NULL DEFAULT '';

ALTER TABLE towns_lock
    ADD COLUMN hopper INTEGER NOT NULL DEFAULT 0 CHECK (hopper IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN hopper_in INTEGER NOT NULL DEFAULT 0 CHECK (hopper_in IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN hopper_out INTEGER NOT NULL DEFAULT 0 CHECK (hopper_out IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN golem INTEGER NOT NULL DEFAULT 0 CHECK (golem IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN magnet INTEGER NOT NULL DEFAULT 0 CHECK (magnet IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN autoclose INTEGER NOT NULL DEFAULT 0 CHECK (autoclose IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN explosions INTEGER NOT NULL DEFAULT 0 CHECK (explosions IN (0, 1));

ALTER TABLE towns_lock
    ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0 CHECK (exempt IN (0, 1));
