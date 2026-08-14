import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ScenarioEnvironment, pollUntil } from "@tasknotes/e2e";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const artifactRoot = path.join(packageRoot, "artifacts", "e2e");
const resultsRoot = path.join(artifactRoot, "results");
const scenarioRoot = path.join(artifactRoot, "scenarios");
const packageOutput = path.join(packageRoot, "AppPackages", "E2E");

const ScenarioManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarios: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
          test: z.string().min(1),
          assertions: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

const RuntimeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenario: z.string().min(1),
    expectedAssertions: z.array(z.string().min(1)),
    passedAssertions: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.enum([
            "uia",
            "server",
            "persistence",
            "markdown",
            "screenshot",
            "system",
          ]),
          observation: z.string().min(10),
          recordedAtUtc: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
    completed: z.literal(true),
    recordedAtUtc: z.iso.datetime({ offset: true }),
  })
  .strict();

type CliOptions = {
  readonly scenario: string | undefined;
  readonly keepArtifacts: boolean;
};

type AppPackage = {
  readonly msixPath: string;
  readonly dependencyPath: string;
};

function parseOptions(argumentsList: readonly string[]): CliOptions {
  let scenario: string | undefined;
  let keepArtifacts = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--keep-artifacts") {
      keepArtifacts = true;
      continue;
    }
    if (argument === "--scenario") {
      const value = argumentsList[index + 1];
      if (value === undefined || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
        throw new Error("--scenario requires a kebab-case scenario ID");
      }
      scenario = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown Windows E2E option '${argument ?? ""}'.`);
  }
  return { scenario, keepArtifacts };
}

async function run(
  command: [string, ...string[]],
  environment?: Record<string, string | undefined>,
): Promise<number> {
  const child = Bun.spawn(command, {
    cwd: packageRoot,
    env: environment ?? { ...Bun.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function requireSuccess(
  command: [string, ...string[]],
  description: string,
): Promise<void> {
  const exitCode = await run(command);
  if (exitCode !== 0) {
    throw new Error(`${description} exited with status ${String(exitCode)}`);
  }
}

function powershell(
  script: string,
  environment?: Record<string, string>,
): string {
  const result = Bun.spawnSync(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      cwd: packageRoot,
      env: { ...Bun.env, ...environment },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`PowerShell exited with status ${String(result.exitCode)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function findPackage(): AppPackage {
  const packagePaths = [
    ...new Bun.Glob("**/TaskNotes.Windows.App_*.msix").scanSync({
      cwd: packageOutput,
      onlyFiles: true,
    }),
  ]
    .filter((relativePath) => !relativePath.includes("Dependencies"))
    .map((relativePath) => path.join(packageOutput, relativePath));
  if (packagePaths.length !== 1) {
    throw new Error(
      `Expected one E2E MSIX under ${packageOutput}; found ${String(packagePaths.length)}.`,
    );
  }
  const dependencyPaths = [
    ...new Bun.Glob(
      "**/Dependencies/x64/Microsoft.WindowsAppRuntime.*.msix",
    ).scanSync({ cwd: packageOutput, onlyFiles: true }),
  ].map((relativePath) => path.join(packageOutput, relativePath));
  if (dependencyPaths.length !== 1) {
    throw new Error(
      `Expected one x64 Windows App Runtime dependency; found ${String(dependencyPaths.length)}.`,
    );
  }
  const msixPath = packagePaths[0];
  const dependencyPath = dependencyPaths[0];
  if (msixPath === undefined || dependencyPath === undefined) {
    throw new Error(
      "The E2E package output changed while it was being inspected.",
    );
  }
  return { msixPath, dependencyPath };
}

function installPackage(appPackage: AppPackage): string {
  const packageFamilyName = powershell(
    `
$existing = Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E'
if ($null -ne $existing) {
  $existing | Remove-AppxPackage -ErrorAction Stop
}
Add-AppxPackage -Path $env:TASKNOTES_E2E_MSIX -DependencyPath $env:TASKNOTES_E2E_DEPENDENCY -ForceApplicationShutdown -ErrorAction Stop
$installed = Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E' -ErrorAction Stop
$installed.PackageFamilyName
`,
    {
      TASKNOTES_E2E_MSIX: appPackage.msixPath,
      TASKNOTES_E2E_DEPENDENCY: appPackage.dependencyPath,
    },
  );
  const familySeparator = packageFamilyName.lastIndexOf("_");
  const packageName = packageFamilyName.slice(0, familySeparator);
  const publisherId = packageFamilyName.slice(familySeparator + 1);
  if (
    familySeparator <= 0 ||
    !/^[\w.-]+$/u.test(packageName) ||
    !/^\w+$/u.test(publisherId)
  ) {
    throw new Error(
      `Unexpected E2E package family name '${packageFamilyName}'.`,
    );
  }
  return packageFamilyName;
}

function removePackage(): void {
  powershell(`
$package = Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E'
if ($null -ne $package) {
  $package | Remove-AppxPackage -ErrorAction Stop
}
`);
}

function resetPackageData(): void {
  powershell(`
$package = Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E' -ErrorAction Stop
$package | Reset-AppxPackage -ErrorAction Stop
`);
}

function stopPackageProcess(): void {
  powershell(`
$package = Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E' -ErrorAction Stop
$installRoot = [System.IO.Path]::GetFullPath($package.InstallLocation)
$processes = @(Get-Process -Name 'TaskNotes.Windows.App' -ErrorAction SilentlyContinue | Where-Object {
  $null -ne $_.Path -and [System.IO.Path]::GetFullPath($_.Path).StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)
})
foreach ($process in $processes) {
  Stop-Process -Id $process.Id -Force -ErrorAction Stop
  Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
}
`);
}

async function prepareFreshAppState(
  packageFamilyName: string,
  localStateDirectory: string,
): Promise<void> {
  stopPackageProcess();
  resetPackageData();
  const acknowledgmentPath = path.join(localStateDirectory, "e2e-reset.txt");
  await rm(acknowledgmentPath, { force: true });
  const nonce = crypto.randomUUID();
  const activation = Bun.spawn(
    [
      "explorer.exe",
      `tasknotes-e2e://diagnostics/reset?nonce=${encodeURIComponent(nonce)}`,
    ],
    { cwd: packageRoot, stdout: "ignore", stderr: "inherit" },
  );
  const activationExit = await activation.exited;
  if (activationExit !== 0) {
    throw new Error(
      `E2E reset activation exited with status ${String(activationExit)}`,
    );
  }
  await pollUntil("TaskNotes E2E reset acknowledgement", 30_000, async () => {
    try {
      return (await readFile(acknowledgmentPath, "utf8")) === nonce;
    } catch {
      return false;
    }
  });
  stopPackageProcess();
  resetPackageData();
  const registeredFamily = powershell(
    "(Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E' -ErrorAction Stop).PackageFamilyName",
  );
  if (registeredFamily !== packageFamilyName) {
    throw new Error("The E2E package identity changed during state reset.");
  }
}

async function copyResultArtifacts(
  scenarioId: string,
  sourceDirectory: string,
): Promise<void> {
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name.endsWith(".xml") || entry.name.endsWith(".png"))
    ) {
      await cp(
        path.join(sourceDirectory, entry.name),
        path.join(resultsRoot, `${scenarioId}-${entry.name}`),
      );
    }
  }
}

