import path from "node:path";
import { mkdir } from "node:fs/promises";

const workspaceRoot = path.resolve(import.meta.dir, "..");
const artifacts = path.join(workspaceRoot, "artifacts");
await mkdir(artifacts, { recursive: true });

const child = Bun.spawn(
  [
    "cargo",
    "llvm-cov",
    "--package",
    "tasknotes-core",
    "--package",
    "tasknotes-core-ffi",
    "--all-features",
    "--all-targets",
    "--fail-under-lines",
    "90",
    "--fail-under-functions",
    "90",
    "--fail-under-regions",
    "80",
    "--cobertura",
    "--output-path",
    path.join(artifacts, "coverage.cobertura.xml"),
  ],
  {
    cwd: workspaceRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
const exitCode = await child.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}
const ratchet = Bun.spawn([process.execPath, "ci/coverage-ratchet.ts"], {
  cwd: workspaceRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await ratchet.exited);
