import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import {
  publicationInvocation,
  capturePublicationExecution,
  assertPublicationActive,
  type PublicationContext,
} from "#automation/publication-proof/invocation.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import type { NativeCompensationNetworkEvidence } from "#shared/native-recovery/compensation.ts";

export type CompensationFileContext = NativeFileContext & {
  files: PublicationContext;
  readonly execution: NativeCompensationExecutionContext;
};

/** Called for each invocation before its first await; the runtime retains only the factory. */
export function compensationInvocation(
  context: NativeFileContext,
  execution: NativeCompensationExecutionContext,
): CompensationFileContext {
  if (
    !Number.isSafeInteger(execution.expiresAtMs) ||
    execution.expiresAtMs <= 0
  )
    throw new TypeError("Compensation invocation deadline is invalid");
  return {
    ...context,
    execution: { ...execution, expiresAtMs: execution.expiresAtMs },
    files: publicationInvocation(
      context.files,
      capturePublicationExecution(() => execution, "native-compensation"),
    ),
  };
}

export function compensationDeadline(
  context: CompensationFileContext,
  network: NativeCompensationNetworkEvidence,
): () => void {
  assertNativeEvidenceFresh(network);
  const expires = Math.min(
    ...[network, network.quiescence, network.mounts].map((item) =>
      Date.parse(item.expiresAt),
    ),
  );
  const monotonic = performance.now() + expires - Date.now();
  return () => {
    assertPublicationActive(context.files);
    assertNativeEvidenceFresh(network);
    if (Date.now() >= expires || performance.now() >= monotonic)
      throw new Error("Compensation evidence deadline expired");
  };
}
