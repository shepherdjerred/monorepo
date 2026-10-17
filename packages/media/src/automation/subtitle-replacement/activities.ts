import type {
  SubtitleReplacementFileActivities,
  SubtitleReplacementInput,
  SubtitleReplacementResult,
} from "#shared/subtitle-replacement.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { prepareReplacement } from "./prepare.ts";
import { applyReplacement } from "./apply.ts";
import { cleanupReplacement } from "./cleanup.ts";

export function createSubtitleReplacementActivities(
  context: FileContext,
): SubtitleReplacementFileActivities {
  const run = async (
    input: SubtitleReplacementInput,
    action: () => Promise<SubtitleReplacementResult>,
    cleanup = false,
  ): Promise<SubtitleReplacementResult> => {
    try {
      return await action();
    } catch (error) {
      if (
        !(error instanceof FileGuardError) &&
        !(error instanceof FileOperationConflict)
      )
        throw error;
      const reason =
        error instanceof FileGuardError
          ? error.reason
          : "subtitle_replacement_filesystem_protected";
      await context.db.subtitleReplacement.updateMany({
        where: {
          id: input.replacementId,
          ...(cleanup
            ? { cleanupState: { not: "cleaned" } }
            : {
                coordinatorOperationId: input.operationId,
                reservationActive: true,
              }),
        },
        data: cleanup
          ? { cleanupReason: reason }
          : { reason, state: "protected", version: { increment: 1 } },
      });
      return { state: "protected", reason };
    }
  };
  return {
    prepareSubtitleReplacement: (input) =>
      run(input, () => prepareReplacement(context, input)),
    applySubtitleReplacement: (input) =>
      run(input, () => applyReplacement(context, input)),
    reconcileSubtitleReplacement: (input) =>
      run(input, () => applyReplacement(context, input, true)),
    cleanupSubtitleReplacement: (input) =>
      run(input, () => cleanupReplacement(context, input), true),
  };
}
