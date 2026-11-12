-- History recovery stops retrying a match Riot definitively withholds.
ALTER TABLE "MatchEvidenceAdmission" ADD COLUMN "recoveryAbandonedAt" TIMESTAMP(3),
ADD COLUMN "recoveryAbandonedReason" TEXT;
