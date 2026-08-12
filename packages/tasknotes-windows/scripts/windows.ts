import path from "node:path";
import { resolveMise } from "./mise.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const vswhere = path.join(
  Bun.env["ProgramFiles(x86)"] ?? String.raw`C:\Program Files (x86)`,
  "Microsoft Visual Studio",
  "Installer",
  "vswhere.exe",
);
const mise = await resolveMise();
const vswhereExists = await Bun.file(vswhere).exists();
const commandPath = `${path.dirname(mise)};${Bun.env["PATH"] ?? ""}`;
let cachedDeveloperEnvironment: Record<string, string | undefined> | undefined;
type Command = [string, ...string[]];

function capture(command: Command): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command[0]} exited with status ${String(result.exitCode)}`,
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function captureDeveloper(command: Command): string {
  const result = Bun.spawnSync(command, {
    env: developerEnvironment(),
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command[0]} exited with status ${String(result.exitCode)}`,
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
}

async function spawn(
  command: Command,
  cwd = packageRoot,
  environment?: Record<string, string | undefined>,
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment ?? { ...Bun.env, PATH: commandPath },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function preflight(): Promise<void> {
  await spawn(["bun", "scripts/preflight.ts"]);
}

function developerEnvironment(): Record<string, string | undefined> {
  if (cachedDeveloperEnvironment !== undefined) {
    return cachedDeveloperEnvironment;
  }
  if (!vswhereExists) {
    throw new Error(
      "Visual Studio Installer is missing; run windows:preflight for setup instructions.",
    );
  }
  const installation = capture([
    vswhere,
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Workload.Universal",
    "-property",
    "installationPath",
  ]);
  const devTools = path.join(installation, "Common7", "Tools");
  const result = Bun.spawnSync(
    [
      "cmd.exe",
      "/d",
      "/s",
      "/c",
      "call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set",
    ],
    { cwd: devTools, stdout: "pipe", stderr: "inherit" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `VsDevCmd.bat exited with status ${String(result.exitCode)}`,
    );
  }

  const environment: Record<string, string | undefined> = { ...Bun.env };
  const output = new TextDecoder().decode(result.stdout);
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    environment[name.toUpperCase() === "PATH" ? "PATH" : name] = value;
  }
  environment["PATH"] = `${path.dirname(mise)};${environment["PATH"] ?? ""}`;
  cachedDeveloperEnvironment = environment;
  return environment;
}

async function spawnDeveloper(command: Command): Promise<void> {
  await spawn(
    [mise, "exec", "-C", packageRoot, "--", ...command],
    packageRoot,
    developerEnvironment(),
  );
}

async function restore(): Promise<void> {
  await spawnDeveloper([
    "dotnet",
    "restore",
    path.join(packageRoot, "TaskNotes.Windows.slnx"),
    "--locked-mode",
  ]);
}

async function build(): Promise<void> {
  await restore();
  await spawnDeveloper([
    "dotnet",
    "build",
    path.join(packageRoot, "TaskNotes.Windows.slnx"),
    "--configuration",
    "Release",
    "--no-restore",
  ]);
}

async function test(): Promise<void> {
  await spawnDeveloper([
    "dotnet",
    "test",
    path.join(
      packageRoot,
      "tests",
      "TaskNotes.Windows.Tests",
      "TaskNotes.Windows.Tests.csproj",
    ),
    "--configuration",
    "Release",
    "--property:RestoreLockedMode=true",
  ]);
}

async function packageApp(
  configuration = "Release",
  outputDirectory = "AppPackages",
  requireInstallationTrust = false,
): Promise<void> {
  await requireDevelopmentSigning(requireInstallationTrust);
  await restore();
  const appxDirectory = `${path.join(packageRoot, outputDirectory)}${path.sep}`;
  await spawnDeveloper([
    "dotnet",
    "build",
    path.join(
      packageRoot,
      "src",
      "TaskNotes.Windows.App",
      "TaskNotes.Windows.App.csproj",
    ),
    "--configuration",
    configuration,
    "--no-restore",
    "-p:GenerateAppxPackageOnBuild=true",
    `-p:AppxPackageDir=${appxDirectory}`,
  ]);
  verifyPackagedNative(
    appxDirectory,
    configuration === "E2E" ? "red.sjer.TaskNotes.E2E" : "red.sjer.TaskNotes",
  );
}

