import path from "node:path";
import { resolveDotnetExecutable, resolveMise } from "./mise.ts";
import { parseStoreIdentity, storeManifest } from "./store-identity.ts";
import { createPackageVerifier } from "./package-verification.ts";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { StandaloneScenario } from "./standalone-contract.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const solutionPath = path.join(packageRoot, "TaskNotes.Windows.slnx");
const appProject = path.join(
  packageRoot,
  "src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj",
);
const e2eProject = path.join(
  packageRoot,
  "tests/TaskNotes.Windows.E2E/TaskNotes.Windows.E2E.csproj",
);
const vswhere = path.join(
  Bun.env["ProgramFiles(x86)"] ?? String.raw`C:\Program Files (x86)`,
  "Microsoft Visual Studio",
  "Installer",
  "vswhere.exe",
);
const mise = await resolveMise();
const dotnet = await resolveDotnetExecutable(repositoryRoot);
const dotnetRoot = path.dirname(dotnet);
const vswhereExists = await Bun.file(vswhere).exists();
const commandPath = [
  dotnetRoot,
  path.dirname(process.execPath),
  path.dirname(mise),
  Bun.env["PATH"] ?? "",
].join(";");
let cachedDeveloperEnvironment: Record<string, string | undefined> | undefined;
type Command = [string, ...string[]];
const { verifyPackagedNative, verifyPackagedLicense } = createPackageVerifier(
  packageRoot,
  capture,
  captureDeveloper,
);

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
  nonInteractive = false,
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment ?? { ...Bun.env, PATH: commandPath },
    stdin: nonInteractive ? "ignore" : "inherit",
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
    ..."-latest -products * -requires Microsoft.VisualStudio.Workload.Universal -property installationPath".split(
      " ",
    ),
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
    if (separator > 0) {
      const name = line.slice(0, separator);
      environment[name.toUpperCase() === "PATH" ? "PATH" : name] = line.slice(
        separator + 1,
      );
    }
  }
  environment["PATH"] = [
    dotnetRoot,
    path.dirname(process.execPath),
    path.dirname(mise),
    environment["PATH"] ?? "",
  ].join(";");
  environment["DOTNET_ROOT"] = dotnetRoot;
  environment["DOTNET_MULTILEVEL_LOOKUP"] = "0";
  cachedDeveloperEnvironment = environment;
  return environment;
}

async function spawnDeveloper(
  command: Command,
  nonInteractive = false,
): Promise<void> {
  const executable: Command =
    command[0] === "dotnet" ? [dotnet, ...command.slice(1)] : command;
  const baseEnv = developerEnvironment();
  const env = nonInteractive
    ? {
        ...baseEnv,
        CI: "true",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_NOLOGO: "1",
      }
    : baseEnv;
  await spawn(executable, packageRoot, env, nonInteractive);
}

async function restore(nonInteractive = false): Promise<void> {
  await spawnDeveloper(
    ["dotnet", "restore", solutionPath, "--locked-mode"],
    nonInteractive,
  );
}

async function build(): Promise<void> {
  await restore();
  await spawnDeveloper([
    "dotnet",
    "build",
    solutionPath,
    "-c",
    "Release",
    "--no-restore",
  ]);
}

async function buildRemote(): Promise<void> {
  await restore(true);
  const noSign = "-p:AppxPackageSigningEnabled=false";
  await spawnDeveloper(
    [
      "dotnet",
      "build",
      solutionPath,
      "-c",
      "Release",
      "--no-restore",
      noSign,
      "-p:GenerateAppxPackageOnBuild=false",
    ],
    true,
  );
  const appxDir = `${path.join(packageRoot, "AppPackages/Remote")}${path.sep}`;
  await spawnDeveloper(
    [
      "dotnet",
      "build",
      appProject,
      "-c",
      "Release",
      "--no-restore",
      "-p:GenerateAppxPackageOnBuild=true",
      noSign,
      `-p:AppxPackageDir=${appxDir}`,
    ],
    true,
  );
}

async function test(): Promise<void> {
  await spawnDeveloper([
    "dotnet",
    "test",
    path.join(
      packageRoot,
      "tests/TaskNotes.Windows.Tests/TaskNotes.Windows.Tests.csproj",
    ),
    "-c",
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
    appProject,
    "--configuration",
    configuration,
    "--no-restore",
    "-p:GenerateAppxPackageOnBuild=true",
    `-p:AppxPackageDir=${appxDirectory}`,
  ]);
  await verifyPackagedNative(
    appxDirectory,
    configuration === "E2E" ? "red.sjer.TaskNotes.E2E" : "red.sjer.TaskNotes",
  );
}

