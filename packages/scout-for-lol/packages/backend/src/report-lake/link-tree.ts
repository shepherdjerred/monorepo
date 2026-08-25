import { copyFile, link, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export async function linkTreeContents(
  sourceDirectory: string,
  destinationDirectory: string,
): Promise<void> {
  const entries = await readdir(sourceDirectory, {
    withFileTypes: true,
    recursive: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(entry.parentPath, entry.name);
    const relative = source.slice(sourceDirectory.length + 1);
    const destination = path.join(destinationDirectory, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await link(source, destination);
    } catch {
      await copyFile(source, destination);
    }
  }
}