async function validateRuntimeEvidence(
  scenario: z.infer<typeof ScenarioManifestSchema>["scenarios"][number],
  artifactDirectory: string,
): Promise<void> {
  const evidencePath = path.join(artifactDirectory, "evidence.json");
  const evidence = RuntimeEvidenceSchema.parse(
    await Bun.file(evidencePath).json(),
  );
  if (evidence.scenario !== scenario.id) {
    throw new Error(
      `Runtime evidence declares '${evidence.scenario}', expected '${scenario.id}'.`,
    );
  }
  const expected = [...scenario.assertions].sort();
  const passed = evidence.passedAssertions.map((item) => item.id).sort();
  if (new Set(passed).size !== passed.length) {
    throw new Error(
      `Scenario '${scenario.id}' emitted duplicate runtime evidence.`,
    );
  }
  if (JSON.stringify(passed) !== JSON.stringify(expected)) {
    throw new Error(
      `Scenario '${scenario.id}' runtime evidence did not exactly match its assertion contract.`,
    );
  }
}

const options = parseOptions(Bun.argv.slice(2));
const manifest = ScenarioManifestSchema.parse(
  await Bun.file(path.join(packageRoot, "e2e", "scenarios.json")).json(),
);
const scenarios =
  options.scenario === undefined
    ? manifest.scenarios.filter((scenario) => scenario.id !== "visual-modes")
    : manifest.scenarios.filter((scenario) => scenario.id === options.scenario);
