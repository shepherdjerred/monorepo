import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  prepareStandaloneRun,
  standaloneRunOptions,
  validateStandaloneEvidence,
} from "./standalone-contract.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const scenario = standaloneRunOptions(Bun.argv.slice(2));
if (process.platform !== "win32")
  throw new Error(
    "Packaged UIA acceptance requires an unlocked interactive Windows session.",
  );

async function run(
  command: [string, ...string[]],
  environment?: Record<string, string | undefined>,
) {
  const child = Bun.spawn(command, {
    cwd: packageRoot,
    env: environment ?? { ...Bun.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await child.exited;
  if (result !== 0)
    throw new Error(`${command[0]} exited with status ${String(result)}.`);
}

function powershell(script: string, environment: Record<string, string> = {}) {
  const result = Bun.spawnSync(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      cwd: packageRoot,
      env: { ...Bun.env, ...environment },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  if (result.exitCode !== 0)
    throw new Error(
      `Package inspection exited with status ${String(result.exitCode)}.`,
    );
  return new TextDecoder().decode(result.stdout).trim();
}

// Build and install the existing isolated E2E package without resetting another profile,
// stopping an existing process, or enabling a production startup override.
await run(["bun", "scripts/windows.ts", "prepare-e2e"]);
const output = path.join(packageRoot, "AppPackages", "E2E");
const packages = [
  ...new Bun.Glob("**/TaskNotes.Windows.App_*.msix").scanSync({
    cwd: output,
    onlyFiles: true,
  }),
].filter((file) => !file.includes("Dependencies"));
const dependencies = [
  ...new Bun.Glob(
    "**/Dependencies/x64/Microsoft.WindowsAppRuntime.*.msix",
  ).scanSync({ cwd: output, onlyFiles: true }),
];
const [msix] = packages;
const [dependency] = dependencies;
if (
  msix === undefined ||
  dependency === undefined ||
  packages.length !== 1 ||
  dependencies.length !== 1
)
  throw new Error(
    "Exactly one E2E MSIX and x64 Windows App Runtime dependency are required.",
  );
const installed: unknown = JSON.parse(
  powershell(
    `
$ErrorActionPreference = 'Stop'
$existing = Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E'
if ($null -ne $existing) {
  $manifest = Get-AppxPackageManifest $existing
  $executable = [System.IO.Path]::GetFullPath((Join-Path $existing.InstallLocation $manifest.Package.Applications.Application.Executable))
  $running = @(Get-Process -Name 'TaskNotes.Windows.App' -ErrorAction SilentlyContinue | Where-Object { $null -ne $_.Path -and [System.IO.Path]::GetFullPath($_.Path) -eq $executable })
  if ($running.Count -ne 0) { throw 'The E2E package is already running; no process will be adopted or stopped.' }
}
Add-AppxPackage -Path $env:FACET_ACCEPTANCE_MSIX -DependencyPath $env:FACET_ACCEPTANCE_DEPENDENCY -ErrorAction Stop
$package = Get-AppxPackage -Name 'red.sjer.TaskNotes.E2E' -ErrorAction Stop
$manifest = Get-AppxPackageManifest $package
@{ family = $package.PackageFamilyName; executable = [System.IO.Path]::GetFullPath((Join-Path $package.InstallLocation $manifest.Package.Applications.Application.Executable)) } | ConvertTo-Json -Compress
`,
    {
      FACET_ACCEPTANCE_MSIX: path.join(output, msix),
      FACET_ACCEPTANCE_DEPENDENCY: path.join(output, dependency),
    },
  ),
);
const identity = z
  .object({
    family: z.string().regex(/^red\.sjer\.TaskNotes\.E2E_[a-z0-9]{13}$/u),
    executable: z.string().min(1),
  })
  .strict()
  .parse(installed);
const localAppData = Bun.env["LOCALAPPDATA"];
if (localAppData === undefined) throw new Error("LOCALAPPDATA is required.");
const localState = path.join(
  localAppData,
  "Packages",
  identity.family,
  "LocalState",
);
await mkdir(localState, { recursive: true });
const staged = await prepareStandaloneRun(
  localState,
  identity.family,
  path.join(packageRoot, "..", "tasknotes-fixtures", "e2e", "local-vault"),
  { additionalFixture: path.join(packageRoot, "e2e", "standalone", "seed") },
);
const results = path.join(staged.descriptor.stateDirectory, "results");
await mkdir(results);
await run(["bun", "scripts/windows.ts", "e2e-scenario", scenario], {
  ...Bun.env,
  FACET_ACCEPTANCE_PACKAGE_FAMILY: identity.family,
  FACET_ACCEPTANCE_EXECUTABLE: identity.executable,
  FACET_ACCEPTANCE_DESCRIPTOR: staged.descriptorPath,
  FACET_ACCEPTANCE_LOCAL_STATE: localState,
  TASKNOTES_E2E_ARTIFACTS: results,
});
await validateStandaloneEvidence(
  await Bun.file(path.join(results, "evidence.json")).json(),
  staged.descriptor.runId,
  scenario,
);
await Bun.write(
  Bun.stdout,
  `Standalone local Windows journey passed. Private app-only evidence: ${results}\nFull assertion porting and live Sync acceptance remain separate gates.\n`,
);