async function packageStoreApp(
  identityPath: string | undefined,
): Promise<void> {
  if (identityPath === undefined) {
    throw new Error(
      "Microsoft Partner Center enrollment and a reserved Facet product are required. Pass a nonsecret identity JSON copied from that product; the development identity cannot be submitted.",
    );
  }
  const identity = parseStoreIdentity(await Bun.file(identityPath).json());
  if (process.platform !== "win32") {
    throw new Error(
      "Store packaging and Windows App Certification require Windows 11 x64.",
    );
  }
  const manifestPath = path.join(
    packageRoot,
    ".build/store/Package.appxmanifest",
  );
  const template = await Bun.file(
    path.join(packageRoot, "src/TaskNotes.Windows.App/Package.appxmanifest"),
  ).text();
  await Bun.write(manifestPath, storeManifest(template, identity));
  await restore();
  const directory = path.join(
    packageRoot,
    "AppPackages/Store",
    `${identity.version}-${crypto.randomUUID()}`,
  );
  await spawnDeveloper([
    "dotnet",
    "build",
    appProject,
    "--configuration",
    "Release",
    "--no-restore",
    "-p:GenerateAppxPackageOnBuild=true",
    "-p:AppxPackageSigningEnabled=false",
    `-p:FacetStoreManifest=${manifestPath}`,
    `-p:AppxPackageDir=${directory}${path.sep}`,
  ]);
  const artifacts = [
    ...new Bun.Glob("**/*.msix").scanSync({ cwd: directory, onlyFiles: true }),
  ];
  const [relative] = artifacts;
  if (relative === undefined || artifacts.length !== 1) {
    throw new Error("Expected one x64 Store package to verify.");
  }
  const artifact = path.join(directory, relative);
  const manifest = capture(["tar.exe", "-xOf", artifact, "AppxManifest.xml"]);
  const packaged = z
    .object({
      Package: z.object({
        Identity: z.object({
          "@_Name": z.string(),
          "@_Publisher": z.string(),
          "@_Version": z.string(),
        }),
      }),
    })
    .parse(new XMLParser({ ignoreAttributes: false }).parse(manifest))
    .Package.Identity;
  if (
    packaged["@_Name"] !== identity.name ||
    packaged["@_Publisher"] !== identity.publisher ||
    packaged["@_Version"] !== identity.version
  ) {
    throw new Error(
      "The produced package does not have the registered Store identity.",
    );
  }
  const files = capture(["tar.exe", "-tf", artifact])
    .split(/\r?\n/u)
    .map((entry) => entry.replaceAll("\\", "/"));
  if (
    !files.some((entry) => entry.endsWith("TaskNotes.Windows.App.exe")) ||
    files.includes("AppxSignature.p7x")
  ) {
    throw new Error(
      "The Store package must include the application executable and await Store signing.",
    );
  }
  await verifyPackagedLicense(artifact);
  await Bun.write(Bun.stdout, `${artifact}\n`);
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
    e2eProject,
    "--configuration",
    "Release",
    "--no-restore",
  ]);
}

async function runE2EScenario(): Promise<void> {
  const scenario = StandaloneScenario.parse(Bun.argv[3]);
  const artifactDirectory = Bun.env["TASKNOTES_E2E_ARTIFACTS"];
  if (artifactDirectory === undefined) {
    throw new Error("TASKNOTES_E2E_ARTIFACTS is required.");
  }
  const testConfiguration = path.join(artifactDirectory, "testconfig.json");
  await Bun.write(
    testConfiguration,
    `${JSON.stringify({
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
    })}\n`,
  );
  await spawnDeveloper([
    "dotnet",
    "test",
    e2eProject,
    ..."-c Release --no-build --no-restore --config-file".split(" "),
    testConfiguration,
    "--filter",
    `TestCategory=${scenario}`,
    ..."--report-junit --report-junit-filename junit.xml --report-trx --report-trx-filename e2e.trx --crashdump --hangdump".split(
      " ",
    ),
  ]);
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
  case "build-remote":
    await preflight();
    await buildRemote();
    break;
  case "test":
    await preflight();
    await test();
    break;
  case "package":
    await preflight();
    await packageApp();
    break;
  case "store-package":
    await packageStoreApp(Bun.argv[3]);
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
      appProject,
      "-c",
      "Debug",
    ]);
    break;
  case "verify":
    await preflight();
    await requireDevelopmentSigning(true);
    await restore();
    await spawn(["bun", "run", "lint"]);
    await spawnDeveloper([
      "dotnet",
      "build",
      solutionPath,
      "-c",
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
