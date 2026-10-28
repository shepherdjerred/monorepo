-- Admin grants edit the access list. The old check only allowed USE and MANAGE.
CREATE TABLE towns_lock_trust_next (
    lock_id     TEXT NOT NULL REFERENCES towns_lock (id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL,
    grant_level TEXT NOT NULL DEFAULT 'MANAGE'
        CHECK (grant_level IN ('USE', 'MANAGE', 'ADMIN')),
    PRIMARY KEY (lock_id, player_id)
);

INSERT INTO towns_lock_trust_next (lock_id, player_id, grant_level)
SELECT lock_id, player_id, grant_level FROM towns_lock_trust;

DROP TABLE towns_lock_trust;

ALTER TABLE towns_lock_trust_next RENAME TO towns_lock_trust;

-- Permission groups and extra towns that may open a lock.
CREATE TABLE towns_lock_entry (
    lock_id   TEXT NOT NULL REFERENCES towns_lock (id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('group', 'town')),
    entry_key TEXT NOT NULL,
    PRIMARY KEY (lock_id, kind, entry_key)
);

-- When the lock was last opened. Zero means never, so expiry can see it.
ALTER TABLE towns_lock ADD COLUMN last_used BIGINT NOT NULL DEFAULT 0;

-- Sticky modes. A missing row is every mode off and no template.
CREATE TABLE towns_lock_mode (
    player_id     TEXT    NOT NULL PRIMARY KEY,
    persist       INTEGER NOT NULL CHECK (persist IN (0, 1)),
    nolock        INTEGER NOT NULL CHECK (nolock IN (0, 1)),
    drop_transfer INTEGER NOT NULL CHECK (drop_transfer IN (0, 1)),
    quiet         INTEGER NOT NULL CHECK (quiet IN (0, 1)),
    template_id   TEXT
);
