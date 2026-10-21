import { z } from "zod";
import { IdentifierSchema } from "#shared/artifact-contract.ts";
import { WorkerPoolSnapshotSchema } from "#shared/worker-contract.ts";
import { PlatformReleaseSnapshotSchema } from "#shared/platform-contract.ts";
import { ControlPlaneUpgradeSnapshotSchema } from "#shared/control-plane-contract.ts";
import { ForumBaselineSnapshotSchema } from "#shared/forum-contract.ts";
import { MonitorStateSchema } from "#shared/model/monitor-contract.ts";
import { AdmissionSnapshotSchema } from "#shared/model/admission-contract.ts";

const TimestampSchema = z.iso.datetime();
export const DeploymentStatusSchema = z.enum([
  "awaiting_approval",
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);
export const DeploymentSchema = z.object({
  repairOfDeploymentId: IdentifierSchema.nullable().default(null),
  id: IdentifierSchema,
  requestId: IdentifierSchema,
  environmentId: IdentifierSchema,
  serviceId: IdentifierSchema,
  versionSetRevisionId: IdentifierSchema,
  pipelineRevisionId: IdentifierSchema,
  configurationId: IdentifierSchema,
  workerSnapshot: WorkerPoolSnapshotSchema.nullable().default(null),
  platformSnapshot: PlatformReleaseSnapshotSchema.nullable().default(null),
  controlPlaneSnapshot:
    ControlPlaneUpgradeSnapshotSchema.nullable().default(null),
  forumBaselineSnapshot: ForumBaselineSnapshotSchema.nullable().default(null),
  previousAcceptedVersionSetRevisionId:
    IdentifierSchema.nullable().default(null),
  previousAcceptedDeploymentId: IdentifierSchema.nullable().default(null),
  restoredDeploymentId: IdentifierSchema.nullable().default(null),
  sourceEnvironmentId: IdentifierSchema.nullable().default(null),
  admissionSnapshot: AdmissionSnapshotSchema.nullable().default(null),
  catalogRevision: z.string().min(1),
  expectedGeneration: z.number().int().nonnegative(),
  kind: z.enum([
    "deploy",
    "promote",
    "rollback",
    "rebind",
    "retire-host",
    "channel-publish",
    "operator-run",
    "adopt-worker",
    "repair-trmnl",
    // Readable history only; no longer creatable.
    "upgrade-control-plane",
    "root-release",
    "tofu-plan",
    "tofu-apply",
  ]),
  status: DeploymentStatusSchema,
  automatic: z.boolean().default(false),
  requestedBy: z.string(),
  message: z.string().nullable(),
  cancelRequested: z.boolean(),
  recoveryRequired: z.boolean(),
  workflowId: z.string().nullable().default(null),
  workflowRunId: z.string().nullable().default(null),
  leaseExpiresAt: TimestampSchema.nullable().default(null),
  /** Left owned by the outgoing executor of a self-hosted deployment for its successor (D8). */
  handoffAt: TimestampSchema.nullable().default(null),
  monitorState: MonitorStateSchema.nullable().default(null),
  monitorSettledAt: TimestampSchema.nullable().default(null),
  monitorAlarmedAt: TimestampSchema.nullable().default(null),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
});
