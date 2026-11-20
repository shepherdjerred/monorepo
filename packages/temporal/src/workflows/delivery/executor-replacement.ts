import {
  ActivityFailure,
  ApplicationFailure,
  patched,
} from "@temporalio/workflow";
import {
  DELIVERY_EXECUTOR_REPLACED,
  type DeliveryModelStepResult,
} from "#shared/delivery-executor.ts";

/**
 * D8: a self-hosted step interrupted by its own executor's replacement runs
 * again on the replacement worker instead of finishing the deployment
 * failed. Histories recorded before it finished such a deployment failed.
 */
export const DELIVERY_EXECUTOR_REPLACED_PATCH =
  "delivery-executor-replaced-resume-v1";

/**
 * Consecutive replacements one step may survive. Each needs a real worker
 * shutdown mid-step; more than this is a crash loop, which fails loudly.
 */
const EXECUTOR_REPLACEMENTS_PER_STEP = 3;

function executorReplaced(error: unknown): boolean {
  return (
    error instanceof ActivityFailure &&
    error.cause instanceof ApplicationFailure &&
    error.cause.type === DELIVERY_EXECUTOR_REPLACED
  );
}

/**
 * Runs one model step across bounded self-hosted executor replacements (D8).
 * Keeps the legacy `ActivityFailure` catch branch so recorded histories that
 * failed the Activity with `DeliveryExecutorReplaced` replay identically.
 */
export async function runStepAcrossReplacements(input: {
  deploymentId: string;
  key: string;
  handoff: boolean;
  runOnce: (key: string) => Promise<DeliveryModelStepResult>;
  renewLease: (deploymentId: string) => Promise<void>;
}): Promise<DeliveryModelStepResult> {
  const { deploymentId, key, handoff, runOnce, renewLease } = input;
  for (let replaced = 0; ; replaced++) {
    let result: DeliveryModelStepResult;
    try {
      result = await runOnce(key);
    } catch (error) {
      if (
        !handoff ||
        replaced >= EXECUTOR_REPLACEMENTS_PER_STEP ||
        !executorReplaced(error) ||
        !patched(DELIVERY_EXECUTOR_REPLACED_PATCH)
      )
        throw error;
      await renewLease(deploymentId);
      continue;
    }
    if (result.executorReplaced !== true) return result;
    if (!handoff || replaced >= EXECUTOR_REPLACEMENTS_PER_STEP)
      throw ApplicationFailure.nonRetryable(
        handoff
          ? `Step ${key} exceeded ${String(EXECUTOR_REPLACEMENTS_PER_STEP)} consecutive executor replacements`
          : `Non-self-hosted deployment ${deploymentId} reported executor replacement on ${key}`,
        DELIVERY_EXECUTOR_REPLACED,
      );
    await renewLease(deploymentId);
  }
}
