import { chmod, cp, lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

/** Validate before container creation; never modify the source world or follow links. */
export async function requireWorldDirectory(directory: string): Promise<void> {
  if (
    !path.isAbsolute(directory) ||
    (await realpath(directory)) !== path.resolve(directory)
  ) {
    throw new Error(
      "Saved-world source must be an absolute directory without linked parents",
    );
  }
  const root = await lstat(directory);
  const level = await lstat(path.join(directory, "level.dat"));
  if (!root.isDirectory() || !level.isFile()) {
    throw new Error("Saved-world source requires native level.dat");
  }
  async function inspect(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) await inspect(path.join(current, entry.name));
      else if (!entry.isFile())
        throw new Error(
          "Saved-world source contains linked or non-regular data",
        );
    }
  }
  await inspect(directory);
}

/** Docker copies files as root; give Paper access only on a disposable private copy. */
export async function stageWorldDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await requireWorldDirectory(destination);
  async function writable(directory: string): Promise<void> {
    await chmod(directory, 0o777);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await writable(child);
      else await chmod(child, 0o666);
    }
  }
  await writable(destination);
}
