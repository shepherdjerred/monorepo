import type { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { createHash } from "node:crypto";

/** Shared disposable PG fixture; synthetic observations never enter production. */
export async function seedContentRecovery(
  delivery: Delivery,
  deploymentId: string,
) {
  const claimed = await delivery.claim(deploymentId, testExecutor);
  await delivery.stage(
    deploymentId,
    {
      key: "reconcile",
      status: "running",
      operationId: deliveryOperationId(`${deploymentId}:reconcile`),
      message: "Local browser fixture: native forum operation interrupted",
      evidence: [],
    },
    testExecutor,
  );
  await delivery.finish(
    deploymentId,
    {
      status: "failed",
      recoveryRequired: true,
      message:
        "Local browser fixture: original native operation needs independent settlement",
      evidence: [],
    },
    testExecutor,
  );
  const input = {
    expectedEnvironmentGeneration: claimed.environment.generation,
    reason:
      "Inspect the exact frozen forum release and preserve the original backup",
  };
  const first = await delivery.requestContentRecovery(
    deploymentId,
    {
      ...input,
      requestId: "browser/content/refused",
    },
    testOperator,
  );
  await delivery.recordContentRecoveryNative(
    first.id,
    {
      action: "original",
      receipt: {
        namespace: "storm-forum",
        name: `storm-forum-release-${createHash("sha256").update(deploymentId).digest("hex").slice(0, 32)}`,
        uid: "81716b2a-415d-49bc-adbd-aadf761050aa",
        requestId: deploymentId,
        specFingerprint: "b".repeat(64),
      },
    },
    testExecutor,
  );
  await delivery.failContentRecovery(
    first.id,
    "Local fixture: foreign maintenance owner; ownership retained",
    testExecutor,
  );
  await delivery.requestContentRecovery(
    deploymentId,
    {
      ...input,
      requestId: "browser/content/pending",
    },
    testOperator,
  );
}