async function requireDevelopmentSigning(
  requireInstallationTrust: boolean,
): Promise<void> {
  const signingProps = path.join(packageRoot, "Directory.Build.local.props");
  if (!(await Bun.file(signingProps).exists())) {
    throw new Error(
      "Development signing is not provisioned. Run scripts/provision-signing.ps1 once, then retry.",
    );
  }
  if (requireInstallationTrust) {
    const signingDocument = await Bun.file(signingProps).text();
    const thumbprint =
      /<PackageCertificateThumbprint>([A-F\d]{40})<\/PackageCertificateThumbprint>/u.exec(
        signingDocument,
      )?.[1];
    if (thumbprint === undefined) {
      throw new Error(
        "Directory.Build.local.props does not contain a valid development signing thumbprint.",
      );
    }
    const trusted = Bun.spawnSync(
      ["certutil.exe", "-store", "TrustedPeople", thumbprint],
      { stdout: "ignore", stderr: "ignore" },
    );
    if (trusted.exitCode !== 0) {
      throw new Error(
        String.raw`The TaskNotes development certificate is not trusted by the machine AppX service. Run scripts/provision-signing.ps1 in an elevated PowerShell terminal; it installs only the public certificate in LocalMachine\TrustedPeople.`,
      );
    }
  }
}

async function prepareE2E(): Promise<void> {
  await packageApp("E2E", path.join("AppPackages", "E2E"), true);
  await spawnDeveloper([
    "dotnet",
    "build",
    path.join(
      packageRoot,
      "tests",
      "TaskNotes.Windows.E2E",
      "TaskNotes.Windows.E2E.csproj",
    ),
    "--configuration",
    "Release",
    "--no-restore",
  ]);
}

