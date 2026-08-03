import { combineFailures } from "./cli-failures.ts";

export type TerminalLineResult = "continue" | "stop";
export type TerminalOutcome =
  | { status: "completed" }
  | { status: "failed"; error: unknown };

export function createSharedShutdown<Result>(
  shutdown: () => Promise<Result>,
): () => Promise<Result> {
  let shutdownPromise: Promise<Result> | undefined;
  return () => {
    shutdownPromise ??= Promise.resolve().then(shutdown);
    return shutdownPromise;
  };
}

export type ResourceSettlement<Snapshot> = {
  snapshot: Snapshot | null;
  failure: Error | undefined;
};

export async function settleRunResources<Snapshot>(options: {
  closeInput: () => void;
  settleController: () => Promise<Snapshot | null>;
  observeSnapshot: (snapshot: Snapshot) => void;
  settleRuntime: () => Promise<void>;
}): Promise<ResourceSettlement<Snapshot>> {
  let failure: Error | undefined;
  let snapshot: Snapshot | null = null;
  try {
    // Stop accepting operator input before waiting for model or worker
    // settlement. Otherwise a late /tick can begin outside the shutdown
    // boundary that is already being awaited.
    options.closeInput();
  } catch (error) {
    failure = combineFailures(failure, error);
  }
  try {
    snapshot = await options.settleController();
  } catch (error) {
    failure = combineFailures(failure, error);
  }
  if (snapshot !== null) {
    try {
      options.observeSnapshot(snapshot);
    } catch (error) {
      failure = combineFailures(failure, error);
    }
  }
  try {
    await options.settleRuntime();
  } catch (error) {
    failure = combineFailures(failure, error);
  }
  return { snapshot, failure };
}

export async function settleAllOrThrow(
  settlements: Iterable<Promise<unknown>>,
): Promise<void> {
  const results = await Promise.all(
    [...settlements].map(async (settlement) => {
      try {
        await settlement;
        return { status: "completed" } as const;
      } catch (error) {
        return { status: "failed", error } as const;
      }
    }),
  );
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "failed") {
      failures.push(result.error);
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Multiple asynchronous settlements failed",
    );
  }
}

export async function consumeTerminalLines(
  lines: AsyncIterable<string>,
  onLine: (line: string) => Promise<TerminalLineResult>,
  onEnd: (outcome: TerminalOutcome) => Promise<void>,
): Promise<void> {
  let outcome: TerminalOutcome = { status: "completed" };
  try {
    for await (const line of lines) {
      if ((await onLine(line)) === "stop") {
        return;
      }
    }
  } catch (error) {
    outcome = { status: "failed", error };
    throw error;
  } finally {
    // EOF, an input failure, and an explicit stop all converge on the same
    // idempotent shutdown path, so workers and model turns cannot outlive the
    // terminal that owned them.
    await onEnd(outcome);
  }
}
