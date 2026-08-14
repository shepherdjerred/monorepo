import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dir, "..");
const profiles = [
  "100-light",
  "200-light",
  "100-dark",
  "200-dark",
  "100-high-contrast",
  "200-high-contrast",
] as const;
const ProfileSchema = z.enum(profiles);
const SystemProfileSchema = z
  .object({
    scale: z.union([z.literal(100), z.literal(200)]),
    theme: z.enum(["light", "dark", "high-contrast"]),
  })
  .strict();

const requested = ProfileSchema.parse(Bun.env["TASKNOTES_VISUAL_PROFILE"]);
const profileScript = String.raw`
Add-Type -AssemblyName PresentationFramework
$desktop = Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -ErrorAction Stop
$dpi = if ($null -eq $desktop.LogPixels) { 96 } else { [int]$desktop.LogPixels }
$personalize = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction Stop
$theme = if ([System.Windows.SystemParameters]::HighContrast) {
  'high-contrast'
} elseif ([int]$personalize.AppsUseLightTheme -eq 1) {
  'light'
} else {
  'dark'
}
@{ scale = [int][Math]::Round(($dpi / 96) * 100); theme = $theme } | ConvertTo-Json -Compress
`;
const profileProcess = Bun.spawnSync(
  [
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    profileScript,
  ],
  { cwd: packageRoot, stdout: "pipe", stderr: "inherit" },
);
if (profileProcess.exitCode !== 0) {
  throw new Error(
    `Windows visual-profile detection exited with status ${String(profileProcess.exitCode)}.`,
  );
}
const actual = SystemProfileSchema.parse(
  JSON.parse(new TextDecoder().decode(profileProcess.stdout)),
);
const actualName = `${String(actual.scale)}-${actual.theme}`;
if (actualName !== requested) {
  throw new Error(
    `Visual profile '${requested}' was requested, but the unlocked Windows session is '${actualName}'. Change the real display scaling/theme and retry.`,
  );
}

const e2e = Bun.spawn(
  [
    process.execPath,
    "scripts/e2e.ts",
    "--scenario",
    "visual-modes",
    "--keep-artifacts",
  ],
  {
    cwd: packageRoot,
    env: {
      ...Bun.env,
      TASKNOTES_E2E_VISUAL_VARIANT: requested,
      TASKNOTES_E2E_VISUAL_ACTUAL: actualName,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
const exitCode = await e2e.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}

const revisionProcess = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
  cwd: packageRoot,
  stdout: "pipe",
  stderr: "inherit",
});
if (revisionProcess.exitCode !== 0) {
  throw new Error("Unable to resolve the current commit for visual evidence.");
}
const revision = new TextDecoder().decode(revisionProcess.stdout).trim();
const outputDirectory = path.join(packageRoot, "artifacts", "visual-matrix");
await mkdir(outputDirectory, { recursive: true });
await Bun.write(
  path.join(outputDirectory, `${requested}.json`),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      profile: requested,
      revision,
      recordedAtUtc: new Date().toISOString(),
      e2eScenario: "visual-modes",
    },
    null,
    2,
  )}\n`,
);
await Bun.write(
  Bun.stdout,
  `Recorded fresh ${requested} visual evidence for ${revision}.\n`,
);
