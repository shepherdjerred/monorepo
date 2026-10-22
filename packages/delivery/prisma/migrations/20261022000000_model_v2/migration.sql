-- Delivery model v2. One migration set applied by the operator-run bootstrap
-- path during the cutover window. The leading pre-check refuses when the v1
-- record is inconsistent so that no backfill below can guess.

DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(env."id", ', ' ORDER BY env."id") INTO offending
  FROM "Environment" env
  WHERE env."acceptedVersionSetRevisionId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Deployment" d
      WHERE d."environmentId" = env."id"
        AND d."versionSetRevisionId" = env."acceptedVersionSetRevisionId"
        AND d."status" = 'succeeded'
        AND d."kind" NOT IN ('adopt-worker', 'repair-trmnl')
    );
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'model_v2 pre-check: accepted set revision without a matching succeeded deployment in %', offending;
  END IF;

  SELECT string_agg(labels."configurationRevision", ', ' ORDER BY labels."configurationRevision") INTO offending
  FROM (
    SELECT "configurationRevision", "configuration" FROM "Environment"
    UNION
    SELECT "configurationRevision", "configuration" FROM "Deployment"
  ) labels
  GROUP BY labels."configurationRevision"
  HAVING count(DISTINCT labels."configuration") > 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'model_v2 pre-check: configuration label carries two contents: %', offending;
  END IF;

  SELECT string_agg(env."id", ', ' ORDER BY env."id") INTO offending
  FROM "Environment" env
  WHERE (env."acceptedPlatformDeploymentId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Deployment" d
        WHERE d."id" = env."acceptedPlatformDeploymentId"
          AND d."environmentId" = env."id"
          AND d."status" = 'succeeded'))
    OR (env."acceptedControlPlaneDeploymentId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Deployment" d
        WHERE d."id" = env."acceptedControlPlaneDeploymentId"
          AND d."environmentId" = env."id"
          AND d."status" = 'succeeded'));
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'model_v2 pre-check: accepted platform or control-plane pointer without a succeeded deployment in %', offending;
  END IF;

  -- Acquired charts and images outside the self-hosted stores stay in their
  -- upstream repository or registry (X11); every other artifact must be in a
  -- registered store by prefix.
  SELECT string_agg(a."uri", ', ' ORDER BY a."uri") INTO offending
  FROM "Artifact" a
  WHERE NOT (
    a."uri" LIKE 'docker.io/%'
    OR a."uri" LIKE 'https://chartmuseum.tailnet-1a49.ts.net/%'
    OR a."uri" LIKE 'https://chartmuseum.sjer.red/%'
    OR a."uri" LIKE 's3://delivery-artifacts/%'
    OR a."uri" LIKE 's3://storm-forum-releases/%'
    OR (a."origin"->>'kind' = 'upstream' AND a."kind" IN ('chart', 'image'))
  );
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'model_v2 pre-check: artifact URI outside every registered store: %', offending;
  END IF;

  SELECT string_agg(d."id", ', ' ORDER BY d."id") INTO offending
  FROM "Deployment" d
  WHERE d."status" NOT IN ('succeeded', 'failed', 'canceled') OR d."recoveryRequired";
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'model_v2 pre-check: deployments are pending, owned or recovery-required; cancel or settle them first: %', offending;
  END IF;

  -- Intents migrate with their fingerprints; an unsettled one would be
  -- re-evaluated under the v2 generation rule (E1), so none may be open.
  SELECT string_agg(open_intents."id", ', ' ORDER BY open_intents."id") INTO offending
  FROM (
    SELECT "id" FROM "WorkerRecoveryIntent" WHERE "status" IN ('pending', 'running')
    UNION ALL SELECT "id" FROM "MinecraftRecoveryIntent" WHERE "status" IN ('pending', 'running')
    UNION ALL SELECT "id" FROM "PlatformRecoveryIntent" WHERE "status" IN ('pending', 'running')
    UNION ALL SELECT "id" FROM "ContentRecoveryIntent"
      WHERE "status" = 'pending' OR ("dispatchBarrier" IS NOT NULL AND "barrierRestoredAt" IS NULL)
    UNION ALL SELECT "id" FROM "ForumBaselineIntent" WHERE "status" IN ('pending', 'running')
  ) open_intents;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'model_v2 pre-check: recovery or baseline intents are unsettled or hold an unrestored barrier: %', offending;
  END IF;
