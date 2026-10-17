import path from "node:path";
import type { FileContext, FilePlanEntry } from "#automation/files/types.ts";
import type { PublicationPath } from "#shared/publication-proof/effects.ts";
import type { NativeCompensationStep } from "#shared/native-recovery/compensation.ts";
import {
  FileOperationConflict,
  ManifestSchema,
  type FileOperationManifest,
} from "#filesystem/operations-types.ts";
import type { FileOperations } from "#filesystem/operations.ts";
import { type PublicationEffectState, physicalKey } from "./effect-state.ts";
import type { PublicationStep } from "./steps.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";

export type InverseAction = {
  entry: FilePlanEntry;
  descriptor: NativeCompensationStep;
  events: PublicationStep[];
};

/** Derive the full inverse from a validated causal prefix, never from a matching checksum alone. */
export function publicationInverse(
  context: FileContext,
  state: PublicationEffectState,
  continuationId: string | null,
): InverseAction[] {
  const result: InverseAction[] = [];
  for (const { entry } of state.intent.intent.entries) {
    const canonical: PublicationPath = {
      root: "library",
      path: entry.libraryPath,
    };
    const current = state.physical.get(
      physicalKey(entry.libraryKind, canonical),
    );
    const videoJournal = state.journals.get(
      JSON.stringify([
        entry.libraryKind,
        `journal/recover-${entry.assetId}.json`,
      ]),
    );
    const unfinishedVideoInverse =
      videoJournal !== undefined &&
      ManifestSchema.parse(JSON.parse(videoJournal.raw)).phase !== "complete";
    if (
      unfinishedVideoInverse ||
      (current?.state === "present" && current.sha256 === entry.checksum)
    )
      result.push(videoInverse(context, state, entry, continuationId));
    else if (
      current === undefined ||
      (entry.previousChecksum === null
        ? current.state !== "absent"
        : current.state !== "present" ||
          current.sha256 !== entry.previousChecksum)
    )
      throw new FileOperationConflict(
        "Inverse publication has an unexplained canonical state",
      );
    for (const sidecar of entry.previousSidecars) {
      const inverse = sidecarInverse(context, state, entry, {
        sidecar,
        continuationId,
      });
      if (inverse !== null) result.push(inverse);
    }
  }
  return result;
}

function sidecarInverse(
  context: FileContext,
  state: PublicationEffectState,
  entry: FilePlanEntry,
  {
    sidecar,
    continuationId,
  }: {
    sidecar: FilePlanEntry["previousSidecars"][number];
    continuationId: string | null;
  },
): InverseAction | null {
  if (entry.previousAssetId === null)
    throw new Error("Inverse sidecar predecessor missing");
  const source: PublicationPath = {
    root: "control",
    path: `quarantine/${sidecar.quarantineId}`,
  };
  const target: PublicationPath = {
    root: "library",
    path: sidecar.libraryPath,
  };
  const retained = state.physical.get(physicalKey(entry.libraryKind, source));
  const inverseJournal = state.journals.get(
    JSON.stringify([
      entry.libraryKind,
      `journal/recover-${sidecar.quarantineId}.json`,
    ]),
  );
  if (retained?.state === "absent") {
    if (
      inverseJournal !== undefined &&
      ManifestSchema.parse(JSON.parse(inverseJournal.raw)).phase !== "complete"
    )
      return moveInverse(context, entry, {
        operationId: `recover-${sidecar.quarantineId}`,
        assetId: entry.previousAssetId,
        subtitleId: sidecar.subtitleId,
        kind: "restore",
        checksum: sidecar.checksum,
        source,
        target,
        alreadyLinked: true,
        alreadyRemoved: true,
        continuationId,
      });
    return null;
  }
  if (retained?.state !== "present" || retained.sha256 !== sidecar.checksum)
    throw new FileOperationConflict(
      "Inverse sidecar has an unexplained quarantine state",
    );
  const served = state.physical.get(physicalKey(entry.libraryKind, target));
  const alreadyLinked =
    served?.state === "present" &&
    served.identity.device === retained.identity.device &&
    served.identity.inode === retained.identity.inode;
  if (!alreadyLinked && served?.state !== "absent")
    throw new FileOperationConflict("Inverse sidecar destination is foreign");
  return moveInverse(context, entry, {
    operationId: `recover-${sidecar.quarantineId}`,
    assetId: entry.previousAssetId,
    subtitleId: sidecar.subtitleId,
    kind: "restore",
    checksum: sidecar.checksum,
    source,
    target,
    alreadyLinked,
    continuationId,
  });
}

