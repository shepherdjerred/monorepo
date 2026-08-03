export type TerminalLineResult = "continue" | "stop";

export async function consumeTerminalLines(
  lines: AsyncIterable<string>,
  onLine: (line: string) => Promise<TerminalLineResult>,
  onEnd: () => Promise<void>,
): Promise<void> {
  try {
    for await (const line of lines) {
      if ((await onLine(line)) === "stop") {
        return;
      }
    }
  } finally {
    // EOF, an input failure, and an explicit stop all converge on the same
    // idempotent shutdown path, so workers and model turns cannot outlive the
    // terminal that owned them.
    await onEnd();
  }
}
