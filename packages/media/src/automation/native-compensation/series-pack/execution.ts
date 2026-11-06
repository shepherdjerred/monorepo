import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { SeriesPackNativeFileExecutionV1 } from "#shared/native-recovery/series-pack/activities.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { CompensationFileContext } from "#automation/native-compensation/execution.ts";
import { publicationInvocation } from "#automation/publication-proof/invocation.ts";

/** Bind the SAME pre-lazy SDK attempt, cancellation, heartbeat and original
 * observation clock. Never call capturePublicationExecution here after IO. */
export function seriesPackNativeBindingExecutionV1(
  execution: SeriesPackNativeFileExecutionV1,
): PlexBindingExecution {
  execution.assertActive();
  execution.signal.throwIfAborted();
  return {
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    signal: execution.signal,
    assertActive: execution.assertActive,
    checkpoint: () => execution.checkpoint("series-pack-native-compensation"),
  };
}
export function seriesPackNativeFileContextV1(
  initial: NativeFileContext,
  execution: SeriesPackNativeFileExecutionV1,
): CompensationFileContext {
  const binding = seriesPackNativeBindingExecutionV1(execution);
  return {
    ...initial,
    files: publicationInvocation(initial.files, binding),
    execution,
  };
}
