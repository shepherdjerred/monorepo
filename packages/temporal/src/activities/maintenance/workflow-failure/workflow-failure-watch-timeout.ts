/**
 * Per-RPC timeouts for the workflow-failure watch poller.
 *
 * The Temporal SDK calls the poller depends on (`client.workflow.list()`,
 * `handle.result()`, `handle.fetchHistory()`) accept no abort signal, so a
 * hung server leaves the activity burning its full start-to-close budget with
 * heartbeats flowing and zero checkpoint progress. Racing each RPC against a
 * bounded timer converts a hang into a fast, attributed failure that flows
 * through the existing retry and checkpoint paths.
 */

// Matches the `AbortSignal.timeout(30_000)` precedent used for bounded
// external fetches elsewhere in this package (llm-billing,
// glitter-corpus-discord-client): far enough under the 2-minute activity
// start-to-close that a fully-hung attempt fails fast.
export const DEFAULT_WORKFLOW_FAILURE_RPC_TIMEOUT_MS = 30_000;

export class WorkflowFailureRpcTimeoutError extends Error {
  readonly rpc: string;
  readonly timeoutMs: number;

  constructor(rpc: string, timeoutMs: number) {
    super(
      `workflow-failure-watch RPC ${rpc} timed out after ${String(timeoutMs)}ms`,
    );
    this.name = "WorkflowFailureRpcTimeoutError";
    this.rpc = rpc;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Races `promise` against a `timeoutMs` timer that rejects with a
 * `WorkflowFailureRpcTimeoutError` naming `rpc`. The timer is always cleared,
 * and the input promise carries a handler so a late rejection after the
 * timeout wins is never reported as unhandled.
 */
export async function withWorkflowFailureRpcTimeout<T>(
  promise: Promise<T>,
  rpc: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new WorkflowFailureRpcTimeoutError(rpc, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
