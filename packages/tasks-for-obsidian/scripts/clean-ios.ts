import { $ } from "bun";
import { rm } from "node:fs/promises";
import { cleanTargets, derivedDataTargets } from "./ios-scripts-core.ts";

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const home = Bun.env["HOME"];
  if (home === undefined) throw new Error("HOME is required");
  const [build, pods] = cleanTargets(root);
  const derivedData = await derivedDataTargets(home);
  await Promise.all([
    rm(build, { force: true, recursive: true }),
    rm(pods, { force: true, recursive: true }),
    ...derivedData.map((path) => rm(path, { force: true, recursive: true })),
  ]);
  await $`pod install`.cwd(`${root}/ios`);
  console.log("Done. Run: bun run ios");
}
