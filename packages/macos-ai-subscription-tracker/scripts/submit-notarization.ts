import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const archivePath = join(packageRoot, "dist", "QuotaBar.xcarchive");
const exportPath = join(packageRoot, "dist", "notary-upload");
const exportOptionsPath = join(
  packageRoot,
  "Resources",
  "NotarizationExportOptions.plist",
);

if (!(await Bun.file(join(archivePath, "Info.plist")).exists())) {
  throw new Error(
    "QuotaBar archive is missing; run bun run archive:macos first.",
  );
}
if (!(await Bun.file(exportOptionsPath).exists())) {
  throw new Error("Notarization export options are missing.");
}
if (resolve(exportPath) !== resolve(packageRoot, "dist", "notary-upload")) {
  throw new Error("Refusing unexpected notarization upload target.");
}

console.log("Submitting a new QuotaBar archive to Apple's notary service.");
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
console.log("Uploaded QuotaBar to Apple's notary service.");
