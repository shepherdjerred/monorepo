import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const appPath = join(packageRoot, "dist", "QuotaBar.app");
const expectedAppPath = resolve(packageRoot, "dist", "QuotaBar.app");
if (resolve(appPath) !== expectedAppPath)
  throw new Error("Refusing unexpected app target.");

function run(command: string[]) {
  const result = Bun.spawnSync(command, {
    cwd: packageRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

run(["swift", "build", "-c", "release", "-Xswiftc", "-warnings-as-errors"]);
const binPathResult = Bun.spawnSync(
  ["swift", "build", "-c", "release", "--show-bin-path"],
  {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "inherit",
  },
);
if (binPathResult.exitCode !== 0) process.exit(binPathResult.exitCode);
const binPath = binPathResult.stdout.toString().trim();

await rm(appPath, { recursive: true, force: true });
const contents = join(appPath, "Contents");
const macOS = join(contents, "MacOS");
const resources = join(contents, "Resources");
await mkdir(macOS, { recursive: true });
await mkdir(resources, { recursive: true });
await cp(
  join(packageRoot, "Resources", "Info.plist"),
  join(contents, "Info.plist"),
);
await cp(join(binPath, "QuotaBar"), join(macOS, "QuotaBar"));
const packagedResourceBundle = join(resources, "QuotaBar_QuotaBar.bundle");
await cp(join(binPath, "QuotaBar_QuotaBar.bundle"), packagedResourceBundle, {
  recursive: true,
});

const developerDirectory = runCapture(["xcode-select", "-p"]);
const iconComposerTool = join(
  resolve(
    developerDirectory,
    "..",
    "Applications",
    "Icon Composer.app",
    "Contents",
    "Executables",
  ),
  "ictool",
);
if (!(await Bun.file(iconComposerTool).exists()))
  throw new Error(
    `Icon Composer's ictool is missing from the selected Xcode: ${iconComposerTool}`,
  );

const temporaryDirectory = await mkdtemp(join(tmpdir(), "quotabar-icon-"));
try {
  const iconset = join(temporaryDirectory, "AppIcon.iconset");
  await mkdir(iconset);
  const variants = [
    ["icon_16x16.png", "16", "1"],
    ["icon_16x16@2x.png", "16", "2"],
    ["icon_32x32.png", "32", "1"],
    ["icon_32x32@2x.png", "32", "2"],
    ["icon_128x128.png", "128", "1"],
    ["icon_128x128@2x.png", "128", "2"],
    ["icon_256x256.png", "256", "1"],
    ["icon_256x256@2x.png", "256", "2"],
    ["icon_512x512.png", "512", "1"],
    ["icon_512x512@2x.png", "512", "2"],
  ] as const;
  const iconDocument = join(packageRoot, "Resources", "Brim.icon");
  for (const [name, size, scale] of variants) {
    run([
      iconComposerTool,
      iconDocument,
      "--export-image",
      "--output-file",
      join(iconset, name),
      "--platform",
      "macOS",
      "--rendition",
      "Default",
      "--width",
      size,
      "--height",
      size,
      "--scale",
      scale,
      "--design-generation",
      "26",
    ]);
  }
  run(["iconutil", "-c", "icns", iconset, "-o", join(resources, "Brim.icns")]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const identity = signingIdentity();
run(["codesign", "--force", "--deep", "--sign", identity, appPath]);
console.log(`Built and signed ${appPath}`);

function runCapture(command: string[]) {
  const result = Bun.spawnSync(command, {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
  return result.stdout.toString().trim();
}

function signingIdentity(): string {
  const configuredIdentity = Bun.env.QUOTABAR_CODESIGN_IDENTITY;
  if (configuredIdentity !== undefined) {
    if (configuredIdentity.trim().length === 0)
      throw new Error("QUOTABAR_CODESIGN_IDENTITY cannot be empty.");
    return configuredIdentity;
  }

  const identities = runCapture([
    "security",
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ])
    .split("\n")
    .flatMap((line) => {
      const match =
        /^\s*\d+\)\s+([0-9A-F]{40})\s+\"Developer ID Application:/.exec(line);
      if (match === null) return [];
      const identity = match[1];
      return identity === undefined ? [] : [identity];
    });

  if (identities.length > 1) {
    throw new Error(
      "Multiple Developer ID Application identities are installed; set " +
        "QUOTABAR_CODESIGN_IDENTITY to the intended identity hash.",
    );
  }

  return identities[0] ?? "-";
}