async function runE2EScenario(): Promise<void> {
  const scenario = Bun.argv[3];
  if (scenario === undefined || !/^[a-z0-9][a-z0-9-]*$/u.test(scenario)) {
    throw new Error("A valid E2E scenario ID is required.");
  }
  const artifactDirectory = Bun.env["TASKNOTES_E2E_ARTIFACTS"];
  if (artifactDirectory === undefined) {
    throw new Error("TASKNOTES_E2E_ARTIFACTS is required.");
  }
  const testConfiguration = path.join(artifactDirectory, "testconfig.json");
  await Bun.write(
    testConfiguration,
    `${JSON.stringify(
      {
        platformOptions: {
          exitProcessOnUnhandledException: true,
          resultDirectory: artifactDirectory,
        },
        mstest: {
          parallelism: { enabled: false, scope: "method" },
          timeout: {
            test: 300_000,
            testInitialize: 120_000,
            testCleanup: 120_000,
            useCooperativeCancellation: true,
          },
          execution: {
            mapInconclusiveToFailed: true,
            mapNotRunnableToFailed: true,
            randomizeTestOrder: true,
            randomTestOrderSeed: 20_260_811,
            treatClassAndAssemblyCleanupWarningsAsErrors: true,
            treatDiscoveryWarningsAsErrors: true,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await spawnDeveloper([
    "dotnet",
    "test",
    path.join(
      packageRoot,
      "tests",
      "TaskNotes.Windows.E2E",
      "TaskNotes.Windows.E2E.csproj",
    ),
    "--configuration",
    "Release",
    "--no-build",
    "--no-restore",
    "--config-file",
    testConfiguration,
    "--filter",
    `TestCategory=${scenario}`,
    "--report-junit",
    "--report-junit-filename",
    "junit.xml",
    "--report-trx",
    "--report-trx-filename",
    "e2e.trx",
    "--crashdump",
    "--hangdump",
  ]);
}

function verifyPackagedNative(
  appxDirectory: string,
  expectedIdentity: string,
): void {
  const packages = [
    ...new Bun.Glob("**/*.msix").scanSync({
      cwd: appxDirectory,
      onlyFiles: true,
    }),
  ];
  if (packages.length === 0) {
    throw new Error(`No MSIX was produced under ${appxDirectory}`);
  }

  const newest = packages
    .map((relativePath) => ({
      relativePath,
      lastModified: Bun.file(path.join(appxDirectory, relativePath))
        .lastModified,
    }))
    .sort((left, right) => right.lastModified - left.lastModified)[0];
  if (newest === undefined) {
    throw new Error(`No MSIX was produced under ${appxDirectory}`);
  }

  const archivePath = path.join(appxDirectory, newest.relativePath);
  captureDeveloper(["signtool.exe", "verify", "/pa", "/all", archivePath]);
  const entries = capture(["tar.exe", "-tf", archivePath])
    .split(/\r?\n/u)
    .map((entry) => entry.replaceAll("\\", "/"));
  if (
    !entries.some(
      (entry) =>
        entry.endsWith("/tasknotes_core_ffi.dll") ||
        entry === "tasknotes_core_ffi.dll",
    )
  ) {
    throw new Error(
      `Packaged application is missing tasknotes_core_ffi.dll: ${archivePath}`,
    );
  }

  const manifest = capture([
    "tar.exe",
    "-xOf",
    archivePath,
    "AppxManifest.xml",
  ]);
  const escapedIdentity = expectedIdentity.replaceAll(".", String.raw`\.`);
  if (
    !new RegExp(String.raw`\bName=["']${escapedIdentity}["']`, "u").test(
      manifest,
    )
  ) {
    throw new Error(
      `Packaged application identity is not '${expectedIdentity}': ${archivePath}`,
    );
  }
  if (!entries.includes("AppxSignature.p7x")) {
    throw new Error(`Packaged application has no signature: ${archivePath}`);
  }
}

const action = Bun.argv[2];
switch (action) {
  case undefined:
    throw new Error("A Windows action is required.");
  case "preflight":
    await preflight();
    break;
  case "build":
    await preflight();
    await build();
    break;
  case "test":
    await preflight();
    await test();
    break;
  case "package":
    await preflight();
    await packageApp();
    break;
  case "prepare-e2e":
    await preflight();
    await prepareE2E();
    break;
  case "e2e-scenario":
    await runE2EScenario();
    break;
  case "run":
    await preflight();
    await spawnDeveloper([
      "dotnet",
      "run",
      "--project",
      path.join(
        packageRoot,
        "src",
        "TaskNotes.Windows.App",
        "TaskNotes.Windows.App.csproj",
      ),
      "--configuration",
      "Debug",
    ]);
    break;
  case "verify":
    await preflight();
    await requireDevelopmentSigning(true);
    await spawnDeveloper([
      "cargo",
      "run",
      "--manifest-path",
      path.join(packageRoot, "..", "tasknotes-core", "xtask", "Cargo.toml"),
      "--",
      "check-bindings",
    ]);
    await restore();
    await spawn(["bun", "run", "lint"]);
    await spawnDeveloper([
      "dotnet",
      "build",
      path.join(packageRoot, "TaskNotes.Windows.slnx"),
      "--configuration",
      "Release",
      "--no-restore",
    ]);
    await spawn(["bun", "run", "coverage"]);
    await spawn(["bun", "scripts/parity-check.ts"]);
    await spawn(["bun", "scripts/e2e.ts"]);
    await spawn(["bun", "scripts/visual-matrix.ts"]);
    await packageApp();
    break;
  default:
    throw new Error(`Unknown Windows action '${action}'.`);
}
