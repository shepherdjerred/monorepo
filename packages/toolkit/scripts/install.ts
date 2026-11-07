import { $ } from "bun";
import { chmod, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSteps,
  codesignArgv,
  developerIdIdentity,
  installPaths,
  installPlatform,
} from "./install-core.ts";

if (import.meta.main) {
  const home = os.homedir();
  const platform = installPlatform(process.platform);
  const root = path.dirname(import.meta.dir);
  const paths = installPaths(home, platform);
  const steps = buildSteps(home, platform);
  // Resolve the signing identity before building so a missing certificate
  // fails before anything is replaced.
  const identity =
    platform === "darwin"
      ? developerIdIdentity(
          await $`security find-identity -v -p codesigning`.text(),
        )
      : null;
  for (const step of steps) {
    await $`${[...step.argv]}`.cwd(root);
  }
  await mkdir(path.dirname(paths.brimBinary), { recursive: true });
  for (const step of steps) {
    await rm(step.destination, { force: true });
    await Bun.write(step.destination, Bun.file(path.join(root, step.output)));
    if (platform !== "win32") await chmod(step.destination, 0o755);
    if (identity !== null) {
      await $`${codesignArgv(identity, step.destination)}`.cwd(root);
    }
    console.log(
      `Installed ${path.basename(step.destination)} to ${step.destination}`,
    );
  }
  if (platform !== "win32") await rm(paths.legacyBinary, { force: true });
}
