-- New profiles receive eight compass trips. A player who still had the
-- one-shot compass receives the same eight. A finished compass stays finished.
ALTER TABLE qol_player ADD COLUMN starter_rtp_charges INTEGER NOT NULL DEFAULT 0
  CHECK (starter_rtp_charges >= 0);

UPDATE qol_player SET starter_rtp_charges = 8 WHERE starter_rtp_pending = 1;
