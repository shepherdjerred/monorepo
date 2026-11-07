-- Prisma stores DateTime as UTC in TIMESTAMP(3). Preserve that contract for
-- future defaulted command births under any PostgreSQL session timezone.
-- Existing commands and explicitly scheduled availability remain literal.
ALTER TABLE "Operation"
  ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE "OutboxCommand"
  ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  ALTER COLUMN "availableAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
