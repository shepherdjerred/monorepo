import { chmod, cp, readdir } from "node:fs/promises";
import path from "node:path";
import { docker } from "./docker.ts";

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
): Promise<void> {
  const copy = path.join(stagingDir, "world");
  await cp(source, copy, { recursive: true });
  await writableWorld(copy);
  await docker(["cp", copy, `${containerId}:/data/world`]);
}
