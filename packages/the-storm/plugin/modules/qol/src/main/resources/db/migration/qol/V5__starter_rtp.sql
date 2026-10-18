-- Existing players keep their state. Only newly inserted profiles receive the compass.
ALTER TABLE qol_player ADD COLUMN starter_rtp_pending INTEGER NOT NULL DEFAULT 0
    CHECK (starter_rtp_pending IN (0, 1));
