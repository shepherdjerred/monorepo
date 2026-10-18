import { z } from "zod";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
  type StageInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import {
  minecraftRuntimeImage,
  parseMinecraftEligibility,
  validateMinecraftPreservation,
} from "#lib/delivery/minecraft.ts";
import {
  runMinecraftEligibility,
  runMinecraftPreservation,
  MinecraftControllerReceiptSchema,
  type MinecraftControllerReceipt,
} from "#lib/delivery/minecraft-controller.ts";
const DeferredSchema = z
  .object({
    status: z.literal("waiting"),
    reason: z.literal("players-online"),
    originalReopened: z.literal(true),
  })
  .strict();
export type MinecraftEffects = {
  load: (id: string) => Promise<DeploymentDetail>;
  eligibility: (
    detail: DeploymentDetail,
    requestId: string,
  ) => Promise<unknown>;
  preserve: (
    detail: DeploymentDetail,
    requestId: string,
    onReceipt: (receipt: MinecraftControllerReceipt) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  stage: (id: string, input: StageInput) => Promise<void>;
};
const external: MinecraftEffects = {
  async load(id) {
    return await deliveryRequest(
      `deployments/${encodeURIComponent(id)}`,
      DeploymentDetailSchema,
    );
  },
  eligibility: runMinecraftEligibility,
  preserve: runMinecraftPreservation,
  async stage(id, input) {
    await deliveryRequest(
      `deployments/${encodeURIComponent(id)}/stages`,
      z.unknown(),
      input,
    );
  },
};

function requireActive(detail: DeploymentDetail): void {
  if (
    detail.deployment.cancelRequested ||
    ["canceled", "failed", "succeeded"].includes(detail.deployment.status)
  )
    throw ApplicationFailure.nonRetryable(
      "TSMC deployment was canceled or superseded before maintenance effects",
      "MinecraftCanceledBeforeEffect",
    );
  minecraftRuntimeImage(detail);
}

/** Read-only eligibility runs before PG claim so automatic requests can coalesce. */
export async function prepareMinecraftDelivery(
  detail: DeploymentDetail,
  effects: MinecraftEffects = external,
) {
  requireActive(detail);
  const result = parseMinecraftEligibility(
    await effects.eligibility(
      detail,
      deliveryOperationId(`${detail.deployment.id}:minecraft-preservation`),
    ),
  );
  return result.status === "eligible"
    ? ({ status: "ready" } as const)
    : ({ status: "waiting", reason: result.reason } as const);
}

/** A completed waiting attempt has no backup proof and cannot authorize Argo apply. */
export async function preserveDeliveryMinecraft(
  id: string,
  effects: MinecraftEffects = external,
) {
  const detail = await effects.load(id);
  requireActive(detail);
  if (
    detail.deployment.status !== "running" ||
    detail.environment.activeDeploymentId !== id
  )
    throw new Error("TSMC preservation requires the exact claimed environment");
  const attempts = detail.stages
    .map((stage) => ({
      stage,
      number: /^minecraft-preservation-(\d+)$/u.exec(stage.key)?.[1],
    }))
    .filter((entry) => entry.number !== undefined);
  const running = attempts.filter((entry) => entry.stage.status === "running");
  if (running.length > 1)
    throw new Error(
      "Multiple preservation attempts require independent recovery",
    );
  const next =
    Math.max(0, ...attempts.map((entry) => Number(entry.number))) + 1;
  const key = running[0]?.stage.key ?? `minecraft-preservation-${String(next)}`;
  const operationId = deliveryOperationId(`${id}:minecraft-preservation`);
  await effects.stage(id, {
    key,
    status: "running",
    operationId,
    message: "Awaiting the exact preservation controller incarnation",
    evidence: [],
  });
  const witness = { recorded: false };
  const result = await withBackupActivityHeartbeat(
    Context.current(),
    async ({ signal }) =>
      effects.preserve(
        detail,
        operationId,
        async (input) => {
          const receipt = MinecraftControllerReceiptSchema.parse(input);
          if (receipt.requestId !== operationId)
            throw new Error(
              "Preservation controller receipt belongs to another request",
            );
          await effects.stage(id, {
            key,
            status: "running",
            operationId,
            message: JSON.stringify(receipt),
            evidence: [
              {
                kind: "preflight",
                operationId: receipt.uid,
                summary: JSON.stringify({
                  adapter: "minecraft-preservation-controller",
                  ...receipt,
                }),
              },
            ],
          });
          witness.recorded = true;
        },
        signal,
      ),
    { stage: key },
  );
  if (!witness.recorded)
    throw new Error(
      "Preservation runner returned before recording its native identity",
    );
  const deferred = DeferredSchema.safeParse(result);
  if (deferred.success) {
    await effects.stage(id, {
      key,
      status: "succeeded",
      operationId,
      message:
        "Players joined; original admission safely reopened without stopping the server",
      evidence: [
        {
          kind: "preflight",
          operationId,
          summary: JSON.stringify(deferred.data),
        },
      ],
    });
    return { status: "waiting" } as const;
  }
  const evidence = validateMinecraftPreservation(detail, operationId, result);
  await effects.stage(id, {
    key,
    status: "succeeded",
    operationId,
    message:
      "Independent restore, candidate gameplay and untouched-source reopening verified",
    evidence,
  });
  return { status: "ready" } as const;
}
