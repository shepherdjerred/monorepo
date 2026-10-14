-- Version one deliberately retains its original restore fingerprint. These rows never captured
-- flight/immunity, so restore the vanilla mode defaults instead of trusting transient game state.
ALTER TABLE arena_snapshots ADD COLUMN allow_flight BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE arena_snapshots ADD COLUMN flying BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE arena_snapshots ADD COLUMN fly_speed REAL NOT NULL DEFAULT 0.1;
ALTER TABLE arena_snapshots ADD COLUMN maximum_no_damage_ticks INTEGER NOT NULL DEFAULT 20;
ALTER TABLE arena_snapshots ADD COLUMN vitals_version INTEGER NOT NULL DEFAULT 1;
UPDATE arena_snapshots
SET allow_flight = game_mode IN ('CREATIVE', 'SPECTATOR'),
    flying = game_mode = 'SPECTATOR';
