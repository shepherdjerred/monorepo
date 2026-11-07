// Bun can write to a spawned child's extra pipe fd but never closes it
// (`Bun.write` and `FileSink.end` both leave it open), so the child would wait
// for EOF forever. Only the synchronous fd calls hand over /dev/fd/3 payloads.
// eslint-disable-next-line no-restricted-imports -- see above
import { closeSync, writeSync } from "node:fs";
import { constants } from "node:os";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

export type ForwardingSpawnOptions = {
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * Payloads written to file descriptors 3, 4, … of the child, then closed.
   * The child reads them as `/dev/fd/3` and so on; nothing touches disk.
   */
  readonly extraFiles?: readonly string[];
};

/** Exit status a shell would report for a child killed by `signal`. */
export function signalExitCode(signal: string): number {
  const number = Object.entries(constants.signals).find(
    ([name]) => name === signal,
  )?.[1];
  return 128 + (number ?? 0);
}

/**
 * Run `argv` with inherited stdio and wait for it, forwarding termination
 * signals so Ctrl-C and agent timeouts reach the child. Returns the child's
 * exit code, or 128+N when it died from signal N.
 */
export async function spawnForwardingSignals(
  argv: readonly string[],
  options: ForwardingSpawnOptions,
): Promise<number> {
  const extraFiles = options.extraFiles ?? [];
  const child = Bun.spawn([...argv], {
    env: { ...options.env },
    stdio: [
      "inherit",
      "inherit",
      "inherit",
      ...extraFiles.map(() => "pipe" as const),
    ],
  });
  const descriptors = child.stdio.slice(3);
  for (const [index, payload] of extraFiles.entries()) {
    const descriptor = descriptors[index];
    if (typeof descriptor !== "number") {
      child.kill();
      throw new TypeError(
        `toolkit: could not open file descriptor ${String(index + 3)} for the child`,
      );
    }
    writeSync(descriptor, payload);
    closeSync(descriptor);
  }
  const forward = (signal: NodeJS.Signals) => () => {
    child.kill(signal);
  };
  const handlers = FORWARDED_SIGNALS.map((signal) => {
    const handler = forward(signal);
    process.on(signal, handler);
    return { signal, handler };
  });
  try {
    const exitCode = await child.exited;
    return child.signalCode === null
      ? exitCode
      : signalExitCode(child.signalCode);
  } finally {
    for (const { signal, handler } of handlers) {
      process.off(signal, handler);
    }
  }
}
