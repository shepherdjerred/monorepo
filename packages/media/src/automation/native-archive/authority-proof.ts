import path from "node:path";
import type { ContentProof } from "#filesystem/content-proof.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import type { NativeArchiveScope } from "#shared/native-recovery/archive.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";
import { archiveAuthorityParticipants } from "#infrastructure/native-archive/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { ArchiveFileContext } from "./execution.ts";
import {
  prepareSubtitleLineage,
  publicationSubtitleEvidence,
} from "#automation/publication-proof/subtitle-lineage.ts";

export function authorityParticipantPath(
  participant: PublicationParticipant,
): string {
  const root = `/data/${participant.libraryKind}${participant.physical.root === "control" ? "/.media-control" : ""}`;
  const name = path.posix.join(root, participant.physical.path);
  if (
    !name.startsWith(root + "/") ||
    path.posix.relative(root, name) !== participant.physical.path
  )
    throw new FileOperationConflict(
      "Archive authority participant escapes its exact root",
    );
  return name;
}

export async function captureArchiveAuthority(
  context: ArchiveFileContext,
  scope: NativeArchiveScope,
  content: ContentProof,
  budget: PublicationAuthorityReadBudget,
) {
  const participants: PublicationParticipant[] = [];
  const subtitleLineages = [];
  for (const file of scope.files) {
    if (
      file.authority.kind === "rebaseline" ||
      (file.authority.kind === "prior_native_binding" &&
        file.authority.subtitleLineage === undefined)
    )
      continue;
    const values = await archiveAuthorityParticipants(
      context.files.db,
      file.authority,
      budget,
    );
    if (
      !values.some(
        (item) =>
          item.assetId === file.assetId &&
          item.subtitleId === null &&
          item.physical.state === "present" &&
          authorityParticipantPath(item) === file.canonicalPath &&
          item.physical.sha256 === file.checksum,
      )
    )
      throw new FileOperationConflict(
        "Archive adjacent authority lacks its exact serving or retained video",
      );
    participants.push(...values);
    if (file.authority.subtitleLineage !== undefined)
      subtitleLineages.push({
        assetId: file.assetId,
        prepared: await prepareSubtitleLineage(
          context.files,
          file.libraryKind,
          file.authority.subtitleLineage,
        ),
      });
  }
  const paths = [
    ...new Set([
      ...participants.map((participant) =>
        authorityParticipantPath(participant),
      ),
      ...subtitleLineages.flatMap((item) =>
        item.prepared.references.map(
          (reference) =>
            `/data/${reference.libraryKind}/${reference.root === "control" ? ".media-control/" : ""}${reference.path}`,
        ),
      ),
    ]),
  ].sort();
  for (const name of paths)
    await content.capture(nativeLocalPath(context, name), () =>
      context.files.checkpoint("archive-adjacent-authority-hashing"),
    );
  return { participants, paths, budget, subtitleLineages };
}

export async function archiveSubtitleAuthorityEvidence(
  context: ArchiveFileContext,
  content: ContentProof,
  authority: Awaited<ReturnType<typeof captureArchiveAuthority>>,
) {
  const result = [];
  for (const item of authority.subtitleLineages)
    result.push({
      assetId: item.assetId,
      evidence: await publicationSubtitleEvidence(
        context.files,
        content,
        item.prepared,
      ),
    });
  return result;
}

export async function assertArchiveAuthorityProof(
  context: ArchiveFileContext,
  content: ContentProof,
  participants: readonly PublicationParticipant[],
) {
  for (const item of participants) {
    const local = nativeLocalPath(context, authorityParticipantPath(item));
    const physical = item.physical;
    if (physical.state === "absent") {
      if (
        snapshotHash(await content.reviewAbsence(local)) !==
        snapshotHash({ ancestors: physical.ancestors })
      )
        throw new FileOperationConflict(
          "Archive adjacent absence identity changed",
        );
    } else {
      const file = await content.verifiedFile(local);
      if (
        file.sha256 !== physical.sha256 ||
        file.sizeBytes !== physical.sizeBytes ||
        snapshotHash(nativeJson(await content.reviewIdentity(local))) !==
          snapshotHash(nativeJson(physical.identity))
      )
        throw new FileOperationConflict(
          "Archive adjacent physical identity changed",
        );
    }
  }
}