END
$$;

-- 4.2 Service: one row per catalog service; v1 rows are backfilled from the
-- services that already own builds, sets, environments or deployments.
CREATE TABLE "Service" (
  "id" TEXT NOT NULL,
  "lifecycle" TEXT NOT NULL DEFAULT 'active',
  "selfHosted" BOOLEAN NOT NULL DEFAULT false,
  "group" TEXT,
  "components" JSONB NOT NULL DEFAULT '[]',
  "lineage" TEXT NOT NULL,
  "catalogRevision" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Service_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Service_lifecycle_check" CHECK ("lifecycle" IN ('active', 'retired', 'removed'))
);

INSERT INTO "Service" ("id", "lifecycle", "selfHosted", "components", "lineage", "catalogRevision", "updatedAt")
SELECT
  owners."serviceId",
  'active',
  owners."serviceId" IN ('delivery', 'delivery-control-plane', 'temporal', 'argocd'),
  COALESCE(components."components", '[]'::jsonb),
  encode(sha256(convert_to(COALESCE(components."names", ''), 'UTF8')), 'hex'),
  'v1-backfill',
  CURRENT_TIMESTAMP
FROM (
  SELECT "serviceId" FROM "Build"
  UNION SELECT "serviceId" FROM "VersionSet"
  UNION SELECT "serviceId" FROM "Environment"
  UNION SELECT "serviceId" FROM "Deployment"
) owners
LEFT JOIN (
  SELECT
    slots."serviceId",
    jsonb_agg(jsonb_build_object('name', slots."component", 'producer', slots."producer") ORDER BY slots."component") AS "components",
    string_agg(slots."component", E'\n' ORDER BY slots."component") AS "names"
  FROM (
    SELECT
      b."serviceId",
      a."component",
      CASE WHEN bool_and(a."origin"->>'kind' <> 'first-party') THEN 'acquisition' ELSE 'first-party' END AS "producer"
    FROM "Artifact" a
    JOIN "Build" b ON b."id" = a."buildId"
    GROUP BY b."serviceId", a."component"
  ) slots
  GROUP BY slots."serviceId"
) components ON components."serviceId" = owners."serviceId";

ALTER TABLE "Build" ADD CONSTRAINT "Build_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VersionSet" ADD CONSTRAINT "VersionSet_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4.5 Artifact store registry; the pre-check guarantees every URI maps.
ALTER TABLE "Artifact" ADD COLUMN "store" TEXT;
UPDATE "Artifact" SET "store" = CASE
  WHEN "uri" LIKE 'docker.io/%' THEN 'docker-hub'
  WHEN "uri" LIKE 'https://chartmuseum.tailnet-1a49.ts.net/%' THEN 'chartmuseum'
  WHEN "uri" LIKE 'https://chartmuseum.sjer.red/%' THEN 'chartmuseum'
  WHEN "uri" LIKE 's3://delivery-artifacts/%' THEN 'delivery-artifacts'
  WHEN "uri" LIKE 's3://storm-forum-releases/%' THEN 'storm-forum-releases'
  WHEN "origin"->>'kind' = 'upstream' AND "kind" = 'chart' THEN 'upstream-chart-repository'
  WHEN "origin"->>'kind' = 'upstream' AND "kind" = 'image' THEN 'upstream-image-registry'
END;
ALTER TABLE "Artifact" ALTER COLUMN "store" SET NOT NULL;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_store_check" CHECK ("store" IN ('docker-hub', 'chartmuseum', 'delivery-artifacts', 'storm-forum-releases', 'upstream-chart-repository', 'upstream-image-registry'));

