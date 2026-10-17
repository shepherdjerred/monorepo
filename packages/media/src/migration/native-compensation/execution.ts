import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";

export function assertCompensationActive(
  execution: NativeCompensationExecutionContext,
) {
  execution.signal.throwIfAborted();
  execution.assertActive();
}

export async function compensationAwait<T>(
  execution: NativeCompensationExecutionContext,
  work: () => Promise<T>,
): Promise<T> {
  assertCompensationActive(execution);
  const result = await work();
  assertCompensationActive(execution);
  return result;
}
