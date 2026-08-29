-- The peek feature (/bb pass, /bb peek) is retired. Historical `peek_pass`
-- ledger rows remain valid; only the entitlement column and the pool's
-- reveal timestamp go away.

-- DropIndex
DROP INDEX "BucksMatchPool_serverId_poolState_peekAvailableAt_idx";

-- AlterTable
ALTER TABLE "BucksAccount" DROP COLUMN "peekPassExpiresAt";

-- AlterTable
ALTER TABLE "BucksMatchPool" DROP COLUMN "peekAvailableAt";
