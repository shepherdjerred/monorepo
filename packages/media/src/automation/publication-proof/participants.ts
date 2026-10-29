import path from "node:path";
import type { FileContext, FilePlanEntry } from "#automation/files/types.ts";
import type { ContentReference } from "#automation/files/content-proof.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";
import { PhysicalPathStateSchema } from "#shared/publication-proof/effects.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { safePath } from "#filesystem/operations-io.ts";

export type ParticipantPath = Omit<PublicationParticipant, "physical"> & {
  root: "library" | "control";
  path: string;
};

/** The complete ordinary plan, not a native review's smaller asset limit. */
export function publicationParticipants(
  entry: FilePlanEntry,
  published = false,
): ParticipantPath[] {
  const result: ParticipantPath[] = [];
  const add = (
    identity: { assetId: string; subtitleId: string | null },
    role: ParticipantPath["role"],
    root: ParticipantPath["root"],
    relative: string,
  ) => {
    result.push({
      ...identity,
      libraryKind: entry.libraryKind,
      role,
      root,
      path: relative,
    });
  };
  add(
    {
      assetId: published
        ? entry.assetId
        : (entry.previousAssetId ?? entry.assetId),
      subtitleId: null,
    },
    "video",
    "library",
    entry.libraryPath,
  );
  add(
    { assetId: entry.assetId, subtitleId: null },
    "staging",
    "control",
    `staging/${entry.operationId}`,
  );
  add(
    { assetId: entry.previousAssetId ?? entry.assetId, subtitleId: null },
    "rollback",
    "control",
    `rollback/${entry.operationId}`,
  );
  add(
    { assetId: entry.assetId, subtitleId: null },
    "quarantine",
    "control",
    `quarantine/${entry.assetId}`,
  );
  add(
    { assetId: entry.assetId, subtitleId: null },
    "rollback",
    "control",
    `rollback/recover-${entry.assetId}`,
  );
  add(
    { assetId: entry.previousAssetId ?? entry.assetId, subtitleId: null },
    "staging",
    "control",
    `staging/recover-${entry.assetId}`,
  );
  for (const sidecar of entry.previousSidecars) {
    if (entry.previousAssetId === null)
      throw new Error("Initial publication has predecessor sidecars");
    add(
      { assetId: entry.previousAssetId, subtitleId: sidecar.subtitleId },
      "sidecar",
      "library",
      sidecar.libraryPath,
    );
    add(
      { assetId: entry.previousAssetId, subtitleId: sidecar.subtitleId },
      "quarantine",
      "control",
      `quarantine/${sidecar.quarantineId}`,
    );
  }
  for (const subtitle of entry.embeddedSubtitles)
    add(
      { assetId: entry.assetId, subtitleId: subtitle.id },
      "extracted",
      "control",
      subtitle.relativePath,
    );
  return result;
}

export function publicationReferences(
  plan: readonly FilePlanEntry[],
): ContentReference[] {
  const references = new Map<string, ContentReference>();
  for (const entry of plan)
    for (const item of publicationParticipants(entry)) {
      const ref = {
        libraryKind: item.libraryKind,
        root: item.root,
        path: item.path,
      };
      const key = JSON.stringify(ref);
      references.set(key, ref);
    }
  return [...references.values()];
}

export async function observePublicationParticipants(
  context: FileContext,
  entry: FilePlanEntry,
  published = false,
): Promise<PublicationParticipant[]> {
  const proof = context.contentProof;
  if (proof === undefined)
    throw new FileOperationConflict(
      "Publication requires a process-local content proof",
    );
  const result: PublicationParticipant[] = [];
  for (const item of publicationParticipants(entry, published)) {
    const roots = context.roots[item.libraryKind];
    const filename = await safePath(roots[item.root], item.path, false);
    if (filename !== path.join(roots[item.root], item.path))
      throw new FileOperationConflict("Publication participant path changed");
    const checksum = await proof.digest(filename);
    const physical = await observePhysical(context, item, filename, checksum);
    result.push({
      assetId: item.assetId,
      subtitleId: item.subtitleId,
      libraryKind: item.libraryKind,
      role: item.role,
      physical,
    });
  }
  return result;
}

async function observePhysical(
  context: FileContext,
  item: ParticipantPath,
  filename: string,
  checksum: string | null,
) {
  const proof = context.contentProof;
  if (proof === undefined)
    throw new FileOperationConflict("Publication proof disappeared");
  if (checksum === null)
    return PhysicalPathStateSchema.parse({
      root: item.root,
      path: item.path,
      state: "absent",
      ...(await proof.reviewAbsence(filename)),
    });
  const verified = await proof.verifiedFile(filename);
  return PhysicalPathStateSchema.parse({
    root: item.root,
    path: item.path,
    state: "present",
    sha256: checksum,
    sizeBytes: verified.sizeBytes,
    identity: await proof.reviewIdentity(filename),
  });
}
