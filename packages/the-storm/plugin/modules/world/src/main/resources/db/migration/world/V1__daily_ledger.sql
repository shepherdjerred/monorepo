CREATE TABLE world_digest_day (
    day INTEGER PRIMARY KEY,
    first_observed_ms BIGINT NOT NULL,
    deaths INTEGER NOT NULL DEFAULT 0 CHECK (deaths >= 0)
);

CREATE TABLE world_digest_arrival (
    day INTEGER NOT NULL REFERENCES world_digest_day(day) ON DELETE CASCADE,
    player_uuid TEXT NOT NULL,
    PRIMARY KEY (day, player_uuid)
);
