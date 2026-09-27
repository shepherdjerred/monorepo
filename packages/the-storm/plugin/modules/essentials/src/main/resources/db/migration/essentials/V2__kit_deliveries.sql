-- A successful claim remains due until its items are handed to the player.
CREATE TABLE essentials_kit_deliveries (
  player TEXT NOT NULL,
  kit TEXT NOT NULL,
  claimed_at BIGINT NOT NULL,
  PRIMARY KEY (player, kit, claimed_at)
);
