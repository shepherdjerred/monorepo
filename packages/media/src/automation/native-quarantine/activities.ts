import type { NativeQuarantineFileActivities } from "#shared/automation.ts";
import { readNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { prepareNativeQuarantineFiles } from "./files.ts";
import { finishQuarantinePreparation } from "./plan.ts";
import { applyPreparedQuarantine } from "./apply.ts";
import { restoreNativeQuarantine } from "./restore.ts";
import { NativeQuarantineProtection } from "#infrastructure/native-quarantine/errors.ts";

export function createNativeQuarantineFileActivities(
  context: NativeFileContext,
): NativeQuarantineFileActivities {
  return {
    async prepareNativeQuarantineFiles(input) {
      const plan = await context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: input.planId },
      });
      if (["awaiting_review", "applied"].includes(plan.state)) return;
      const prepared = await prepareNativeQuarantineFiles(context, input);
      await finishQuarantinePreparation(context, input, prepared);
    },
    async applyNativeQuarantineFiles(input) {
      const receipt = await context.files.db.nativeRecoveryReceipt.findUnique({
        where: { planId: input.planId },
      });
      if (receipt !== null) {
        await readNativePlexReceipt(context.files.db, receipt.id);
        return;
      }
      const prepared = await prepareNativeQuarantineFiles(context, input);
      await applyPreparedQuarantine(context, input, prepared);
    },
    async restoreNativeQuarantineFiles(input) {
      try {
        await restoreNativeQuarantine(context, input);
        return { status: "restored" };
      } catch (error) {
        if (error instanceof NativeQuarantineProtection)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
  };
}
