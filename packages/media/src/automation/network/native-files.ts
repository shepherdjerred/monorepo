import { createNativeCompensationFileActivities } from "#automation/native-compensation/activities.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import type { NativeArchiveExecution } from "#automation/native-archive/execution.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";

/** Cached factories receive the original capability separately for each invocation. */
export function createNativeFileFacets(context: NativeFileContext) {
  return {
    compensation: (execution: NativeCompensationExecutionContext) =>
      createNativeCompensationFileActivities(context, () => execution),
    archive: (execution: NativeArchiveExecution) =>
      createNativeArchiveFileActivities(context, () => execution),
  };
}
