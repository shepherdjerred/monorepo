import assert from "node:assert/strict";
import { z } from "zod";

/** Observed official Obsidian1.14.5 eval presentation; CLI errors are never accepted. */
export function parseOfficialEvalBoolean(bytes: Uint8Array): boolean {
  const output = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  return z.enum(["=> true", "=> false"]).parse(output) === "=> true";
}

/** Raw official version bytes stay private and preserve every whitespace byte. */
export async function boundedOfficialRead(options: {
  cli: string;
  args: string[];
  cwd: string;
  environment: Record<string, string>;
  timeoutMS: number;
}): Promise<Uint8Array> {
  const { cli, args, cwd, environment, timeoutMS } = options;
  const child = Bun.spawn([cli, ...args], {
    cwd,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  let expired = false;
  let stopped = false;
  const stop = () => {
    if (stopped || child.exitCode !== null) return;
    stopped = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  const timer = setTimeout(() => {
    expired = true;
    stop();
  }, timeoutMS);
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        assert.ok(size <= 8 * 1024 * 1024);
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return new Uint8Array(Buffer.concat(parts));
  };
  try {
    const [bytes, stderr, exit] = await Promise.all([
      read(child.stdout),
      read(child.stderr),
      child.exited,
    ]);
    assert.equal(expired, false);
    assert.equal(exit, 0);
    assert.equal(stderr.length, 0);
    return bytes;
  } catch {
    stop();
    await child.exited;
    throw new Error(
      "Official CLI failed its private bounded read; inspect state before retry",
    );
  } finally {
    clearTimeout(timer);
  }
}
