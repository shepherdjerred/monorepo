export type RawCommandOptions = {
  cwd: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
};

export type CommandCapture = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function mergeCommandEnvironment(
  environment: Record<string, string | undefined>,
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && !(key in overrides)) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

async function spawnPipeCommand<TStdout>(
  command: string[],
  options: RawCommandOptions,
  readStdout: (stream: ReadableStream<Uint8Array>) => Promise<TStdout>,
): Promise<{ stdout: TStdout; stderr: string; exitCode: number }> {
  options.signal?.throwIfAborted();
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: mergeCommandEnvironment(Bun.env, options.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const onAbort = (): void => {
    child.kill();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readStdout(child.stdout),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    options.signal?.throwIfAborted();
    return { stdout, stderr, exitCode };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function captureCommand(
  command: string[],
  options: RawCommandOptions,
): Promise<CommandCapture> {
  return spawnPipeCommand(command, options, (stream) =>
    new Response(stream).text(),
  );
}

export type BinaryCommandCapture = {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number;
};

export async function captureBinaryCommand(
  command: string[],
  options: RawCommandOptions,
): Promise<BinaryCommandCapture> {
  return spawnPipeCommand(command, options, (stream) =>
    new Response(stream).bytes(),
  );
}