if (scenarios.length === 0) {
  throw new Error(`Unknown Windows E2E scenario '${options.scenario ?? ""}'.`);
}

await rm(resultsRoot, { force: true, recursive: true });
await mkdir(resultsRoot, { recursive: true });
await mkdir(scenarioRoot, { recursive: true });
await requireSuccess(
  ["bun", "scripts/windows.ts", "prepare-e2e"],
  "Windows E2E package preparation",
);
const packageFamilyName = installPackage(findPackage());
const localAppData = Bun.env["LOCALAPPDATA"];
if (localAppData === undefined) {
  throw new Error("LOCALAPPDATA is required by the Windows E2E runner.");
}
const localStateDirectory = path.join(
  localAppData,
  "Packages",
  packageFamilyName,
  "LocalState",
);
const failures: string[] = [];

for (const scenario of scenarios) {
  const environment = await ScenarioEnvironment.start({
    scenarioId: scenario.id,
    seedVault: path.join(
      repositoryRoot,
      "packages",
      "tasks-for-obsidian",
      "e2e",
      "fixtures",
      "seed-vault",
    ),
    tasknotesServerDirectory: path.join(
      repositoryRoot,
      "packages",
      "tasknotes-server",
    ),
    artifactRoot: scenarioRoot,
  });
  let success = false;
  try {
    await prepareFreshAppState(packageFamilyName, localStateDirectory);
    const exitCode = await run(
      ["bun", "scripts/windows.ts", "e2e-scenario", scenario.id],
      {
        ...Bun.env,
        TASKNOTES_E2E_SCENARIO: scenario.id,
        TASKNOTES_E2E_PACKAGE_FAMILY: packageFamilyName,
        TASKNOTES_E2E_PROXY_URL: environment.proxyUrl,
        TASKNOTES_E2E_AUTH_TOKEN: environment.authToken,
        TASKNOTES_E2E_VAULT: environment.vaultDirectory,
        TASKNOTES_E2E_ARTIFACTS: environment.artifactDirectory,
        TASKNOTES_E2E_APP_LOCAL_STATE: localStateDirectory,
        TASKNOTES_E2E_VISUAL_VARIANT:
          Bun.env["TASKNOTES_E2E_VISUAL_VARIANT"] ?? "system",
        TASKNOTES_E2E_VISUAL_ACTUAL:
          Bun.env["TASKNOTES_E2E_VISUAL_ACTUAL"] ?? "system",
        TASKNOTES_E2E_ASSERTIONS: JSON.stringify(scenario.assertions),
      },
    );
    if (exitCode === 0) {
      await validateRuntimeEvidence(scenario, environment.artifactDirectory);
      success = true;
    }
    await copyResultArtifacts(scenario.id, environment.artifactDirectory);
    if (!success) {
      failures.push(scenario.id);
      environment.retain();
    }
  } catch (error) {
    failures.push(scenario.id);
    environment.retain();
    await environment.writeDiagnostic(
      "runner-error.txt",
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
  } finally {
    if (options.keepArtifacts) {
      environment.retain();
    }
    await environment.dispose(success);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Windows E2E failed: ${failures.join(", ")}. Retained scenario artifacts under ${scenarioRoot}.`,
  );
}

removePackage();
await Bun.write(
  Bun.stdout,
  `TaskNotes Windows E2E passed (${String(scenarios.length)} scenarios). JUnit results: ${resultsRoot}\n`,
);
