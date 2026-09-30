CREATE TABLE skills_player (
    player_id TEXT NOT NULL PRIMARY KEY,
    last_name TEXT NOT NULL
);

CREATE TABLE skills_experience (
    player_id TEXT NOT NULL REFERENCES skills_player(player_id),
    skill TEXT NOT NULL,
    experience BIGINT NOT NULL CHECK (experience >= 0),
    level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 1000),
    PRIMARY KEY (player_id, skill)
);

CREATE INDEX skills_experience_rank ON skills_experience (skill, level DESC);

-- Player-placed gathering blocks cannot earn experience after a restart.
-- World UUIDs keep a reset mining world from inheriting old provenance.
CREATE TABLE skills_placed_block (
    world_id TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    z INTEGER NOT NULL,
    PRIMARY KEY (world_id, x, y, z)
);

-- Detach provenance while a falling block is airborne, so another placement
-- can claim the source coordinate without being overwritten at landing.
CREATE TABLE skills_falling_block (
    entity_id TEXT NOT NULL PRIMARY KEY
);
