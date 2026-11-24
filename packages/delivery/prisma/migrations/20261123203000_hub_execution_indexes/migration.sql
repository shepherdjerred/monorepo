-- Index platformSourceBuildId on Deployment (scanned by execution summaries and
-- commit reads when builds produce no VersionSet) and descending serviceId
-- lookup on VersionSet (scanned by latestExecution / latestExecutions).
CREATE INDEX "Deployment_platformSourceBuildId_idx" ON "Deployment"("platformSourceBuildId");
CREATE INDEX "VersionSet_serviceId_createdAt_id_idx" ON "VersionSet"("serviceId", "createdAt" DESC, "id" DESC);
