import type { NativeRecoveryFileActivities } from "#shared/automation.ts";
import { readNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import { prepareNativeFiles, type NativeFileContext } from "./files.ts";
import { finishNativePreparation } from "./plan.ts";
import { applyPreparedNative } from "./apply.ts";

export function createNativeFileActivities(
  context: NativeFileContext,
): NativeRecoveryFileActivities {
  return {
    async prepareNativeRecoveryFiles(input) {
      const { planId } = input;
      const plan = await context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      if (plan.state === "awaiting_review" || plan.state === "applied") return;
      const prepared = await prepareNativeFiles(context, input);
      await finishNativePreparation(context.files.db, planId, prepared);
    },
    async applyNativeRecoveryFiles(input) {
      const receipt = await context.files.db.nativeRecoveryReceipt.findUnique({
        where: { planId: input.planId },
      });
      if (receipt !== null) {
        await readNativePlexReceipt(context.files.db, receipt.id);
        return;
      }
      const prepared = await prepareNativeFiles(context, input);
      await applyPreparedNative(context, input, prepared);
    },
  };
}
