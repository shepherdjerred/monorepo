import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import type {
  PreparedSubtitleLineages,
  PublicationDependencies,
} from "./subtitle-lineage.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/authority.ts";

export type PublicationExecution =
  NonNullable<FileContext["publicationExecution"]> extends () => infer Execution
    ? Execution
    : never;
export type PublicationContext = FileContext & {
  execution: PublicationExecution;
  preparedSubtitleLineages?: PreparedSubtitleLineages;
  publicationDependencies?: PublicationDependencies;
  movieManagement?: MovieManagementInvocation;
};

/** Capture once at entry, before creating the invocation-local SDK adapter. */
export function capturePublicationExecution(
  factory: () => Omit<PublicationExecution, "observed" | "checkpoint"> & {
    checkpoint: (phase: string) => Promise<void>;
  },
  phase: string,
): PublicationExecution {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const execution = factory();
  return {
    observed,
    expiresAtMs: execution.expiresAtMs,
    signal: execution.signal,
    assertActive: execution.assertActive,
    checkpoint: () => execution.checkpoint(phase),
  };
}

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
  context.libraryManagement?.freshness.assertActive();
  context.contentProof?.assertActive();
}

/** Bound fresh authority to the original invocation, including time spent awaiting earlier work. */
export function publicationDeadline(
  execution: PublicationExecution,
  authorityExpiresAtMs: number,
): { assertActive: () => void; expiresAtMs: number } {
  const { observed } = execution;
  const expiresAtMs = Math.floor(
    Math.min(
      observed.wall + 60_000,
      execution.expiresAtMs,
      authorityExpiresAtMs,
    ),
  );
  const monotonicDeadline = observed.monotonic + expiresAtMs - observed.wall;
  if (
    !Number.isSafeInteger(execution.expiresAtMs) ||
    execution.expiresAtMs <= 0 ||
    !Number.isSafeInteger(expiresAtMs) ||
    !Number.isFinite(monotonicDeadline)
  )
    throw new FileGuardError("publication_authority_expired");
  const assertActive = () => {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (
      Date.now() < observed.wall ||
      Date.now() >= expiresAtMs ||
      performance.now() >= monotonicDeadline
    )
      throw new FileGuardError("publication_authority_expired");
  };
  assertActive();
  return { assertActive, expiresAtMs };
}
