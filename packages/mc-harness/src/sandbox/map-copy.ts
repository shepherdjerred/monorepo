import { cp, mkdir, readdir, stat, readFile, chmod } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { MapSourceSchema } from "#protocol/ipc.ts";
import type { z } from "zod";

/** Only world content is imported. Player identities and source locks stay outside the copy. */
async function fingerprint(
  directory: string,
): Promise<z.infer<typeof MapSourceSchema>> {
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  const dimensions = new Set<string>();
  const visit = async (relative: string): Promise<void> => {
    await chmod(path.join(directory, relative), 0o777);
    const entries = await readdir(path.join(directory, relative), {
      withFileTypes: true,
    });
    for (const entry of entries.toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("World imports cannot contain symbolic links");
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        await chmod(path.join(directory, name), 0o666);
        const data = await readFile(path.join(directory, name));
        hash.update(
          JSON.stringify([
            name,
            data.length,
            createHash("sha256").update(data).digest("hex"),
          ]),
        );
        files++;
        bytes += data.length;
        const parts = name.split(path.sep);
        if (
          parts.length === 5 &&
          parts[0] === "dimensions" &&
          parts[3] === "region" &&
          /^r\.-?\d+\.-?\d+\.mca$/u.test(parts[4] ?? "")
        )
          dimensions.add(`${parts[1] ?? ""}:${parts[2] ?? ""}`);
      } else throw new Error("World import contains an unsupported file");
    }
  };
  await visit("");
  return {
    sha256: hash.digest("hex"),
    files,
    bytes,
    dimensions: [...dimensions].toSorted(),
  };
}

export async function copyRealMap(source: string, destination: string) {
  source = path.resolve(source);
  if (!(await Bun.file(path.join(source, "level.dat")).exists()))
    throw new Error("Real-map source requires level.dat");
  const terrain = path.join(source, "dimensions/minecraft/overworld/region");
  const terrainStat = await stat(terrain);
  if (!terrainStat.isDirectory())
    throw new Error("Real-map source requires saved overworld regions");
  const regions = await readdir(terrain);
  if (!regions.some((name) => /^r\.-?\d+\.-?\d+\.mca$/u.test(name)))
    throw new Error("Real-map source has no saved terrain");
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const name of ["level.dat", "dimensions", "data", "datapacks"]) {
    const target = path.join(source, name);
    await cp(target, path.join(destination, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
    });
  }
  // Hash the disposable copy, never a live session.lock or player data.
  return fingerprint(destination);
}
