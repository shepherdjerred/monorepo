import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import { applicationOf } from "#shared/model/recipe-view.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import type { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { recoveryKindOf } from "./recovery-request.ts";

/**
 * Delivery opens and settles recovery itself instead of waiting for a person
 * (D5, I1, I2). A deployment that ended recovery-required gets one intent of
 * its own kind; the kind's independent reader still decides: worker and
 * platform dispatchers prove their target, and an `argo` intent settles only
 * when the API's own Application reader finds the deployment's operation
 * finished. Nothing here trusts the executor or releases a lock by itself.
 *
 * One attempt per deployment: a deployment that already has any intent,
 * opened automatically or by a person, is left to it, so a failed proof is
 * never retried on a loop and escalates through DeliveryRecoveryRequired.
 */
export const AUTO_RECOVERY_ACTOR: Principal = {
  id: "delivery/auto-recovery",
  kind: "machine",
  scopes: ["read", "admin"],
};

/** Content repair is a foreground operator command (README, content recovery). */
const OPERATOR_ONLY_KINDS: ReadonlySet<string> = new Set([
  "content",
  "minecraft",
]);

export type AutoRecoveryResult = {
  readonly opened: string[];
  readonly skipped: { deploymentId: string; reason: string }[];
};

export async function openAutomaticRecoveryIntents(
  this: Delivery,
): Promise<AutoRecoveryResult> {
  const candidates = await this.database.deployment.findMany({
    where: { recoveryRequired: true, recoveryIntents: { none: {} } },
    select: { id: true },
  });
  const opened: string[] = [];
  const skipped: { deploymentId: string; reason: string }[] = [];
  for (const { id } of candidates) {
    const detail = await this.detail(id);
    const kind = recoveryKindOf(detail);
    if (OPERATOR_ONLY_KINDS.has(kind)) {
      skipped.push({
        deploymentId: id,
        reason: `${kind} recovery is operator-run`,
      });
      continue;
    }
    try {
      const intent = await this.requestRecoveryIntent(
        id,
        {
          requestId: `auto-${id}`,
          reason:
            "Opened automatically: the deployment ended recovery-required and its independent reader decides",
          expectedGeneration: detail.environment.generation,
        },
        AUTO_RECOVERY_ACTOR,
      );
      opened.push(intent.id);
    } catch (error) {
      // A compound target names its sub-step, and a changed binding refuses
      // the intent: both are left for an operator, never forced.
      if (!(error instanceof DeliveryError)) throw error;
      skipped.push({ deploymentId: id, reason: error.message });
    }
  }
  return { opened, skipped };
}

const OperationInfoSchema = z.object({
  status: z.object({
    operationState: z.object({
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    }),
  }),
});

/**
 * Settles each pending `argo` intent whose Application the API's own reader
 * shows finished: the operation it names is handed to the same inspector the
 * admin route uses, which proves the recorded request, ownership annotation,
 * finished phase and settled Jobs. Anything it cannot prove stays pending.
 */
export async function settleAutomaticArgoIntents(
  this: Delivery,
  inspect: ReturnType<typeof createRecoveryInspector>,
  readApplication: ApplicationReader,
): Promise<string[]> {
  const pending = await this.database.recoveryIntent.findMany({
    where: { kind: "argo", status: "pending" },
    select: { id: true, deploymentId: true },
  });
  const settled: string[] = [];
  for (const intent of pending) {
    const detail = await this.detail(intent.deploymentId);
    const application = applicationOf(detail.pipeline.definition);
    if (application === null) continue;
    const parsed = OperationInfoSchema.safeParse(
      await readApplication(application.name),
    );
    const operationId = parsed.success
      ? parsed.data.status.operationState.operation.info.find(
          (entry) => entry.name === "ci.sjer.red/operation-id",
        )?.value
      : undefined;
    if (operationId === undefined) continue;
    const reason =
      "Settled automatically by independent Application readback of the finished operation";
    try {
      const evidence = await inspect(detail, { operationId, reason });
      await this.settleArgoIntent(
        intent.id,
        reason,
        AUTO_RECOVERY_ACTOR,
        evidence,
      );
      settled.push(intent.id);
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
    }
  }
  return settled;
}
