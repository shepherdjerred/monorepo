import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const suite = Bun.argv[2] ?? "unit";
const seedRaw = Bun.env["TASKNOTES_TEST_SEED"];
const seed =
  seedRaw === undefined
    ? crypto.getRandomValues(new Uint32Array(1))[0]
    : Number(seedRaw);
if (seed === undefined || !Number.isSafeInteger(seed) || seed < 0) {
  throw new Error(
    `TASKNOTES_TEST_SEED must be a non-negative integer; received '${seedRaw ?? "undefined"}'.`,
  );
}

const suites = new Map([
  [
    "unit",
    {
      project: path.join(
        packageRoot,
        "tests",
        "TaskNotes.Windows.Tests",
        "TaskNotes.Windows.Tests.csproj",
      ),
      timeout: 30_000,
      parallel: true,
    },
  ],
  [
    "integration",
    {
      project: path.join(
        packageRoot,
        "tests",
        "TaskNotes.Windows.IntegrationTests",
        "TaskNotes.Windows.IntegrationTests.csproj",
      ),
      timeout: 120_000,
      parallel: true,
    },
  ],
  [
    "winui",
    {
      project: path.join(
        packageRoot,
        "tests",
        "TaskNotes.Windows.App.Tests",
        "TaskNotes.Windows.App.Tests.csproj",
      ),
      timeout: 120_000,
      parallel: false,
    },
  ],
]);
const selected = suites.get(suite);
if (selected === undefined) {
  throw new Error(`Unknown test suite '${suite}'.`);
}

const artifacts = path.join(packageRoot, "artifacts", "test-results", suite);
const testConfiguration = path.join(artifacts, "testconfig.json");
await Bun.write(
  testConfiguration,
  `${JSON.stringify(
    {
      platformOptions: {
        exitProcessOnUnhandledException: true,
        resultDirectory: artifacts,
      },
      mstest: {
        parallelism: {
          enabled: selected.parallel,
          workers: 0,
          scope: "method",
        },
        timeout: {
          test: selected.timeout,
          testInitialize: selected.timeout,
          testCleanup: selected.timeout,
          useCooperativeCancellation: true,
        },
        execution: {
          mapInconclusiveToFailed: true,
          mapNotRunnableToFailed: true,
          randomizeTestOrder: true,
          randomTestOrderSeed: seed,
          treatClassAndAssemblyCleanupWarningsAsErrors: true,
          treatDiscoveryWarningsAsErrors: true,
        },
      },
    },
    null,
    2,
  )}\n`,
);

await Bun.write(
  Bun.stdout,
  `TaskNotes Windows ${suite} test seed: ${String(seed)}\n`,
);
const argumentsList = [
  "scripts/dotnet.ts",
  "test",
  selected.project,
  "--configuration",
  "Release",
  "--property:RestoreLockedMode=true",
  "--config-file",
  testConfiguration,
  "--report-trx",
  "--report-trx-filename",
  `${suite}.trx`,
  "--report-junit",
  "--report-junit-filename",
  `${suite}.junit.xml`,
  "--crashdump",
  "--hangdump",
];
if (Bun.argv.includes("--coverage")) {
  argumentsList.push(
    "--coverage",
    "--coverage-output",
    path.join(artifacts, "coverage.cobertura.xml"),
    "--coverage-output-format",
    "cobertura",
    "--coverage-settings",
    path.join(packageRoot, "coverage.settings.xml"),
  );
}

const child = Bun.spawn([process.execPath, ...argumentsList], {
  cwd: packageRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
