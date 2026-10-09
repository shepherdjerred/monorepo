import path from "node:path";

export function mstestConfiguration(options: {
  artifacts: string;
  parallel: boolean;
  timeoutMs: number;
  seed: number;
}) {
  return {
    platformOptions: {
      exitProcessOnUnhandledException: true,
      resultDirectory: options.artifacts,
    },
    mstest: {
      parallelism: { enabled: options.parallel, workers: 0, scope: "method" },
      timeout: {
        test: options.timeoutMs,
        testInitialize: options.timeoutMs,
        testCleanup: options.timeoutMs,
        // Tests that ignore CancellationToken still need to fail at the limit.
        useCooperativeCancellation: false,
      },
      execution: {
        mapInconclusiveToFailed: true,
        mapNotRunnableToFailed: true,
        randomizeTestOrder: true,
        randomTestOrderSeed: options.seed,
        treatClassAndAssemblyCleanupWarningsAsErrors: true,
        treatDiscoveryWarningsAsErrors: true,
      },
    },
  };
}

export async function prepareMstestConfiguration(options: {
  artifacts: string;
  parallel: boolean;
  timeoutMs: number;
  seedRaw: string | undefined;
}): Promise<string> {
  const seed =
    options.seedRaw === undefined
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Number(options.seedRaw);
  if (seed === undefined || !Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("TASKNOTES_TEST_SEED must be a non-negative integer.");
  }
  const configPath = path.join(options.artifacts, "testconfig.json");
  await Bun.write(
    configPath,
    `${JSON.stringify(mstestConfiguration({ ...options, seed }), null, 2)}\n`,
  );
  console.log(`MSTest seed: ${String(seed)}`);
  return configPath;
}
