-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Build" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sourceRevision" TEXT NOT NULL,
    "ciUrl" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "qualificationReason" TEXT,
    "qualificationCheckedAt" TIMESTAMP(3),
    "repositoryId" INTEGER NOT NULL,
    "pipelineNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Build_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "runtimeDigests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requires" JSONB NOT NULL DEFAULT '{}',
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionSet" (
    "id" TEXT NOT NULL,
    "qualifiedBuildId" TEXT,
    "serviceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "baseRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionSetEntry" (
    "revisionId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,

    CONSTRAINT "VersionSetEntry_pkey" PRIMARY KEY ("revisionId","component")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "application" TEXT,
    "pipelineRevisionId" TEXT NOT NULL,
    "configurationRevision" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "automaticSuppressedThroughRevision" INTEGER NOT NULL DEFAULT 0,
    "promotionSourceEnvironmentId" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "desiredVersionSetRevisionId" TEXT,
    "observedVersionSetRevisionId" TEXT,
    "acceptedVersionSetRevisionId" TEXT,
    "observedAt" TIMESTAMP(3),
    "activeDeploymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "versionSetRevisionId" TEXT NOT NULL,
    "sourceEnvironmentId" TEXT,
    "previousAcceptedVersionSetRevisionId" TEXT,
    "previousAcceptedConfiguration" JSONB,
    "pipelineRevisionId" TEXT NOT NULL,
    "configurationRevision" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "expectedGeneration" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "message" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "recoveryRequired" BOOLEAN NOT NULL DEFAULT false,
    "resultFingerprint" TEXT,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "deploymentId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("deploymentId")
);

-- CreateTable
CREATE TABLE "ApplicationLock" (
    "application" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationLock_pkey" PRIMARY KEY ("application")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "resultType" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedSnapshot" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "environmentId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Build_requestId_key" ON "Build"("requestId");

-- CreateIndex
CREATE INDEX "Build_serviceId_createdAt_idx" ON "Build"("serviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_buildId_component_key" ON "Artifact"("buildId", "component");

-- CreateIndex
CREATE UNIQUE INDEX "VersionSet_qualifiedBuildId_key" ON "VersionSet"("qualifiedBuildId");

-- CreateIndex
CREATE UNIQUE INDEX "VersionSet_serviceId_revision_key" ON "VersionSet"("serviceId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_application_key" ON "Environment"("application");

-- CreateIndex
CREATE INDEX "Environment_serviceId_idx" ON "Environment"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_requestId_key" ON "Deployment"("requestId");

-- CreateIndex
CREATE INDEX "Deployment_environmentId_createdAt_idx" ON "Deployment"("environmentId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_status_createdAt_idx" ON "Deployment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_deploymentId_id_key" ON "Evidence"("deploymentId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_deploymentId_key" ON "Approval"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_deploymentId_key_key" ON "Stage"("deploymentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_workflowId_key" ON "Outbox"("workflowId");

-- CreateIndex
CREATE INDEX "Outbox_submittedAt_createdAt_idx" ON "Outbox"("submittedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationLock_deploymentId_key" ON "ApplicationLock"("deploymentId");

-- CreateIndex
CREATE INDEX "Audit_entityId_occurredAt_idx" ON "Audit"("entityId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedSnapshot_requestId_key" ON "ImportedSnapshot"("requestId");

-- CreateIndex
CREATE INDEX "ImportedSnapshot_serviceId_createdAt_idx" ON "ImportedSnapshot"("serviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "Build"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionSetEntry" ADD CONSTRAINT "VersionSetEntry_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "VersionSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionSetEntry" ADD CONSTRAINT "VersionSetEntry_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_pipelineRevisionId_fkey" FOREIGN KEY ("pipelineRevisionId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationLock" ADD CONSTRAINT "ApplicationLock_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
