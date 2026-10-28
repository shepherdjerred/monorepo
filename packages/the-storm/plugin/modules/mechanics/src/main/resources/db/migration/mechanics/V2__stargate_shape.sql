ALTER TABLE mechanics_stargate_gate ADD COLUMN shape TEXT NOT NULL DEFAULT 'PLAYER'
    CHECK (shape IN ('PLAYER', 'CIRCLE'));
