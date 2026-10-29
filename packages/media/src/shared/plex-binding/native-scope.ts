import type { z } from "zod";
import type { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";

export type NativeCatalogScopeSnapshot = z.infer<
  typeof NativeStoredScopeSchema
>;

export function nativePlaybackFiles(scope: NativeCatalogScopeSnapshot) {
  if (scope.schemaVersion === 1 || scope.lifecycleKind === "published")
    return scope.files;
  return scope.lifecycleKind === "superseded_archive"
    ? scope.files.filter((file) => file.role === "current_playback")
    : [];
}

/** Exact catalog exclusions shared by the new producer and immutable proof validator. */
export function nativeAbsentPaths(
  scope: NativeCatalogScopeSnapshot,
): { assetId: string; paths: string[] }[] {
  if (scope.schemaVersion === 1 || scope.lifecycleKind === "published")
    return [];
  if (scope.lifecycleKind === "publication_compensation") {
    const groups = new Map<string, string[]>();
    for (const item of scope.requiredAbsences)
      groups.set(item.assetId, [
        ...(groups.get(item.assetId) ?? []),
        item.canonicalPath,
      ]);
    return [...groups].map(([assetId, paths]) => ({
      assetId,
      paths: [...new Set(paths)].sort(),
    }));
  }
  if (scope.lifecycleKind === "committed_quarantine")
    return scope.files.map((file) => ({
      assetId: file.assetId,
      paths: [
        ...new Set([
          file.canonicalPath,
          `/data/${file.libraryKind}/.media-control/quarantine/${file.quarantineId}`,
          ...file.sidecars.flatMap((sidecar) => [
            `/data/${file.libraryKind}/${sidecar.libraryPath}`,
            `/data/${file.libraryKind}/.media-control/quarantine/${sidecar.quarantineId}`,
          ]),
        ]),
      ].sort(),
    }));
  const groups = scope.files
    .filter((file) => file.role !== "current_playback")
    .map((file) => ({
      assetId: file.assetId,
      paths: [
        ...new Set([
          file.canonicalPath,
          ...file.subtitles.flatMap((subtitle) =>
            subtitle.path === null ? [] : [subtitle.path],
          ),
        ]),
      ].sort(),
    }));
  for (const terminal of scope.terminalDependencies) {
    const assetId = terminal.dependency.assetIds[0];
    const paths = terminal.dependency.files
      .filter((file) => file.expectedChecksum === null)
      .map((file) => file.canonicalPath)
      .sort();
    if (assetId === undefined || paths.length === 0)
      throw new Error("Native terminal absence omitted its exact paths");
    groups.push({ assetId, paths });
  }
  return groups;
}