-- 4.6 Set revision lineage and order key. The key is the pair
-- (orderMajor, orderMinor) compared lexicographically: ci and acquisition
-- builds carry (pipelineNumber, 0); attested builds carry the highest major
-- key the service has composed and their registration sequence as minor.
ALTER TABLE "VersionSet" ADD COLUMN "lineage" TEXT;
ALTER TABLE "VersionSet" ADD COLUMN "orderMajor" INTEGER;
ALTER TABLE "VersionSet" ADD COLUMN "orderMinor" INTEGER;
UPDATE "VersionSet" vs SET "lineage" = s."lineage" FROM "Service" s WHERE s."id" = vs."serviceId";
UPDATE "VersionSet" vs SET "orderMajor" = b."pipelineNumber", "orderMinor" = 0
FROM "Build" b WHERE b."id" = vs."qualifiedBuildId" AND b."pipelineNumber" IS NOT NULL;
-- An attested set orders after every pipeline-keyed set the service composed
-- before it and before the next one (B4, R7).
UPDATE "VersionSet" vs SET
  "orderMajor" = COALESCE((
    SELECT max(prior."orderMajor") FROM "VersionSet" prior
    WHERE prior."serviceId" = vs."serviceId" AND prior."revision" < vs."revision"
  ), 0),
  "orderMinor" = b."registrationSequence"
FROM "Build" b
WHERE b."id" = vs."qualifiedBuildId" AND b."sourceKind" = 'attested';
ALTER TABLE "VersionSet" ALTER COLUMN "lineage" SET NOT NULL;
-- R2, R3, R7: automatic sets come from a qualifying build or a tracking
-- recomposition, whose trigger is the source environment's accepting
-- deployment; manual sets are hotfixes and never become a base.
ALTER TABLE "VersionSet" ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VersionSet" ADD COLUMN "triggerDeploymentId" TEXT;
UPDATE "VersionSet" SET "automatic" = true WHERE "qualifiedBuildId" IS NOT NULL;
ALTER TABLE "VersionSet" ADD CONSTRAINT "VersionSet_automatic_origin_check" CHECK (
  "automatic" = ("qualifiedBuildId" IS NOT NULL OR "triggerDeploymentId" IS NOT NULL)
  AND NOT ("qualifiedBuildId" IS NOT NULL AND "triggerDeploymentId" IS NOT NULL)
);
ALTER TABLE "VersionSet" ADD CONSTRAINT "VersionSet_order_key_check" CHECK (("orderMajor" IS NULL) = ("orderMinor" IS NULL));
CREATE INDEX "VersionSet_serviceId_lineage_order_idx" ON "VersionSet"("serviceId", "lineage", "orderMajor", "orderMinor");

-- 4.8 Configuration revisions: one immutable row per label.
CREATE TABLE "Configuration" (
  "id" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "forwardOnly" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Configuration_pkey" PRIMARY KEY ("id")
);
INSERT INTO "Configuration" ("id", "content")
SELECT DISTINCT ON (labels."configurationRevision") labels."configurationRevision", labels."configuration"
FROM (
  SELECT "configurationRevision", "configuration" FROM "Environment"
  UNION
  SELECT "configurationRevision", "configuration" FROM "Deployment"
) labels
ORDER BY labels."configurationRevision";

ALTER TABLE "Environment" ADD COLUMN "declaredConfigurationId" TEXT;
UPDATE "Environment" SET "declaredConfigurationId" = "configurationRevision";
ALTER TABLE "Environment" ALTER COLUMN "declaredConfigurationId" SET NOT NULL;
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_declaredConfigurationId_fkey" FOREIGN KEY ("declaredConfigurationId") REFERENCES "Configuration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Environment" DROP COLUMN "configurationRevision";
ALTER TABLE "Environment" DROP COLUMN "configuration";

ALTER TABLE "Deployment" ADD COLUMN "configurationId" TEXT;
UPDATE "Deployment" SET "configurationId" = "configurationRevision";
ALTER TABLE "Deployment" ALTER COLUMN "configurationId" SET NOT NULL;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "Configuration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4.13 Approval: one decision per deployment, bound to the frozen selection.
-- The selection fingerprint is sha256 over the three revision ids joined by a
-- newline, computed identically by the API.
ALTER TABLE "Approval" ADD COLUMN "status" TEXT;
ALTER TABLE "Approval" ADD COLUMN "override" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Approval" ADD COLUMN "boundFingerprint" TEXT;
ALTER TABLE "Approval" ADD COLUMN "decidedAt" TIMESTAMP(3);
-- Section 6: reconcile-after-restore holds automatic deployments on a mismatch.
ALTER TABLE "Environment" ADD COLUMN "restoreHold" JSONB;
-- 4.10: a removed environment records when its target state was destroyed.
ALTER TABLE "Environment" ADD COLUMN "targetRemovedAt" TIMESTAMP(3);
-- H5: a monitor-created rollback carries the restored selection's approval.
ALTER TABLE "Approval" ADD COLUMN "restorationOfDeploymentId" TEXT REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE "Approval" a
SET "status" = CASE a."decision" WHEN 'approve' THEN 'granted' ELSE 'rejected' END,
    "decidedAt" = a."createdAt",
    "boundFingerprint" = encode(sha256(convert_to(d."versionSetRevisionId" || E'\n' || d."pipelineRevisionId" || E'\n' || d."configurationId", 'UTF8')), 'hex')
