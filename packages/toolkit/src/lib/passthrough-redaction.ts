import type { Writable } from "node:stream";

/** Forward bytes promptly, holding only a possible credential prefix. */
export async function forwardRedactedOutput(
  stream: ReadableStream<Uint8Array>,
  output: Writable,
  credential: string,
): Promise<void> {
  const secret = Buffer.from(credential);
  if (secret.length === 0) throw new Error("Redaction requires a credential");
  const replacement = Buffer.from("[REDACTED]");
  let pending = Buffer.alloc(0);
  async function write(bytes: Buffer): Promise<void> {
    if (bytes.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      output.write(bytes, (error) => {
        if (error !== null && error !== undefined) reject(error);
        else resolve();
      });
    });
  }
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk]);
    let match = pending.indexOf(secret);
    while (match !== -1) {
      await write(pending.subarray(0, match));
      await write(replacement);
      pending = pending.subarray(match + secret.length);
      match = pending.indexOf(secret);
    }
    let held = Math.min(pending.length, secret.length - 1);
    while (
      held > 0 &&
      !pending.subarray(-held).equals(secret.subarray(0, held))
    )
      held -= 1;
    await write(pending.subarray(0, pending.length - held));
    pending = pending.subarray(pending.length - held);
  }
  await write(pending);
}

/** Protect the brokered Argo token even when native usage follows an error. */
export async function runRedactedPassthrough(
  invocation: {
    readonly args: readonly string[];
    readonly env: Record<string, string | undefined>;
  },
  executable: string,
  credential: string,
  mirrorTermination: boolean,
): Promise<number> {
  const child = Bun.spawn([executable, ...invocation.args], {
    env: { ...invocation.env },
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const signals: readonly NodeJS.Signals[] = [
    "SIGINT",
    "SIGTERM",
    "SIGHUP",
    "SIGQUIT",
    "SIGUSR1",
    "SIGUSR2",
    "SIGWINCH",
  ];
  const handlers = signals.map((signal) => {
    const handler = () => {
      if (child.exitCode === null) child.kill(signal);
    };
    process.on(signal, handler);
    return { signal, handler };
  });
  let exitCode: number;
  try {
    [exitCode] = await Promise.all([
      child.exited,
      forwardRedactedOutput(child.stdout, process.stdout, credential),
      forwardRedactedOutput(child.stderr, process.stderr, credential),
    ]);
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    for (const { signal, handler } of handlers) process.off(signal, handler);
  }
  if (mirrorTermination && child.signalCode !== null)
    process.kill(process.pid, child.signalCode);
  return exitCode;
}
