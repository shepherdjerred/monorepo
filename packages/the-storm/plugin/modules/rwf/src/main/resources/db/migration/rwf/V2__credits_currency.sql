-- Red Warfare pays in its own currency, rwf_credits, with no daily cap.
--
-- Each outbox row now names the currency it pays in, so a row a crash left
-- pending or paying settles in the currency it was written for: every row
-- written before this migration was paid in crystals and stays crystals. A
-- negative credits_owed is the AFK penalty, taken rather than paid. SQLite
-- cannot add a NOT NULL column without a default, so the table is rebuilt and
-- copied row for row.
CREATE TABLE rwf_match_player_v2 (
  match_id TEXT NOT NULL REFERENCES rwf_match (id) ON DELETE CASCADE,
  player TEXT NOT NULL,
  team TEXT NOT NULL,
  kit TEXT NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  result TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('crystals', 'rwf_credits')),
  credits_owed BIGINT NOT NULL,
  payout_status TEXT NOT NULL,
  credits_paid BIGINT NOT NULL,
  PRIMARY KEY (match_id, player)
);

INSERT INTO rwf_match_player_v2
  (match_id, player, team, kit, kills, deaths, result, currency, credits_owed, payout_status,
   credits_paid)
SELECT match_id, player, team, kit, kills, deaths, result, 'crystals', credits_owed,
       payout_status, credits_paid
FROM rwf_match_player;

DROP TABLE rwf_match_player;

ALTER TABLE rwf_match_player_v2 RENAME TO rwf_match_player;

CREATE INDEX rwf_match_player_status ON rwf_match_player (payout_status);

-- The daily cap protected the crystal economy; Red Warfare credits have none.
DROP TABLE rwf_daily_earnings;
