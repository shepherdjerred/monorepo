export type CapacityExecution = {
  signal: AbortSignal;
  checkpoint: () => Promise<void>;
  assertActive: () => void;
};

export async function checkpoint(execution: CapacityExecution): Promise<void> {
  execution.signal.throwIfAborted();
  execution.assertActive();
  await execution.checkpoint();
  execution.signal.throwIfAborted();
  execution.assertActive();
}

export function assertActive(execution: CapacityExecution): void {
  execution.signal.throwIfAborted();
  execution.assertActive();
}
