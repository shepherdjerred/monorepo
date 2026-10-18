ALTER TABLE "Deployment" ADD COLUMN "repairOfDeploymentId" TEXT REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_trmnl_repair_source" CHECK (("kind" = 'repair-trmnl') = ("repairOfDeploymentId" IS NOT NULL));
CREATE UNIQUE INDEX "Deployment_one_pending_trmnl_repair" ON "Deployment"("repairOfDeploymentId") WHERE "kind" = 'repair-trmnl' AND "status" IN ('queued','running');
