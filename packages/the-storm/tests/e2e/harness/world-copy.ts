import { chmod, cp, readdir } from "node:fs/promises";
import path from "node:path";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";

/** Docker copies as root; Paper needs a writable disposable copy of the supplied world. */
async function writableWorld(directory: string): Promise<void> {
  await chmod(directory, 0o777);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await writableWorld(target);
    } else {
      await chmod(target, 0o666);
    }
  }
}

export async function stageWorld(
  source: string,
  stagingDir: string,
  containerId: string,
  world = "world",
): Promise<void> {
  if (!/^[a-z][a-z0-9-]*$/u.test(world))
    throw new Error("Invalid staged world name");
  const copy = path.join(stagingDir, world);
  await cp(source, copy, { recursive: true });
  await writableWorld(copy);
  // Warm-cache containers already have /data/world; copy contents rather than nesting world/world.
  await docker(["exec", containerId, "mkdir", "-p", `/data/${world}`]);
  await docker(["cp", `${copy}/.`, `${containerId}:/data/${world}`]);
}
