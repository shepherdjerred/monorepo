import path from "node:path";
import type { FileContext } from "#automation/files/types.ts";
import type { PublicationIntent } from "#shared/publication-proof/intent.ts";
import type {
  LockedPublicationEvent,
  PublicationPath,
} from "#shared/publication-proof/effects.ts";
import type { FileOperationManifest } from "#filesystem/operations-types.ts";

export type PublicationStep = {
  continuationId?: string | null;
  completionPaths?: readonly PublicationPath[];
  entryOperationId: string;
  operationId: string;
  assetId: string;
  subtitleId: string | null;
  libraryKind: "movies" | "tv";
  step: LockedPublicationEvent["step"];
  primitive: LockedPublicationEvent["primitive"];
  source: PublicationPath | null;
  target: PublicationPath | null;
  manifest: FileOperationManifest;
};

/** Exact forward sequence follows the existing FileOperations calls, without synthesizing their ACKs. */
export function publicationForwardSteps(
  context: Pick<FileContext, "roots">,
  intent: PublicationIntent,
): PublicationStep[] {
  const result: PublicationStep[] = [];
  for (const { entry } of intent.entries) {
    const roots = context.roots[entry.libraryKind];
    for (const sidecar of entry.previousSidecars) {
      if (entry.previousAssetId === null)
        throw new Error("Sidecar has no predecessor");
      const source: PublicationPath = {
        root: "library",
        path: sidecar.libraryPath,
      };
      const target: PublicationPath = {
        root: "control",
        path: `quarantine/${sidecar.quarantineId}`,
      };
      const base = {
        entryOperationId: entry.operationId,
        operationId: sidecar.operationId,
        assetId: entry.previousAssetId,
        subtitleId: sidecar.subtitleId,
        libraryKind: entry.libraryKind,
        manifest: {
          version: 1,
          operationId: sidecar.operationId,
          kind: "quarantine",
          source: path.join(roots.library, source.path),
          target: path.join(roots.control, target.path),
          sha256: sidecar.checksum,
          previousSha256: null,
          phase: "prepared",
        } satisfies FileOperationManifest,
      };
      result.push(
        { ...base, step: "move_link", primitive: "link", source, target },
        {
          ...base,
          step: "move_unlink",
          primitive: "unlink",
          source,
          target: null,
        },
        {
          ...base,
          step: "journal_complete",
          primitive: "journal_complete",
          source: null,
          target: null,
        },
      );
    }
    const source: PublicationPath = {
      root: "control",
      path: `staging/${entry.operationId}`,
    };
    const target: PublicationPath = {
      root: "library",
      path: entry.libraryPath,
    };
    const base = {
      entryOperationId: entry.operationId,
      operationId: entry.operationId,
      assetId: entry.assetId,
      subtitleId: null,
      libraryKind: entry.libraryKind,
      manifest: {
        version: 1,
        operationId: entry.operationId,
        kind: "import",
        source: path.join(roots.downloads, entry.downloadPath),
        target: path.join(roots.library, entry.libraryPath),
        sha256: entry.checksum,
        previousSha256: entry.previousChecksum,
        phase: "staged",
      } satisfies FileOperationManifest,
    };
    if (entry.previousAssetId === null)
      result.push(
        {
          ...base,
          step: "import_publish_link",
          primitive: "link",
          source,
          target,
        },
        {
          ...base,
          step: "import_stage_unlink",
          primitive: "unlink",
          source,
          target: null,
        },
      );
    else
      result.push(
        {
          ...base,
          step: "import_backup_link",
          primitive: "link",
          source: target,
          target: { root: "control", path: `rollback/${entry.operationId}` },
        },
        {
          ...base,
          step: "import_publish_rename",
          primitive: "rename",
          source,
          target,
        },
      );
    result.push({
      ...base,
      step: "journal_complete",
      primitive: "journal_complete",
      source: null,
      target: null,
    });
  }
  return result;
}
