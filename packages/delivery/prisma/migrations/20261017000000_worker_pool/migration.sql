ALTER TABLE "Deployment" ADD COLUMN "workerSnapshot" JSONB;

CREATE TABLE "WorkerVersion" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "introducedByDeploymentId" TEXT NOT NULL,
    "host" JSONB NOT NULL,
    "replicas" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "retirementProof" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkerVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkerVersion_replicas_check" CHECK ("replicas" IN (0, 1)),
    CONSTRAINT "WorkerVersion_generation_check" CHECK ("generation" >= 0),
    CONSTRAINT "WorkerVersion_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkerVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkerVersion_introducedByDeploymentId_fkey" FOREIGN KEY ("introducedByDeploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkerVersion_environmentId_buildId_key" ON "WorkerVersion"("environmentId", "buildId");
CREATE INDEX "WorkerVersion_environmentId_replicas_idx" ON "WorkerVersion"("environmentId", "replicas");
