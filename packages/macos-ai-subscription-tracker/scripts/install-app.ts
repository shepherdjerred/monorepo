import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const mode = process.argv[2];
if (mode !== undefined && mode !== "--notarized") {
  throw new Error(`Unknown install mode: ${mode}`);
}
const notarized = mode === "--notarized";
const source = notarized
  ? resolve(packageRoot, "dist", "notarized", "QuotaBar.app")
  : resolve(packageRoot, "dist", "QuotaBar.app");
const target = "/Applications/Brim.app";
const legacyTarget = "/Applications/QuotaBar.app";
if (
  target !== "/Applications/Brim.app" ||
  legacyTarget !== "/Applications/QuotaBar.app"
)
  throw new Error("Refusing unexpected install target.");

const verificationScript = notarized
  ? "scripts/verify-notarized-app.ts"
  : "scripts/verify-app.ts";
const verification = Bun.spawnSync(["bun", verificationScript], {
  cwd: packageRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if (verification.exitCode !== 0) process.exit(verification.exitCode);

const installedExecutables = [
  `${target}/Contents/MacOS/QuotaBar`,
  `${legacyTarget}/Contents/MacOS/QuotaBar`,
];
for (const executable of installedExecutables) {
  for (const pid of installedProcessIDs(executable)) {
    process.kill(pid, "SIGTERM");
  }
}
for (let attempt = 0; attempt < 50; attempt += 1) {
  if (
    installedExecutables.every(
      (executable) => installedProcessIDs(executable).length === 0,
    )
  )
    break;
  await Bun.sleep(100);
}
if (
  installedExecutables.some(
    (executable) => installedProcessIDs(executable).length !== 0,
  )
) {
  throw new Error(`Refusing to replace running application at ${target}`);
}

console.log(`Installing verified bundle to exact target ${target}`);
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
await rm(legacyTarget, { recursive: true, force: true });
const signature = Bun.spawnSync(
  ["codesign", "--verify", "--deep", "--strict", target],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (signature.exitCode !== 0) process.exit(signature.exitCode);
const launched = Bun.spawnSync(["open", target], {
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(launched.exitCode);

function installedProcessIDs(executable: string): number[] {
  const result = Bun.spawnSync(["/bin/ps", "-axo", "pid=,command="], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
  return result.stdout
    .toString()
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (!match || match[2] !== executable) return [];
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid <= 0) return [];
      return [pid];
    });
}
