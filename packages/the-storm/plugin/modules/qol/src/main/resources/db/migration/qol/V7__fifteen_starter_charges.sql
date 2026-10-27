-- Existing active compasses receive seven additional trips, for fifteen total.
-- Finished compasses stay finished and new profiles use PlayerProfile's allowance.
UPDATE qol_player
SET starter_rtp_charges = starter_rtp_charges + 7
WHERE starter_rtp_pending = 1 AND starter_rtp_charges > 0;
