-- The peek feature (/bb pass, /bb peek) is retired and no longer reads
-- peekPassExpiresAt/peekAvailableAt. Dropping the columns outright would
-- break a rollback to the pre-removal image, which still inserts and
-- selects them, so only the now-unused index goes away and the pool
-- column's NOT NULL constraint is relaxed. pool-open.ts still computes and
-- writes a compatibility peekAvailableAt value (see
-- computeLegacyPeekAvailableAt) so a rolled-back old image's peek.ts
-- candidate query, which decodes the column unconditionally, can still read
-- pools this code creates. Both columns are kept for one compatibility
-- release and should be dropped in a follow-up migration once this release
-- is no longer a rollback target.

-- DropIndex
DROP INDEX "BucksMatchPool_serverId_poolState_peekAvailableAt_idx";

-- AlterTable
ALTER TABLE "BucksMatchPool" ALTER COLUMN "peekAvailableAt" DROP NOT NULL;
