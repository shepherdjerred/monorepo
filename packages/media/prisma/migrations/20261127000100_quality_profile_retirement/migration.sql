ALTER TABLE "QualityProfile" ADD COLUMN "replacedByProfileId" TEXT;

ALTER TABLE "QualityProfile"
  ADD CONSTRAINT "QualityProfile_replacedByProfileId_fkey"
  FOREIGN KEY ("replacedByProfileId") REFERENCES "QualityProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
