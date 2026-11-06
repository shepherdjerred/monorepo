import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { FileContext } from "#automation/files/types.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { textDigest } from "#automation/plex-exclusion/evidence.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { perEpisodePaths } from "./import-wire.ts";

export function perEpisodeCanonicalStorageOptionsV1(enabled: true | undefined) {
  return enabled === true ? { canonicalStorage: true } : {};
}

export async function configurePerEpisodeCanonicalStorageV1(
  files: FileContext,
  ownerId: string,
  enabled: true | undefined,
) {
  if (enabled === true) {
    files.pathMapping = perEpisodePaths(files);
    await perEpisodeCanonicalExclusionV1(files, ownerId);
  }
}

export function perEpisodeStoredPartV1(
  files: FileContext,
  filename: string,
  enabled: true | undefined,
) {
  return enabled === true
    ? storedFilePath(files, "tv", "library", path.basename(filename))
    : filename;
}

/** Platform/scanner attestations are synthetic; the actual owner approvals
 * install storage authority themselves. This runs BEFORE their captures. */
export async function perEpisodeCanonicalExclusionV1(
  files: FileContext,
  ownerId: string,
) {
  for (const kind of ["movies", "tv"] as const)
    files.roots[kind] = {
      ...files.roots[kind],
      controlPolicy: "plex-excluded",
    };
  for (const proof of await grantTestExclusionProofs(
    files.db,
    ownerId,
    "fixture-server",
  )) {
    const kind = proof.libraryRoot === "/data/movies" ? "movies" : "tv";
    await writeFile(
      path.join(files.roots[kind].library, ".plexignore"),
      proof.rootMarkerAfter,
    );
    await writeFile(
      path.join(files.roots[kind].control, ".plexignore"),
      proof.controlMarkerAfter,
    );
  }
  files.verifyPlexExclusion = async (roots) => {
    const kind =
      roots.library === files.roots.movies.library
        ? "movies"
        : roots.library === files.roots.tv.library
          ? "tv"
          : null;
    if (kind === null || roots.control !== files.roots[kind].control)
      throw new Error("Native fixture exclusion targets another namespace");
    const proof = await requirePlexExclusionDatabaseProof(files.db, {
      library: `/data/${kind}`,
      control: `/data/${kind}/.media-control`,
    });
    const [root, control] = await Promise.all([
      readFile(path.join(roots.library, ".plexignore"), "utf8"),
      readFile(path.join(roots.control, ".plexignore"), "utf8"),
    ]);
    if (
      textDigest(root) !== proof.rootMarkerSha256 ||
      textDigest(control) !== proof.controlMarkerSha256
    )
      throw new Error("Native fixture actual scanner marker bytes changed");
  };
}

/** Only enabled AFTER both genuine initial approvals installed their grants. */
export function perEpisodeCanonicalStorageGuardV1(
  files: FileContext,
  enabled: true | undefined,
) {
  if (enabled !== true) return;
  files.verifyStorageAuthority = (roots) => {
    const kind =
      roots.library === files.roots.movies.library
        ? "movies"
        : roots.library === files.roots.tv.library
          ? "tv"
          : null;
    if (kind === null)
      throw new Error("Native fixture storage guard targets another namespace");
    return requireStorageAuthority(files.db, `/data/${kind}`, "files-pod-uid");
  };
}
