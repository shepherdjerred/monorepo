import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const archivePath = join(packageRoot, "dist", "QuotaBar.xcarchive");
const exportPath = join(packageRoot, "dist", "notarized");
const attempts = 40;
const retryDelayMilliseconds = 15_000;

if (!(await Bun.file(join(archivePath, "Info.plist")).exists())) {
  throw new Error(
    "QuotaBar archive is missing; run bun run archive:macos first.",
  );
}
if (resolve(exportPath) !== resolve(packageRoot, "dist", "notarized")) {
  throw new Error("Refusing unexpected notarized export target.");
}

await rm(exportPath, { recursive: true, force: true });

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = Bun.spawnSync(
    [
      "xcodebuild",
      "-exportNotarizedApp",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportPath,
    ],
    {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;

  if (result.exitCode === 0) {
    process.stdout.write(output);
    console.log(`Exported notarized app to ${exportPath}`);
    process.exit(0);
  }
  if (!output.includes("is processing and not ready for distribution")) {
    process.stderr.write(output);
    process.exit(result.exitCode);
  }
  if (attempt === attempts) {
    throw new Error("Notarization did not finish within ten minutes.");
  }

  console.log(`Notarization is processing (${attempt}/${attempts}); retrying…`);
  await Bun.sleep(retryDelayMilliseconds);
}
