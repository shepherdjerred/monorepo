import type { NativeRecoveryFileActivities } from "#shared/automation.ts";
import { prepareNativeFiles, type NativeFileContext } from "./files.ts";
import { finishNativePreparation } from "./plan.ts";
import { applyPreparedNative } from "./apply.ts";

export function createNativeFileActivities(
  context: NativeFileContext,
): NativeRecoveryFileActivities {
  return {
    async prepareNativeRecoveryFiles({ planId }) {
      const plan = await context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      if (plan.state === "awaiting_review" || plan.state === "applied") return;
      const prepared = await prepareNativeFiles(context, planId);
      await finishNativePreparation(context.files.db, planId, prepared);
    },
    async applyNativeRecoveryFiles(input) {
      const receipt = await context.files.db.nativeRecoveryReceipt.findUnique({
        where: { planId: input.planId },
      });
      if (receipt !== null) return;
      const prepared = await prepareNativeFiles(context, input.planId);
      await applyPreparedNative(context, input, prepared);
    },
  };
}
