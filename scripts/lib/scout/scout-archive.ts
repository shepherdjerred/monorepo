import {
  requiredReleaseEntrypoints,
  archiveEntrypoints,
} from "./scout-release-entrypoints.ts";
import { assertScoutCustomsArtifactPolicy } from "./scout-customs-artifact.ts";

export const DELIVERY_SCOUT_RELEASE_WORK_DIR =
  ".delivery-artifacts/scout-release";

export async function hashSiteArchive(directory: string): Promise<string> {
  const paths: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    paths.push(path);
  }
  paths.sort();
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of paths) {
    hasher.update(`${path}\0`);
    hasher.update(await Bun.file(`${directory}/${path}`).bytes());
  }
  return `sha256:${hasher.digest("hex")}`;
}

/** Preserve flavor and entrypoint safety before any immutable publication. */
export async function assertScoutArchiveSource(
  directory: string,
  flavor: "prod" | "beta",
): Promise<void> {
  const present = await archiveEntrypoints(directory);
  for (const required of requiredReleaseEntrypoints(flavor))
    if (!present.includes(required))
      throw new Error(`Scout ${flavor} archive is missing ${required}`);
  await assertScoutCustomsArtifactPolicy(directory, flavor);
}
