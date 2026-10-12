-- The v1 prematch pipeline was the only writer of ActiveGame and of the
-- BotState prematch pass claim. Both retired with it.
DROP TABLE "ActiveGame";

ALTER TABLE "BotState" DROP COLUMN "prematchPassClaimedAt",
DROP COLUMN "prematchPassHolder",
DROP COLUMN "prematchPassRenewedAt";
