-- Stargate networks and gates use stable UUIDs so town renames and player name
-- changes cannot transfer ownership. A gate's sign position is unique.
CREATE TABLE mechanics_stargate_network (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
    name_key TEXT NOT NULL UNIQUE CHECK (name_key = lower(name)),
    kind TEXT NOT NULL CHECK (kind IN ('public', 'private', 'town')),
    owner_id TEXT,
    town_id TEXT,
    CHECK ((kind = 'private') = (owner_id IS NOT NULL)),
    CHECK ((kind = 'town') = (town_id IS NOT NULL))
);

CREATE TABLE mechanics_stargate_invite (
    network_id TEXT NOT NULL REFERENCES mechanics_stargate_network(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    PRIMARY KEY (network_id, player_id)
);

CREATE TABLE mechanics_stargate_gate (
    id TEXT PRIMARY KEY NOT NULL,
    network_id TEXT NOT NULL REFERENCES mechanics_stargate_network(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
    name_key TEXT NOT NULL CHECK (name_key = lower(name)),
    owner_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    sign_x INTEGER NOT NULL,
    sign_y INTEGER NOT NULL,
    sign_z INTEGER NOT NULL,
    origin_x INTEGER NOT NULL,
    origin_y INTEGER NOT NULL,
    origin_z INTEGER NOT NULL,
    across TEXT NOT NULL CHECK (across IN ('NORTH', 'EAST', 'SOUTH', 'WEST')),
    UNIQUE (network_id, name_key),
    UNIQUE (world_id, sign_x, sign_y, sign_z)
);
