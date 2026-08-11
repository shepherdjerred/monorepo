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

const temporaryDirectory = await mkdtemp(join(tmpdir(), "quotabar-icon-"));
try {
  const iconset = join(temporaryDirectory, "AppIcon.iconset");
  await mkdir(iconset);
  const source = join(packageRoot, "Resources", "AppIcon.svg");
  const variants = [
    ["icon_16x16.png", "16"],
    ["icon_16x16@2x.png", "32"],
    ["icon_32x32.png", "32"],
    ["icon_32x32@2x.png", "64"],
    ["icon_128x128.png", "128"],
    ["icon_128x128@2x.png", "256"],
    ["icon_256x256.png", "256"],
    ["icon_256x256@2x.png", "512"],
    ["icon_512x512.png", "512"],
    ["icon_512x512@2x.png", "1024"],
  ];
  for (const [name, size] of variants) {
    run([
      "sips",
      "-s",
      "format",
      "png",
      "-z",
      size,
      size,
      source,
      "--out",
      join(iconset, name),
    ]);
  }
  run([
    "iconutil",
    "-c",
    "icns",
    iconset,
    "-o",
    join(resources, "AppIcon.icns"),
  ]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const identity = process.env.QUOTABAR_CODESIGN_IDENTITY ?? "-";
run(["codesign", "--force", "--deep", "--sign", identity, appPath]);
console.log(`Built and signed ${appPath}`);
