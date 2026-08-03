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
