import path from "node:path";
import { resolveMise } from "./mise.ts";

const failures: string[] = [];
const decoder = new TextDecoder();
const mise = await resolveMise();

function run(command: string[], cwd = process.cwd()): string {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    failures.push(
      `Could not start '${command[0] ?? "unknown command"}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return "";
  }
  if (result.exitCode !== 0) return "";
  return decoder.decode(result.stdout).trim();
}

function requireValue(value: string, message: string): void {
  if (value.length === 0) {
    failures.push(message);
  }
}

if (process.platform !== "win32") {
  throw new Error("windows:preflight must run on Windows 11 x64.");
}
if (process.arch !== "x64") {
  failures.push("Use an x64 terminal; Windows ARM64 support is deferred.");
}

const currentVersionRegistryPath = [
  "HKLM",
  "SOFTWARE",
  "Microsoft",
  "Windows NT",
  "CurrentVersion",
].join(String.fromCodePoint(92));
const currentBuildOutput = run([
  "reg.exe",
  "query",
  currentVersionRegistryPath,
  "/v",
  "CurrentBuildNumber",
]);
const currentBuildMatch = /CurrentBuildNumber\s+REG_SZ\s+(\d+)/u.exec(
  currentBuildOutput,
);
const currentBuild = Number(currentBuildMatch?.[1] ?? "0");
if (!Number.isSafeInteger(currentBuild) || currentBuild < 22_000) {
  failures.push(
    `Windows 11 build 22000 or newer is required; found '${currentBuildOutput || "nothing"}'.`,
  );
}

const vswhere = path.join(
  Bun.env["ProgramFiles(x86)"] ?? String.raw`C:\Program Files (x86)`,
  "Microsoft Visual Studio",
  "Installer",
  "vswhere.exe",
);
if (await Bun.file(vswhere).exists()) {
  const installation = run([
    vswhere,
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Workload.ManagedDesktop",
    "Microsoft.VisualStudio.Workload.Universal",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "Microsoft.VisualStudio.Component.Windows11SDK.26100",
    "-property",
    "installationPath",
  ]);
  requireValue(
    installation,
    "Visual Studio is missing the .NET desktop, Universal Windows, Windows 11 SDK 26100, or x64 MSVC components. Reapply dev/winui-configuration.winget as administrator.",
  );
  if (installation.length > 0) {
    const toolQueries = [
      [String.raw`MSBuild\**\Bin\MSBuild.exe`, "MSBuild"],
      [
        String.raw`VC\Tools\MSVC\**\bin\Hostx64\x64\cl.exe`,
        "the x64 MSVC compiler",
      ],
      [
        String.raw`VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe`,
        "the x64 MSVC linker",
      ],
    ];
    for (const [pattern, label] of toolQueries) {
      requireValue(
        run([vswhere, "-latest", "-products", "*", "-find", pattern ?? ""]),
        `${label ?? "A required Visual Studio tool"} is missing. Reapply dev/winui-configuration.winget as administrator.`,
      );
    }
  }
} else {
  failures.push(
    "Visual Studio Installer is missing. Apply dev/winui-configuration.winget from an elevated terminal.",
  );
}

const developerModeRegistryPath = [
  "HKLM",
  "SOFTWARE",
  "Microsoft",
  "Windows",
  "CurrentVersion",
  "AppModelUnlock",
].join(String.fromCodePoint(92));
const developerMode = run([
  "reg.exe",
  "query",
  developerModeRegistryPath,
  "/v",
  "AllowDevelopmentWithoutDevLicense",
]);
if (!developerMode.includes("0x1")) {
  failures.push(
    "Enable Windows Developer Mode in Settings > System > Advanced > For developers.",
  );
}

requireValue(
  run([mise, "--version"]),
  "mise is missing. Install it with: winget install jdx.mise",
);
const dotnetVersion = run([mise, "exec", "--", "dotnet", "--version"]);
if (dotnetVersion !== "10.0.302") {
  failures.push(
    `Expected .NET SDK 10.0.302 through mise; found '${dotnetVersion || "nothing"}'. Run mise install.`,
  );
}
const winuiTemplates = run([
  mise,
  "exec",
  "--",
  "dotnet",
  "new",
  "list",
  "winui",
]);
if (!winuiTemplates.includes("winui")) {
  failures.push(
    "The WinUI C# templates are missing. Run: dotnet new install Microsoft.WindowsAppSDK.WinUI.CSharp.Templates",
  );
}
const rustVersion = run([mise, "exec", "--", "rustc", "--version"]);
if (!rustVersion.startsWith("rustc 1.97.1 ")) {
  failures.push(
    `Expected Rust 1.97.1 through mise; found '${rustVersion || "nothing"}'. Run mise install.`,
  );
}
requireValue(
  run([mise, "exec", "--", "uniffi-bindgen-cs", "--version"]),
  "The pinned uniffi-bindgen-cs tool is missing. Run mise install at the repository root.",
);
requireValue(
  run([mise, "exec", "--", "cargo", "llvm-cov", "--version"]),
  "The pinned cargo-llvm-cov tool is missing. Run mise install at the repository root.",
);
requireValue(
  run([mise, "exec", "--", "cargo", "mutants", "--version"]),
  "The pinned cargo-mutants tool is missing. Run mise install at the repository root.",
);

if (failures.length > 0) {
  console.error(
    "TaskNotes Windows preflight failed:\n\n%s",
    failures.map((failure) => `- ${failure}`).join("\n"),
  );
  process.exit(1);
}

await Bun.write(
  Bun.stdout,
  "TaskNotes Windows preflight passed: Windows 11 x64, Developer Mode, WinUI/MSBuild/MSVC, .NET, Rust, and UniFFI C# tooling are ready.\n",
);
