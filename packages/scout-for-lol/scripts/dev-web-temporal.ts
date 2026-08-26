import path from "node:path";

const START_TIMEOUT_MS = 300_000;

async function waitForTemporal(
  temporalUiPort: number,
  temporal: Bun.Subprocess,
): Promise<void> {
  const startedAt = Date.now();
  let lastFailure: unknown;
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (temporal.exitCode !== null) {
      throw new Error(
        `Temporal dev server exited with code ${temporal.exitCode.toString()} before becoming ready`,
      );
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${temporalUiPort.toString()}/`,
      );
      if (response.ok) return;
      lastFailure = new Error(
        `Temporal UI readiness returned HTTP ${response.status.toString()}`,
      );
    } catch (error: unknown) {
      lastFailure = error;
    }
    await Bun.sleep(250);
  }
  throw new Error("Temporal dev server did not become ready", {
    cause: lastFailure,
  });
}

type TemporalDevServerOptions = {
  readonly root: string;
  readonly backendPort: number;
  readonly temporalPort: number;
  readonly temporalUiPort: number;
  readonly environment: Record<string, string | undefined>;
};

export async function startTemporalDevServer(
  options: TemporalDevServerOptions,
): Promise<Bun.Subprocess> {
  const temporalDatabase = path.join(
    options.root,
    `.temporal-dev-${options.backendPort.toString()}.db`,
  );
  const temporal = Bun.spawn(
    [
      "temporal",
      "server",
      "start-dev",
      "--ip",
      "127.0.0.1",
      "--port",
      options.temporalPort.toString(),
      "--ui-port",
      options.temporalUiPort.toString(),
      "--db-filename",
      temporalDatabase,
    ],
    {
      cwd: options.root,
      env: options.environment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  try {
    await waitForTemporal(options.temporalUiPort, temporal);
    return temporal;
  } catch (error: unknown) {
    temporal.kill();
    await temporal.exited;
    throw error;
  }
}
