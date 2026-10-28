ALTER TABLE mechanics_stargate_gate ADD COLUMN fixed_destination TEXT;
ALTER TABLE mechanics_stargate_gate ADD COLUMN always_open INTEGER NOT NULL DEFAULT 0
    CHECK (always_open IN (0, 1));
