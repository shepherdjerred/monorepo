-- The peek feature (/bb pass, /bb peek) is retired and no longer reads or
-- writes peekPassExpiresAt/peekAvailableAt. Dropping the columns outright
-- would break a rollback to the pre-removal image, which still inserts and
-- selects them, so only the now-unused index goes away and the pool column's
-- NOT NULL constraint is relaxed (new code no longer supplies a value on
-- create). Both columns are kept for one compatibility release and should be
-- dropped in a follow-up migration once this release is no longer a
-- rollback target.

-- DropIndex
DROP INDEX "BucksMatchPool_serverId_poolState_peekAvailableAt_idx";

-- AlterTable
ALTER TABLE "BucksMatchPool" ALTER COLUMN "peekAvailableAt" DROP NOT NULL;