FROM "Deployment" d
WHERE d."id" = a."deploymentId";
ALTER TABLE "Approval" DROP COLUMN "decision";
ALTER TABLE "Approval" ALTER COLUMN "reason" DROP NOT NULL;
ALTER TABLE "Approval" ALTER COLUMN "actor" DROP NOT NULL;
ALTER TABLE "Approval" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Approval" ALTER COLUMN "status" SET DEFAULT 'pending';
ALTER TABLE "Approval" ALTER COLUMN "boundFingerprint" SET NOT NULL;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_status_check" CHECK ("status" IN ('pending', 'granted', 'rejected', 'expired'));
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decision_identity_check" CHECK (
  ("status" = 'pending' AND "actor" IS NULL AND "reason" IS NULL AND "decidedAt" IS NULL)
  OR ("status" IN ('granted', 'rejected') AND "actor" IS NOT NULL AND "reason" IS NOT NULL AND "decidedAt" IS NOT NULL)
  OR ("status" = 'expired' AND "decidedAt" IS NOT NULL)
);

-- 4.10 Environment: accepted selection pointer, role, lifecycle, approval policy.
ALTER TABLE "Environment" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'durable';
ALTER TABLE "Environment" ADD COLUMN "lifecycle" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Environment" ADD COLUMN "approvalPolicy" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Environment" ADD COLUMN "acceptedDeploymentId" TEXT;
-- E7: the durable environment a replica mirrors.
ALTER TABLE "Environment" ADD COLUMN "durableParentId" TEXT;
UPDATE "Environment" env
SET "approvalPolicy" = 'required'
WHERE env."serviceId" IN ('scout-for-lol', 'starlight-karma-bot')
  AND (env."application" LIKE '%-prod' OR lower(env."name") IN ('prod', 'production'));
UPDATE "Environment" env
SET "acceptedDeploymentId" = (
  SELECT d."id" FROM "Deployment" d
  WHERE d."environmentId" = env."id"
    AND d."versionSetRevisionId" = env."acceptedVersionSetRevisionId"
    AND d."status" = 'succeeded'
    AND d."kind" NOT IN ('adopt-worker', 'repair-trmnl')
  ORDER BY d."finishedAt" DESC NULLS LAST, d."createdAt" DESC
  LIMIT 1
)
WHERE env."acceptedVersionSetRevisionId" IS NOT NULL;
UPDATE "Environment" env
SET "acceptedDeploymentId" = COALESCE(env."acceptedPlatformDeploymentId", env."acceptedControlPlaneDeploymentId")
WHERE env."acceptedDeploymentId" IS NULL
  AND (env."acceptedPlatformDeploymentId" IS NOT NULL OR env."acceptedControlPlaneDeploymentId" IS NOT NULL);
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_acceptedDeploymentId_fkey" FOREIGN KEY ("acceptedDeploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_role_check" CHECK ("role" IN ('durable', 'replica', 'qualification'));
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_durableParentId_fkey" FOREIGN KEY ("durableParentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_replica_parent_check" CHECK (("role" = 'replica') = ("durableParentId" IS NOT NULL));
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_lifecycle_check" CHECK ("lifecycle" IN ('active', 'retired', 'removed'));
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_approvalPolicy_check" CHECK ("approvalPolicy" IN ('none', 'required'));
ALTER TABLE "Environment" DROP CONSTRAINT "Environment_acceptedControlPlaneDeploymentId_fkey";
ALTER TABLE "Environment" DROP CONSTRAINT "Environment_acceptedForumBaselineIntentId_fkey";
ALTER TABLE "Environment" DROP CONSTRAINT "Environment_acceptedPlatformDeploymentId_fkey";
ALTER TABLE "Environment" DROP COLUMN "acceptedPlatformDeploymentId";
ALTER TABLE "Environment" DROP COLUMN "acceptedControlPlaneDeploymentId";
ALTER TABLE "Environment" DROP COLUMN "acceptedForumBaselineIntentId";

