import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type { DeploymentDetail, EvidenceInput } from "#shared/contract.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";

export type SyncTarget = {
  application: string;
  stage: string;
  applySafetyStage: string | null;
  preSyncStages: readonly string[];
  declaredStages: readonly string[];
};

export type SettledApplicationReadback = {
  identity: string;
  evidence: EvidenceInput;
};

export const ArgoRecoverySchema = z.object({
  metadata: z.object({
    name: z.string(),
    resourceVersion: z.string().min(1),
    annotations: z.record(z.string(), z.string()),
  }),
  operation: z.unknown().optional(),
  status: z.object({
    operationState: z.object({
      phase: z.enum(["Running", "Terminating", "Succeeded", "Failed", "Error"]),
      finishedAt: z.iso.datetime({ offset: true }).optional(),
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    }),
    resources: z
      .array(
        z.object({
          kind: z.string(),
          health: z.object({ status: z.string() }).optional(),
        }),
      )
      .default([]),
  }),
});

const UnsyncedApplicationSchema = ArgoRecoverySchema.extend({
  spec: z.object({
    source: z.record(z.string(), z.unknown()),
  }),
  status: ArgoRecoverySchema.shape.status.extend({
    history: z
      .array(
        z.object({
          id: z.number(),
          source: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1),
  }),
});

type UnsyncedApplication = z.infer<typeof UnsyncedApplicationSchema>;

/**
 * When any model Application target has not yet recorded its sync stage, every
 * recorded stage on the deployment must belong to a declared pre-sync step of
 * an unsynced target (apply-safety or a read-only gate such as players-offline)
 * or a declared step of a sibling Application whose sync stage is already
 * recorded. Deployments whose sync stages are all recorded take the existing
 * synced readback path; an unrecognised stage before sync fails closed rather
 * than assuming no external effect occurred (I2).
 */
export function requireKnownModelStages(
  detail: DeploymentDetail,
  targets: readonly SyncTarget[],
) {
  if (!targets.some((target) => target.applySafetyStage !== null)) return;
  const recorded = new Set(detail.stages.map((stage) => stage.key));
  if (targets.every((target) => recorded.has(target.stage))) return;
  const known = new Set(
    targets.flatMap((target) =>
      recorded.has(target.stage) ? target.declaredStages : target.preSyncStages,
    ),
  );
  for (const stage of detail.stages) {
    if (!known.has(stage.key))
      throw new DeliveryError(
        "CONFLICT",
        `Recovery cannot classify stage ${stage.key} for Application readback; keep target ownership`,
      );
  }
}

function requireQuiescentOwner(
  current: UnsyncedApplication,
  detail: DeploymentDetail,
  application: string,
) {
  const operation = current.status.operationState;
  const finishedAt = operation.finishedAt;
  const quiescent =
    current.metadata.name === application &&
    current.metadata.annotations["delivery.shepherdjerred.com/environment"] ===
      detail.environment.id &&
    (current.operation === undefined || current.operation === null) &&
    !["Running", "Terminating"].includes(operation.phase);
  if (!quiescent || finishedAt === undefined)
    throw new DeliveryError(
      "CONFLICT",
      `Argo ownership of ${application} differs or its work is unsettled; keep target ownership`,
    );
  if (
    current.status.resources.some(
      (entry) => entry.kind === "Job" && entry.health?.status !== "Healthy",
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Application includes an unsettled Job; inspect it through its specialized recovery procedure",
    );
  return { operation, finishedAt };
}

function requirePriorOperation(
  current: UnsyncedApplication,
  detail: DeploymentDetail,
  target: SyncTarget,
) {
  const info = current.status.operationState.operation.info;
  const requests = info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  const identities = info.filter(
    (entry) => entry.name === "ci.sjer.red/operation-id",
  );
  const priorRequestId = requests[0]?.value;
  const identity = identities[0]?.value;
  if (
    priorRequestId === undefined ||
    identity === undefined ||
    requests.length !== 1 ||
    identities.length !== 1
  )
    throw new DeliveryError(
      "CONFLICT",
      `Application ${target.application} has no unique prior operation identity; keep target ownership`,
    );
  const ownRequestId = deliveryOperationId(detail.deployment.id);
  const applySafetyId = detail.stages.find(
    (stage) => stage.key === target.applySafetyStage,
  )?.operationId;
  if (priorRequestId === ownRequestId || priorRequestId === applySafetyId)
    throw new DeliveryError(
      "CONFLICT",
      `Application ${target.application} carries this deployment's request without a recorded sync step; keep target ownership`,
    );
  return { priorRequestId, identity };
}

function requireSyncedHistorySource(
  current: UnsyncedApplication,
  application: string,
) {
  const latest = current.status.history.reduce((left, right) =>
    left.id > right.id ? left : right,
  );
  if (fingerprint(current.spec.source) !== fingerprint(latest.source))
    throw new DeliveryError(
      "CONFLICT",
      `Application ${application} holds an unsynced spec.source differing from history ${String(latest.id)}; restore the last synced source before settling`,
    );
  return latest;
}

/**
 * Proves a model Application target whose sync stage was never recorded (I2,
 * AI-423, AI-446): either the environment has never accepted a release and the
 * Application is absent, or the live Application is quiescent, owned by this
 * environment, still carries the last synced history entry's `spec.source` (no
 * stale written body), and its last Argo operation belongs to an earlier
 * deployment rather than this one.
 */
export async function inspectUnsyncedTarget(
  readApplication: ApplicationReader,
  detail: DeploymentDetail,
  target: SyncTarget,
  reason: string,
): Promise<SettledApplicationReadback> {
  if (target.applySafetyStage === null)
    throw new DeliveryError(
      "CONFLICT",
      `Deployment has no recorded reconciliation operation for ${target.application} to inspect`,
    );
  const raw = await readApplication(target.application);
  if (raw === null) {
    if (detail.previousAcceptedVersionSet !== null)
      throw new DeliveryError(
        "CONFLICT",
        `Application ${target.application} does not exist; keep target ownership`,
      );
    const identity = deliveryOperationId(detail.deployment.id);
    return {
      identity,
      evidence: {
        kind: "reconciliation",
        operationId: identity,
        summary: `Independent Application readback (no sync requested): ${target.application} is absent before any accepted release. ${reason}`,
      },
    };
  }
  const parsed = UnsyncedApplicationSchema.safeParse(raw);
  if (!parsed.success)
    throw new DeliveryError(
      "CONFLICT",
      `Deployment has no recorded reconciliation operation for ${target.application} to inspect`,
    );
  const current = parsed.data;
  const { operation, finishedAt } = requireQuiescentOwner(
    current,
    detail,
    target.application,
  );
  const { priorRequestId, identity } = requirePriorOperation(
    current,
    detail,
    target,
  );
  const latest = requireSyncedHistorySource(current, target.application);
  return {
    identity,
    evidence: {
      kind: "reconciliation",
      operationId: identity,
      summary: `Independent Application readback (no sync requested): ${current.metadata.name}, resourceVersion ${current.metadata.resourceVersion}, spec.source matches history ${String(latest.id)}, prior request ${priorRequestId}, operation ${identity}, phase ${operation.phase}, finished ${finishedAt}. ${reason}`,
    },
  };
}
