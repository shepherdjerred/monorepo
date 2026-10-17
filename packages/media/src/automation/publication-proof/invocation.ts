import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import type {
  PreparedSubtitleLineages,
  PublicationDependencies,
} from "./subtitle-lineage.ts";

export type PublicationExecution =
  NonNullable<FileContext["publicationExecution"]> extends () => infer Execution
    ? Execution
    : never;
export type PublicationContext = FileContext & {
  execution: PublicationExecution;
  preparedSubtitleLineages?: PreparedSubtitleLineages;
  publicationDependencies?: PublicationDependencies;
};

export function publicationInvocation(
  context: FileContext,
  execution: PublicationExecution,
): PublicationContext {
  execution.assertActive();
  execution.signal.throwIfAborted();
  return {
    ...context,
    execution,
    checkpoint: async (phase) => {
      execution.assertActive();
      execution.signal.throwIfAborted();
      await context.checkpoint(phase);
      await execution.checkpoint();
      execution.assertActive();
      execution.signal.throwIfAborted();
    },
  };
}

export function requirePublicationExecution(
  execution: PublicationExecution | undefined,
): PublicationExecution {
  if (execution === undefined)
    throw new FileGuardError("publication_execution_context_missing");
  execution.assertActive();
  execution.signal.throwIfAborted();
  return execution;
}

export function assertPublicationActive(context: PublicationContext): void {
  context.execution.assertActive();
  context.execution.signal.throwIfAborted();
  context.contentProof?.assertActive();
}
