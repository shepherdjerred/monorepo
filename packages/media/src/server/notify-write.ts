/** A committed command remains successful when its durable outbox dispatch is deferred. */
export async function notifyCommittedWrite(
  dependencies: {
    afterWrite?: () => Promise<void>;
    onError: (error: Error, requestId: string) => void;
  },
  requestId: string,
): Promise<void> {
  try {
    await dependencies.afterWrite?.();
  } catch {
    dependencies.onError(new Error("Outbox dispatch deferred"), requestId);
  }
}
