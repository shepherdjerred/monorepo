import { DeliveryError } from "#domain/error.ts";
import type { DeploymentDetail, Principal } from "#shared/contract.ts";
import {
  RecoveryIntentRequestSchema,
  type RecoveryIntentRequest,
} from "#shared/model/route-contract.ts";
import type { RecoveryIntentKind } from "#shared/recovery-intent.ts";
import { forumReleaseOf, siteReleaseOf } from "#shared/model/recipe-view.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  fingerprint,
  lock,
  required,
} from "#infrastructure/delivery-records.ts";
import { createIntent } from "#infrastructure/recovery-intents.ts";
import { modelTofuTarget } from "#infrastructure/platform-recovery/context.ts";
import { recoveryIntentView } from "#infrastructure/selection/views.ts";

/** Which independent reader settles a quarantined deployment (4.15). */
export function recoveryKindOf(
  detail: DeploymentDetail,
): Exclude<RecoveryIntentKind, "forum-baseline"> {
  const deployment = detail.deployment;
  if (
    deployment.platformSnapshot !== null ||
    deployment.controlPlaneSnapshot !== null
  )
    return "platform";
  if (deployment.workerSnapshot !== null) return "worker";
  // A model tofu recipe has no Application: its saved plan, native Jobs and
  // state marker are inspected by platform recovery.
  if (modelTofuTarget(detail) !== null) return "platform";
  const definition = detail.pipeline.definition;
  return siteReleaseOf(definition) !== undefined ||
    forumReleaseOf(definition) !== undefined
    ? "content"
    : "argo";
}

/**
 * An ordinary Application deployment's intent: settled later by the
 * independent Application readback (`POST /recovery-intents/:id/settle`).
 */
async function argoIntent(
  this: Delivery,
  detail: DeploymentDetail,
  input: RecoveryIntentRequest,
  actor: Principal,
) {
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${detail.deployment.id}`);
    const id = `argo/${input.requestId}`;
    const existing = await tx.recoveryIntent.findUnique({ where: { id } });
    if (existing !== null) return existing.id;
    const row = required(
      await tx.deployment.findUnique({ where: { id: detail.deployment.id } }),
      "Deployment",
    );
    const env = await tx.environment.findUniqueOrThrow({
      where: { id: row.environmentId },
    });
    if (!row.recoveryRequired)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment does not require recovery",
      );
    if (env.generation !== input.expectedGeneration)
      throw new DeliveryError(
        "CONFLICT",
        "Environment binding generation changed since the request was prepared",
      );
    const intent = await createIntent(tx, {
      id,
      kind: "argo",
      deploymentId: row.id,
      requestedBy: actor.id,
      reason: input.reason,
      expectedGeneration: env.generation,
      snapshotFingerprint: fingerprint({
        deploymentId: row.id,
        resultFingerprint: row.resultFingerprint,
        generation: env.generation,
      }),
      ...(input.step === undefined ? {} : { step: input.step }),
    });
    return intent.id;
  });
}

/** The per-kind request a specialized reader settles; each returns the intent's id. */
async function specializedIntent(
  this: Delivery,
  target: {
    kind: "platform" | "worker" | "minecraft" | "content";
    deploymentId: string;
  },
  input: {
    requestId: string;
    expectedEnvironmentGeneration: number;
    reason: string;
  },
  actor: Principal,
): Promise<string> {
  const { kind, deploymentId } = target;
  if (kind === "minecraft") {
    this.requestMinecraftRecovery(deploymentId, input, actor);
    throw new DeliveryError(
      "INVALID",
      "Minecraft recovery was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
    );
  }
  const requests = {
    platform: async () =>
      this.requestPlatformRecovery(deploymentId, input, actor),
    worker: async () => this.requestWorkerRecovery(deploymentId, input, actor),
    content: async () =>
      this.requestContentRecovery(deploymentId, input, actor),
  };
  const intent = await requests[kind]();
  return intent.id;
}

/**
 * `POST /deployments/:id/recovery-intents` (admin, I1): one route over the
 * unified intent table; the deployment's kind picks the reader that will
 * settle it.
 */
export async function requestRecoveryIntent(
  this: Delivery,
  deploymentId: string,
  raw: RecoveryIntentRequest,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RecoveryIntentRequestSchema.parse(raw);
  const detail = await this.detail(deploymentId);
  const kind = recoveryKindOf(detail);
  if (input.expectedKind !== undefined && input.expectedKind !== kind)
    throw new DeliveryError(
      "INVALID",
      `Deployment ${deploymentId} recovers through a ${kind} intent, not ${input.expectedKind}; no intent was opened`,
    );
  if (kind !== "argo" && input.step !== undefined)
    throw new DeliveryError(
      "INVALID",
      `A ${kind} recovery intent names no sub-step`,
    );
  const specialized = {
    requestId: input.requestId,
    expectedEnvironmentGeneration: input.expectedGeneration,
    reason: input.reason,
  };
  const intentId =
    kind === "argo"
      ? await argoIntent.call(this, detail, input, actor)
      : await specializedIntent.call(
          this,
          { kind, deploymentId },
          specialized,
          actor,
        );
  return recoveryIntentView(
    await this.database.recoveryIntent.findUniqueOrThrow({
      where: { id: intentId },
    }),
  );
}

/** `GET /recovery-intents/:id`. */
export async function recoveryIntent(this: Delivery, intentId: string) {
  return recoveryIntentView(
    required(
      await this.database.recoveryIntent.findUnique({
        where: { id: intentId },
      }),
      "Recovery intent",
    ),
  );
}
