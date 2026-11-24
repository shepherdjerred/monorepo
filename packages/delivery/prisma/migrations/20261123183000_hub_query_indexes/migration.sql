-- Composite descending and commit-lookup indexes for Hub latest-per-service,
-- latest-per-environment, prior-streak, and commit-status reads. Additive:
-- existing indexes remain intact during rolling deployment.
CREATE INDEX "Build_serviceId_createdAt_id_idx" ON "Build"("serviceId", "createdAt" DESC, "id" DESC);
CREATE INDEX "Build_sourceRevision_idx" ON "Build"("sourceRevision");
CREATE INDEX "Deployment_environmentId_createdAt_id_idx" ON "Deployment"("environmentId", "createdAt" DESC, "id" DESC);