function videoInverse(
  context: FileContext,
  state: PublicationEffectState,
  entry: FilePlanEntry,
  continuationId: string | null,
): InverseAction {
  const operationId = `recover-${entry.assetId}`;
  const canonical: PublicationPath = {
    root: "library",
    path: entry.libraryPath,
  };
  if (entry.previousChecksum === null)
    return moveInverse(context, entry, {
      operationId,
      assetId: entry.assetId,
      subtitleId: null,
      kind: "quarantine",
      checksum: entry.checksum,
      source: canonical,
      target: { root: "control", path: `quarantine/${entry.assetId}` },
      alreadyLinked: false,
      continuationId,
    });
  if (entry.previousAssetId === null)
    throw new Error("Upgrade inverse predecessor missing");
  const roots = context.roots[entry.libraryKind];
  const source: PublicationPath = {
    root: "control",
    path: `rollback/${entry.operationId}`,
  };
  const rejected: PublicationPath = {
    root: "control",
    path: `rollback/${operationId}`,
  };
  const staged: PublicationPath = {
    root: "control",
    path: `staging/${operationId}`,
  };
  const manifest: FileOperationManifest = {
    version: 1,
    operationId,
    kind: "rollback",
    source: path.join(roots.control, source.path),
    target: path.join(roots.library, canonical.path),
    sha256: entry.previousChecksum,
    previousSha256: entry.checksum,
    phase: "prepared",
  };
  const base = {
    entryOperationId: entry.operationId,
    operationId,
    assetId: entry.previousAssetId,
    subtitleId: null,
    libraryKind: entry.libraryKind,
    continuationId,
    manifest,
  };
  const events: PublicationStep[] = [];
  const current = state.physical.get(physicalKey(entry.libraryKind, canonical));
  if (current?.state !== "present")
    throw new FileOperationConflict(
      "Inverse video canonical content is missing",
    );
  if (current.sha256 === entry.checksum) {
    if (
      state.physical.get(physicalKey(entry.libraryKind, rejected))?.state ===
      "absent"
    )
      events.push({
        ...base,
        step: "rollback_rejected_link",
        primitive: "link",
        source: canonical,
        target: rejected,
      });
    if (
      state.physical.get(physicalKey(entry.libraryKind, staged))?.state ===
      "absent"
    )
      events.push({
        ...base,
        step: "rollback_stage_link",
        primitive: "link",
        source,
        target: staged,
      });
    events.push({
      ...base,
      step: "rollback_publish_rename",
      primitive: "rename",
      source: staged,
      target: canonical,
    });
  } else if (current.sha256 !== entry.previousChecksum)
    throw new FileOperationConflict(
      "Inverse video is not an acknowledged predecessor",
    );
  events.push({
    ...base,
    step: "journal_complete",
    primitive: "journal_complete",
    source: null,
    target: null,
    completionPaths: [source, canonical, staged, rejected],
  });
  return {
    entry,
    descriptor: {
      stepId: operationId,
      entryOperationId: entry.operationId,
      kind: "rollback_video",
      operationId,
      assetId: entry.previousAssetId,
      subtitleId: null,
      libraryKind: entry.libraryKind,
      sourcePath: storedFilePath(
        context,
        entry.libraryKind,
        "control",
        source.path,
      ),
      targetPath: storedFilePath(
        context,
        entry.libraryKind,
        "library",
        canonical.path,
      ),
      checksum: entry.previousChecksum,
      previousChecksum: entry.checksum,
      retainedSuccessorPath: storedFilePath(
        context,
        entry.libraryKind,
        "control",
        rejected.path,
      ),
    },
    events,
  };
}

