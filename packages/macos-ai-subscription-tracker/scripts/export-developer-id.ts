import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const archivePath = join(packageRoot, "dist", "QuotaBar.xcarchive");
const exportPath = join(packageRoot, "dist", "developer-id");
const exportOptionsPath = join(
  packageRoot,
  "Resources",
  "DeveloperIDExportOptions.plist",
);

if (!(await Bun.file(join(archivePath, "Info.plist")).exists())) {
  throw new Error(
    "QuotaBar archive is missing; run bun run archive:macos first.",
  );
}
if (!(await Bun.file(exportOptionsPath).exists())) {
  throw new Error("Developer ID export options are missing.");
}
if (resolve(exportPath) !== resolve(packageRoot, "dist", "developer-id")) {
  throw new Error("Refusing unexpected Developer ID export target.");
}

await rm(exportPath, { recursive: true, force: true });

const result = Bun.spawnSync(
  [
    "xcodebuild",
    "-exportArchive",
    "-archivePath",
    archivePath,
    "-exportPath",
    exportPath,
    "-exportOptionsPlist",
    exportOptionsPath,
    "-allowProvisioningUpdates",
  ],
  {
    cwd: packageRoot,
    stdout: "inherit",
    stderr: "inherit",
  },
);

if (result.exitCode !== 0) process.exit(result.exitCode);
console.log(`Exported Developer ID app to ${exportPath}`);
