import { chmod, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSteps, installPaths, installPlatform } from "./install-core.ts";

async function run(command: readonly string[], cwd: string): Promise<void> {
  const subprocess = Bun.spawn([...command], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

if (import.meta.main) {
  const home = os.homedir();
  const platform = installPlatform(process.platform);
  const root = path.dirname(import.meta.dir);
  const paths = installPaths(home, platform);
  const steps = buildSteps(home, platform);
  for (const step of steps) {
    await run(step.argv, root);
  }
  await mkdir(path.dirname(paths.brimBinary), { recursive: true });
  for (const step of steps) {
    await rm(step.destination, { force: true });
    await Bun.write(step.destination, Bun.file(path.join(root, step.output)));
    if (platform !== "win32") await chmod(step.destination, 0o755);
    if (platform === "darwin") {
      await run(["codesign", "--force", "--sign", "-", step.destination], root);
    }
    console.log(
      `Installed ${path.basename(step.destination)} to ${step.destination}`,
    );
  }
  if (platform !== "win32") await rm(paths.legacyBinary, { force: true });
}