function moveInverse(
  context: FileContext,
  entry: FilePlanEntry,
  input: {
    operationId: string;
    assetId: string;
    subtitleId: string | null;
    kind: "restore" | "quarantine";
    checksum: string;
    source: PublicationPath;
    target: PublicationPath;
    alreadyLinked: boolean;
    alreadyRemoved?: boolean;
    continuationId: string | null;
  },
): InverseAction {
  const roots = context.roots[entry.libraryKind];
  const manifest: FileOperationManifest = {
    version: 1,
    operationId: input.operationId,
    kind: input.kind,
    source: path.join(roots[input.source.root], input.source.path),
    target: path.join(roots[input.target.root], input.target.path),
    sha256: input.checksum,
    previousSha256: null,
    phase: "prepared",
  };
  const base = {
    entryOperationId: entry.operationId,
    operationId: input.operationId,
    assetId: input.assetId,
    subtitleId: input.subtitleId,
    libraryKind: entry.libraryKind,
    continuationId: input.continuationId,
    manifest,
  };
  const events: PublicationStep[] = [];
  if (!input.alreadyLinked)
    events.push({
      ...base,
      step: "move_link",
      primitive: "link",
      source: input.source,
      target: input.target,
    });
  if (input.alreadyRemoved !== true)
    events.push({
      ...base,
      step: "move_unlink",
      primitive: "unlink",
      source: input.source,
      target: null,
    });
  events.push({
    ...base,
    step: "journal_complete",
    primitive: "journal_complete",
    source: null,
    target: null,
    completionPaths: [input.source, input.target],
  });
  return {
    entry,
    descriptor: {
      stepId: input.operationId,
      entryOperationId: entry.operationId,
      kind: input.subtitleId === null ? "rollback_video" : "restore_sidecar",
      operationId: input.operationId,
      assetId: input.assetId,
      subtitleId: input.subtitleId,
      libraryKind: entry.libraryKind,
      sourcePath: storedFilePath(
        context,
        entry.libraryKind,
        input.source.root,
        input.source.path,
      ),
      targetPath: storedFilePath(
        context,
        entry.libraryKind,
        input.target.root,
        input.target.path,
      ),
      checksum: input.checksum,
      previousChecksum: null,
      retainedSuccessorPath:
        input.subtitleId === null
          ? storedFilePath(
              context,
              entry.libraryKind,
              input.target.root,
              input.target.path,
            )
          : null,
    },
    events,
  };
}

export async function executePublicationInverse(
  files: FileOperations,
  action: InverseAction,
): Promise<void> {
  const { entry, descriptor } = action;
  if (descriptor.subtitleId === null) {
    if (entry.previousChecksum === null)
      await files.quarantine({
        operationId: descriptor.operationId,
        quarantineId: entry.assetId,
        libraryPath: entry.libraryPath,
        sha256: entry.checksum,
      });
    else
      await files.rollbackImport({
        operationId: entry.operationId,
        rollbackOperationId: descriptor.operationId,
        libraryPath: entry.libraryPath,
        sha256: entry.checksum,
        previousSha256: entry.previousChecksum,
      });
  } else {
    const sidecar = entry.previousSidecars.find(
      (item) => item.subtitleId === descriptor.subtitleId,
    );
    if (sidecar === undefined)
      throw new Error("Inverse sidecar missing from original plan");
    await files.restore({
      operationId: descriptor.operationId,
      quarantineId: sidecar.quarantineId,
      libraryPath: sidecar.libraryPath,
      sha256: sidecar.checksum,
    });
  }
}
