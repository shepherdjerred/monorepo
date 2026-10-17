import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type {
  Prisma,
  SubtitleAsset,
  LibraryAsset,
} from "#generated/prisma/client.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { snapshotNativeSubtitles } from "#automation/native-subtitles/snapshot.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  SubtitleReplacementSnapshotSchema,
  ReplacementSubtitleSchema,
} from "#shared/subtitle-replacement.ts";
import { replacementCandidateBytes } from "./candidate.ts";

export function replacementSubtitleSnapshot(subtitle: SubtitleAsset) {
  return ReplacementSubtitleSchema.strip().parse({
    ...subtitle,
    contentChecksum:
      subtitle.content === null
        ? null
        : createHash("sha256").update(subtitle.content).digest("hex"),
  });
}

/** Caller holds media, request, runtime, policy and asset/subtitle locks. No filesystem effects. */
export async function captureReplacementSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    assetId: string;
    oldSubtitleId: string;
    candidateSubtitleId: string;
    epoch: number;
  },
) {
  const work = await currentSubtitleWork(tx, input.assetId, input.epoch);
  const { asset } = work;
  const old = asset.subtitles.find((item) => item.id === input.oldSubtitleId);
  const candidate = asset.subtitles.find(
    (item) => item.id === input.candidateSubtitleId,
  );
  if (old === undefined || candidate === undefined || old.id === candidate.id)
    throw new FileGuardError("subtitle_replacement_participants_missing");
  if (work.protectedReasons.length > 0 || work.targets.length === 0)
    throw new FileGuardError("subtitle_target_changed");
  if (
    await tx.recoveryHold.count({
      where: {
        mediaId: { in: asset.coverage.map((item) => item.mediaId) },
        releasedAt: null,
      },
    })
  )
    throw new FileGuardError("recovery_request_history_unconfirmed");
  assertOwnedOldSubtitle(old, asset, input.epoch);
  if (
    candidate.state !== "validated" ||
    candidate.storageKind !== "sidecar" ||
    candidate.path !== null ||
    !work.targets.some((target) =>
      subtitleAccepted({
        subtitle: candidate,
        asset,
        epoch: input.epoch,
        target,
        allowStaged: true,
      }),
    )
  )
    throw new FileGuardError("subtitle_quality_unaccepted");
  if (
    !z
      .object({ targetAuthority: z.literal(work.authority) })
      .safeParse(candidate.matchingEvidence).success
  )
    throw new FileGuardError("subtitle_target_changed");
  const content = replacementCandidateBytes(candidate);
  const destination = subtitleDestination({
    videoPath: asset.path,
    language: candidate.language,
    forced: candidate.forced,
    hearingImpaired: candidate.hearingImpaired,
    format: content.format,
  });
  if (
    destination !== old.path ||
    path.extname(z.string().parse(old.path)) !== `.${content.format}` ||
    old.checksum === content.checksum
  )
    throw new FileGuardError(
      "subtitle_replacement_requires_distinct_same_path",
    );
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (runtime.recoveryEpoch !== input.epoch)
    throw new FileGuardError("runtime_protected");
  const kinds = new Set(
    asset.coverage.map((item) =>
      item.media.kind === "movie" ? "movies" : "tv",
    ),
  );
  if (kinds.size !== 1) throw new FileGuardError("subtitle_coverage_changed");
  return SubtitleReplacementSnapshotSchema.parse({
    schemaVersion: 1,
    recoveryEpoch: input.epoch,
    runtimeVersion: runtime.version,
    asset: {
      id: asset.id,
      version: asset.version,
      path: asset.path,
      checksum: asset.checksum,
      ownershipEpoch: asset.ownershipEpoch,
      coverage: asset.coverage
        .map((item) => ({
          mediaId: item.mediaId,
          title: item.media.title,
          generation: item.media.intent?.generation,
        }))
        .sort((a, b) => a.mediaId.localeCompare(b.mediaId)),
    },
    old: replacementSubtitleSnapshot(old),
    candidate: replacementSubtitleSnapshot(candidate),
    targetAuthority: work.authority,
    destination,
    libraryKind: [...kinds][0],
    installed: await snapshotNativeSubtitles(tx, asset.id),
  });
}

function assertOwnedOldSubtitle(
  old: SubtitleAsset,
  asset: LibraryAsset,
  epoch: number,
): void {
  if (
    old.state !== "installed" ||
    old.storageKind !== "sidecar" ||
    old.path === null ||
    old.checksum === null ||
    old.ownershipEpoch !== epoch ||
    old.videoChecksum !== asset.checksum ||
    old.videoVersion !== asset.version
  )
    throw new FileGuardError("subtitle_ownership_unconfirmed");
}