-- 4.12 Deployment: catalog revision, executor identity and lease, selection
-- lineage, monitor state. Historical kinds stay readable; `retire-worker`
-- becomes the model's `retire-host`.
ALTER TABLE "Deployment" ADD COLUMN "catalogRevision" TEXT NOT NULL DEFAULT 'v1-backfill';
ALTER TABLE "Deployment" ALTER COLUMN "catalogRevision" DROP DEFAULT;
ALTER TABLE "Deployment" ADD COLUMN "workflowId" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "workflowRunId" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "Deployment" ADD COLUMN "previousAcceptedDeploymentId" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "restoredDeploymentId" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "admissionSnapshot" JSONB;
-- D8: a self-hosted deployment the outgoing executor handed to its successor.
ALTER TABLE "Deployment" ADD COLUMN "handoffAt" TIMESTAMP(3);
ALTER TABLE "Deployment" ADD COLUMN "monitorState" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "monitorSettledAt" TIMESTAMP(3);
ALTER TABLE "Deployment" ADD COLUMN "monitorAlarmedAt" TIMESTAMP(3);
UPDATE "Deployment" SET "kind" = 'retire-host' WHERE "kind" = 'retire-worker';
UPDATE "Deployment" r
SET "restoredDeploymentId" = (
  SELECT d."id" FROM "Deployment" d
  WHERE d."environmentId" = r."environmentId"
    AND d."versionSetRevisionId" = r."versionSetRevisionId"
    AND d."status" = 'succeeded'
    AND d."kind" NOT IN ('adopt-worker', 'repair-trmnl')
    AND d."createdAt" < r."createdAt"
  ORDER BY d."finishedAt" DESC NULLS LAST, d."createdAt" DESC
  LIMIT 1
)
WHERE r."kind" = 'rollback';
UPDATE "Deployment" d
SET "monitorState" = 'unmonitored', "monitorSettledAt" = d."finishedAt"
FROM "Environment" env
WHERE env."acceptedDeploymentId" = d."id";
ALTER TABLE "Deployment" DROP COLUMN "configurationRevision";
ALTER TABLE "Deployment" DROP COLUMN "configuration";
ALTER TABLE "Deployment" DROP COLUMN "previousAcceptedConfiguration";
ALTER TABLE "VersionSet" ADD CONSTRAINT "VersionSet_triggerDeploymentId_fkey" FOREIGN KEY ("triggerDeploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_previousAcceptedDeploymentId_fkey" FOREIGN KEY ("previousAcceptedDeploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_restoredDeploymentId_fkey" FOREIGN KEY ("restoredDeploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_kind_check" CHECK ("kind" IN ('deploy', 'promote', 'rollback', 'rebind', 'retire-host', 'channel-publish', 'operator-run', 'adopt-worker', 'repair-trmnl', 'upgrade-control-plane', 'tofu-plan', 'tofu-apply', 'root-release'));
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_monitorState_check" CHECK ("monitorState" IS NULL OR "monitorState" IN ('watching', 'settled', 'alarmed', 'unmonitored'));
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_rollback_restores_check" CHECK (("kind" = 'rollback') = ("restoredDeploymentId" IS NOT NULL) OR "catalogRevision" = 'v1-backfill');
CREATE INDEX "Deployment_monitorState_idx" ON "Deployment"("monitorState");

-- T1 Target locks: one row per instance, several per deployment.
CREATE TABLE "TargetLock" (
  "instance" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TargetLock_pkey" PRIMARY KEY ("instance"),
  CONSTRAINT "TargetLock_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TargetLock_deploymentId_idx" ON "TargetLock"("deploymentId");
INSERT INTO "TargetLock" ("instance", "deploymentId", "acquiredAt")
SELECT
  CASE
    WHEN "application" LIKE 'static-site:%' THEN 'bucket:' || substr("application", 13)
    WHEN "application" LIKE 'tofu:%' THEN 'stack:' || substr("application", 6)
    ELSE 'application:' || "application"
  END,
  "deploymentId",
  "acquiredAt"
FROM "ApplicationLock";
DROP TABLE "ApplicationLock";

-- The named shared lock keeps its table under the model's name.
ALTER TABLE "PlatformLock" DROP CONSTRAINT "PlatformLock_id_check";
UPDATE "PlatformLock" SET "id" = 'platform' WHERE "id" = 'shared-resources';
ALTER TABLE "PlatformLock" ADD CONSTRAINT "PlatformLock_id_check" CHECK ("id" = 'platform');

-- 4.15 One recovery intent primitive; existing rows keep their kind.
CREATE TABLE "RecoveryIntent" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "step" TEXT,
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedGeneration" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "workflowId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "detail" JSONB NOT NULL DEFAULT '{}',
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "barrier" JSONB,
  "barrierRestoredAt" TIMESTAMP(3),
  "outcome" JSONB,
  "message" TEXT,
  "resultFingerprint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "RecoveryIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecoveryIntent_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecoveryIntent_kind_check" CHECK ("kind" IN ('argo', 'worker', 'minecraft', 'platform', 'content')),
  CONSTRAINT "RecoveryIntent_fingerprint_check" CHECK ("fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "RecoveryIntent_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT "RecoveryIntent_generation_check" CHECK ("expectedGeneration" >= 0),
  CONSTRAINT "RecoveryIntent_sequence_check" CHECK ("sequence" >= 1)
);
CREATE UNIQUE INDEX "RecoveryIntent_workflowId_key" ON "RecoveryIntent"("workflowId");
CREATE UNIQUE INDEX "RecoveryIntent_deploymentId_sequence_key" ON "RecoveryIntent"("deploymentId", "sequence");
CREATE UNIQUE INDEX "RecoveryIntent_one_pending" ON "RecoveryIntent"("deploymentId") WHERE "status" = 'pending';
CREATE INDEX "RecoveryIntent_status_createdAt_idx" ON "RecoveryIntent"("status", "createdAt");
CREATE INDEX "RecoveryIntent_kind_status_createdAt_idx" ON "RecoveryIntent"("kind", "status", "createdAt");
CREATE INDEX "RecoveryIntent_deploymentId_createdAt_idx" ON "RecoveryIntent"("deploymentId", "createdAt");

INSERT INTO "RecoveryIntent" (
  "id", "kind", "deploymentId", "sequence", "requestedBy", "reason", "expectedGeneration", "fingerprint",
  "status", "workflowId", "submittedAt", "detail", "evidence", "barrier", "barrierRestoredAt",
  "message", "resultFingerprint", "createdAt", "finishedAt"
)
SELECT
  intents."id", intents."kind", intents."deploymentId",
  row_number() OVER (PARTITION BY intents."deploymentId" ORDER BY intents."createdAt", intents."id"),
  intents."requestedBy", intents."reason", intents."expectedEnvironmentGeneration", 'sha256:' || intents."snapshotFingerprint",
  intents."status", intents."workflowId", intents."submittedAt", intents."detail", intents."evidence",
  intents."barrier", intents."barrierRestoredAt",
  intents."message", intents."resultFingerprint", intents."createdAt", intents."finishedAt"
FROM (
  SELECT "id", 'worker' AS "kind", "deploymentId", "requestedBy", "reason", "expectedEnvironmentGeneration", "snapshotFingerprint",
    "status", "workflowId", "submittedAt",
    jsonb_build_object('poolFingerprint', "poolFingerprint") AS "detail",
    '[]'::jsonb AS "evidence", NULL::jsonb AS "barrier", NULL::timestamp(3) AS "barrierRestoredAt",
    "message", "resultFingerprint", "createdAt", "finishedAt"
  FROM "WorkerRecoveryIntent"
  UNION ALL
  SELECT "id", 'minecraft', "deploymentId", "requestedBy", "reason", "expectedEnvironmentGeneration", "snapshotFingerprint",
    "status", "workflowId", "submittedAt",
    jsonb_strip_nulls(jsonb_build_object('controllerReceipt', "controllerReceipt")),
    '[]'::jsonb, NULL::jsonb, NULL::timestamp(3),
    "message", "resultFingerprint", "createdAt", "finishedAt"
  FROM "MinecraftRecoveryIntent"
  UNION ALL
  SELECT "id", 'platform', "deploymentId", "requestedBy", "reason", "expectedEnvironmentGeneration", "snapshotFingerprint",
    "status", "workflowId", "submittedAt",
    jsonb_strip_nulls(jsonb_build_object('nativeReceipts', "nativeReceipts", 'planReceipt', "planReceipt", 'encryptedPlan', "encryptedPlan", 'planFingerprint', "planFingerprint", 'planApproval', "planApproval")),
    '[]'::jsonb, NULL::jsonb, NULL::timestamp(3),
    "message", "resultFingerprint", "createdAt", "finishedAt"
  FROM "PlatformRecoveryIntent"
  UNION ALL
  SELECT "id", 'content', "deploymentId", "requestedBy", "reason", "expectedEnvironmentGeneration", "snapshotFingerprint",
    "status", NULL, NULL,
    jsonb_build_object('targetKind', "targetKind", 'nativeReceipts', "nativeReceipts"),
    '[]'::jsonb, "dispatchBarrier", "barrierRestoredAt",
    "message", "resultFingerprint", "createdAt", "finishedAt"
  FROM "ContentRecoveryIntent"
) intents;

DROP TABLE "WorkerRecoveryIntent";
DROP TABLE "MinecraftRecoveryIntent";
DROP TABLE "PlatformRecoveryIntent";
DROP TABLE "ContentRecoveryIntent";

-- 4.18 Prerequisite edges, 4.19 monitor observations, A5 component references.
CREATE TABLE "PrerequisiteEdge" (
  "dependentId" TEXT NOT NULL,
  "prerequisiteId" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  CONSTRAINT "PrerequisiteEdge_pkey" PRIMARY KEY ("dependentId", "prerequisiteId"),
  CONSTRAINT "PrerequisiteEdge_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PrerequisiteEdge_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PrerequisiteEdge_rule_check" CHECK ("rule" IN ('any-accepted', 'same-or-later-order-key')),
  CONSTRAINT "PrerequisiteEdge_distinct_check" CHECK ("dependentId" <> "prerequisiteId")
);
CREATE INDEX "PrerequisiteEdge_prerequisiteId_idx" ON "PrerequisiteEdge"("prerequisiteId");

CREATE TABLE "MonitorObservation" (
  "deploymentId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "window" TEXT NOT NULL,
  "alarms" JSONB NOT NULL DEFAULT '[]',
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitorObservation_pkey" PRIMARY KEY ("deploymentId", "sequence"),
  CONSTRAINT "MonitorObservation_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MonitorObservation_outcome_check" CHECK ("outcome" IN ('watching', 'settled', 'alarmed'))
);

CREATE TABLE "ComponentReference" (
  "serviceId" TEXT NOT NULL,
  "component" TEXT NOT NULL,
  "sourceServiceId" TEXT NOT NULL,
  "sourceComponent" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "sourceEnvironment" TEXT,
  CONSTRAINT "ComponentReference_pkey" PRIMARY KEY ("serviceId", "component"),
  CONSTRAINT "ComponentReference_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComponentReference_sourceServiceId_fkey" FOREIGN KEY ("sourceServiceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComponentReference_mode_check" CHECK ("mode" IN ('pinned', 'tracking')),
  CONSTRAINT "ComponentReference_tracking_source_check" CHECK (("mode" = 'tracking') = ("sourceEnvironment" IS NOT NULL)),
  CONSTRAINT "ComponentReference_distinct_check" CHECK ("serviceId" <> "sourceServiceId")
);
CREATE INDEX "ComponentReference_sourceServiceId_sourceComponent_idx" ON "ComponentReference"("sourceServiceId", "sourceComponent");

-- Unverified import snapshots are replaced by the cold-start snapshot and
-- reconcile-after-restore; nothing reads them.
DROP TABLE "ImportedSnapshot";
