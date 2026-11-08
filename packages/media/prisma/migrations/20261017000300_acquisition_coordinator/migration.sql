ALTER TABLE "AcquisitionAttempt" ADD COLUMN "coordinatorOperationId" TEXT;
UPDATE "AcquisitionAttempt" SET "coordinatorOperationId" = "operationId";
