-- Extend the recoverable gate index without changing private network membership.
CREATE TABLE mechanics_stargate_gate_v4 (
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
    shape TEXT NOT NULL DEFAULT 'PLAYER' CHECK (shape IN ('PLAYER', 'CIRCLE', 'LEGACY_CIRCLE')),
    fixed_destination TEXT,
    always_open INTEGER NOT NULL DEFAULT 0 CHECK (always_open IN (0, 1)),
    UNIQUE (network_id, name_key),
    UNIQUE (world_id, sign_x, sign_y, sign_z)
);

INSERT INTO mechanics_stargate_gate_v4
    (id, network_id, name, name_key, owner_id, world_id, sign_x, sign_y, sign_z,
     origin_x, origin_y, origin_z, across, shape, fixed_destination, always_open)
SELECT id, network_id, name, name_key, owner_id, world_id, sign_x, sign_y, sign_z,
       origin_x, origin_y, origin_z, across, shape, fixed_destination, always_open
FROM mechanics_stargate_gate;

DROP TABLE mechanics_stargate_gate;
ALTER TABLE mechanics_stargate_gate_v4 RENAME TO mechanics_stargate_gate;
