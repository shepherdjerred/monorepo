import path from "node:path";
import type { NativeArchiveScope } from "#shared/native-recovery/archive.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import type { FileOperationManifest } from "#filesystem/operations-types.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export function archiveAbsentPaths(scope: NativeArchiveScope): string[] {
  return [
    ...new Set(
      scope.edges.flatMap((edge) => {
        const entry = edge.publicationAttempt.entry;
        const control = `/data/${entry.libraryKind}/.media-control`;
        const canonical = `/data/${entry.libraryKind}/${entry.libraryPath}`;
        return [
          `${control}/staging/${entry.operationId}`,
          `${control}/staging/${entry.operationId}.partial`,
          `${control}/rollback/${edge.publicationAttempt.operationId}-rollback-${entry.assetId}`,
          ...(scope.files.some((file) => file.canonicalPath === canonical)
            ? []
            : [canonical]),
        ];
      }),
    ),
  ].sort();
}
export function archiveAllPaths(scope: NativeArchiveScope): string[] {
  return [
    ...new Set([
      ...scope.files.flatMap((file) => [
        file.canonicalPath,
        ...file.subtitles.flatMap((subtitle) =>
          subtitle.path === null ? [] : [subtitle.path],
        ),
      ]),
      ...scope.terminalDependencies.flatMap((item) =>
        item.dependency.files.map((file) => file.canonicalPath),
      ),
      ...archiveAbsentPaths(scope),
    ]),
  ].sort();
}

export function archiveOriginalJournals(
  context: NativeFileContext,
  scope: NativeArchiveScope,
): FileOperationManifest[] {
  const result: FileOperationManifest[] = [];
  for (const edge of scope.edges) {
    const entry = edge.publicationAttempt.entry;
    const roots = context.files.roots[entry.libraryKind];
    result.push({
      version: 1,
      operationId: entry.operationId,
      kind: "import",
      source: path.join(roots.downloads, entry.downloadPath),
      target: path.join(roots.library, entry.libraryPath),
      sha256: entry.checksum,
      previousSha256: entry.previousChecksum,
      phase: "complete",
    });
    for (const sidecar of entry.previousSidecars)
      result.push({
        version: 1,
        operationId: sidecar.operationId,
        kind: "quarantine",
        source: path.join(roots.library, sidecar.libraryPath),
        target: path.join(roots.control, "quarantine", sidecar.quarantineId),
        sha256: sidecar.checksum,
        previousSha256: null,
        phase: "complete",
      });
  }
  for (const item of scope.terminalDependencies)
    for (const journal of item.dependency.journals)
      result.push({
        version: 1,
        ...journal,
        source:
          journal.kind === "import" && !journal.source.startsWith("/data/")
            ? journal.source
            : nativeLocalPath(context, journal.source),
        target: nativeLocalPath(context, journal.target),
        phase: "complete",
      });
  const unique = new Map<string, FileOperationManifest>();
  for (const item of result) {
    const existing = unique.get(item.operationId);
    if (existing !== undefined && snapshotHash(existing) !== snapshotHash(item))
      throw new Error("Archive journal identity collision");
    unique.set(item.operationId, item);
  }
  return [...unique.values()].sort((a, b) =>
    a.operationId.localeCompare(b.operationId),
  );
}
