import type { NativeFileContext } from "#automation/native-recovery/files.ts";

/** Invocation-local deadline/cancellation capability; never serialized or cached with the worker. */
export type NativeArchiveExecution = {
  signal: AbortSignal;
  assertActive: () => void;
  checkpoint: () => Promise<void>;
};
export type ArchiveFileContext = NativeFileContext & {
  execution: NativeArchiveExecution;
};

export function assertArchiveActive(execution: NativeArchiveExecution): void {
  execution.signal.throwIfAborted();
  execution.assertActive();
}

export async function archiveAwait<T>(
  execution: NativeArchiveExecution,
  work: PromiseLike<T>,
): Promise<T> {
  assertArchiveActive(execution);
  const result = await work;
  assertArchiveActive(execution);
  return result;
}

export function archiveContext(
  context: NativeFileContext,
  execution: NativeArchiveExecution,
): ArchiveFileContext {
  assertArchiveActive(execution);
  return {
    ...context,
    execution,
    files: {
      ...context.files,
      checkpoint: async (phase) => {
        assertArchiveActive(execution);
        await context.files.checkpoint(phase);
        assertArchiveActive(execution);
        await execution.checkpoint();
        assertArchiveActive(execution);
      },
    },
  };
}
