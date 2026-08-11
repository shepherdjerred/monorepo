import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const appPath = resolve(packageRoot, "dist", "QuotaBar.app");
const plist = join(appPath, "Contents", "Info.plist");
const resources = join(appPath, "Contents", "Resources");

function run(command: string[], capture = false) {
  const result = Bun.spawnSync(command, {
    cwd: packageRoot,
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
  return capture ? result.stdout.toString().trim() : "";
}

await access(join(appPath, "Contents", "MacOS", "QuotaBar"), constants.X_OK);
await access(join(resources, "AppIcon.icns"));
run(["plutil", "-lint", plist]);
assertPlistValue("CFBundleIdentifier", "com.sjerred.QuotaBar");
assertPlistValue("CFBundleExecutable", "QuotaBar");
assertPlistValue("CFBundleDisplayName", "Brim");
assertPlistValue("CFBundleName", "Brim");
assertPlistValue("CFBundleIconFile", "AppIcon");
assertPlistValue("CFBundlePackageType", "APPL");
assertPlistValue(
  "LSApplicationCategoryType",
  "public.app-category.developer-tools",
);
assertPlistValue("LSMinimumSystemVersion", "15.0");
assertPlistValue("LSUIElement", "true");
run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", appPath]);

const resourceBundle = join(resources, "QuotaBar_QuotaBar.bundle");
for (const logo of ["claude.svg", "codex.svg", "kimi.svg", "grok.svg"]) {
  await access(join(resourceBundle, "Contents", "Resources", logo));
}
for (const asset of [
  "brim-mark-light.svg",
  "brim-menubar-full.svg",
  "brim-menubar-low.svg",
  "brim-menubar-critical.svg",
  "brim-menubar-unavailable.svg",
]) {
  await access(join(resourceBundle, "Contents", "Resources", asset));
}
await access(join(resourceBundle, "Contents", "Resources", "NOTICE.md"));
console.log(`Verified ${appPath}`);

function assertPlistValue(key: string, expected: string) {
  const actual = run(
    ["/usr/libexec/PlistBuddy", "-c", `Print :${key}`, plist],
    true,
  );
  if (actual !== expected)
    throw new Error(`Unexpected ${key}: ${actual || "<missing>"}`);
}
