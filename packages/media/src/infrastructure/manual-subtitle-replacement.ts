import { createHash } from "node:crypto";
import type {
  Prisma,
  SubtitleAsset,
  LibraryAsset,
} from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { ManualSubtitle } from "#shared/admin.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import {
  lockSubtitleAsset,
  type parseManualSubtitle,
} from "./manual-subtitle.ts";
import { lockEffectiveRequests } from "./request-claims.ts";
import { lockRuntimeAuthority } from "./handoff/authority.ts";
import { lockSubtitlePolicies } from "./subtitle-policy.ts";
import { assertNoSubtitleReplacement } from "./subtitle-replacement/locks.ts";
import { FileGuardError } from "#automation/files/types.ts";

/** Validated bytes only: explicit replacement candidates never enqueue ordinary installation. */
export async function createManualReplacementCandidate(
  tx: Prisma.TransactionClient,
  args: {
    actor: MediaActor;
    input: ManualSubtitle;
    validated: ReturnType<typeof parseManualSubtitle>;
  },
) {
  const { actor, input, validated } = args;
  const replacement = input.replacementFor;
  if (replacement === undefined) throw new Error("Missing replacement target");
  const asset = await lockSubtitleAsset(tx, input);
  const ids = asset.coverage.map((row) => row.mediaId);
  await lockEffectiveRequests(tx, ids);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (!(await lockRuntimeAuthority(tx, runtime.recoveryEpoch)))
    throw new MediaError(
      "replacement_runtime_protected",
      "Subtitle replacement needs current library authority",
      409,
    );
  await lockSubtitlePolicies(tx);
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${asset.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE id=${replacement.oldSubtitleId} FOR UPDATE`;
  try {
    await assertNoSubtitleReplacement(tx, [asset.id]);
  } catch (error) {
    if (!(error instanceof FileGuardError)) throw error;
    throw new MediaError(
      error.message,
      "Reconcile the existing subtitle replacement first",
      409,
    );
  }
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${actor.id} FOR SHARE`;
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actor.id },
  });
  if (owner.role !== "owner" || owner.restricted)
    throw new MediaError(
      "forbidden",
      "An unrestricted owner must review subtitle replacement",
      403,
    );
  const old = await tx.subtitleAsset.findUniqueOrThrow({
    where: { id: replacement.oldSubtitleId },
  });
  assertInstalledTarget({
    old,
    asset,
    expectedVersion: replacement.expectedOldVersion,
    epoch: runtime.recoveryEpoch,
  });
  const destination = subtitleDestination({
    videoPath: asset.path,
    language: input.language,
    forced: input.forced ?? false,
    hearingImpaired: input.hearingImpaired ?? null,
    format: validated.format,
  });
  if (destination !== old.path)
    throw new MediaError(
      "replacement_path_changed",
      "Replacement must preserve the exact subtitle destination and format",
      409,
    );
  const checksum = createHash("sha256").update(validated.text).digest("hex");
  if (checksum === old.checksum)
    throw new MediaError(
      "replacement_same_bytes",
      "These subtitle bytes already exist; no replacement is needed",
      409,
    );
  const work = await currentSubtitleWork(tx, asset.id, runtime.recoveryEpoch);
  if (work.protectedReasons.length > 0)
    throw new MediaError(
      "replacement_target_protected",
      "Current subtitle policy or media authority requires reconciliation",
      409,
    );
  const intents = await tx.mediaIntent.findMany({
    where: { mediaId: { in: ids }, edition: "default" },
    orderBy: { mediaId: "asc" },
  });
  const candidate = await tx.subtitleAsset.create({
    data: {
      assetId: asset.id,
      language: input.language,
      providerId: "manual",
      state: "validated",
      qualityStatus: "accepted",
      storageKind: "sidecar",
      ownershipEpoch: runtime.recoveryEpoch,
      checksum,
      videoChecksum: asset.checksum,
      videoVersion: asset.version,
      forced: input.forced ?? false,
      hearingImpaired: input.hearingImpaired ?? null,
      content: new TextEncoder().encode(validated.text),
      provenance: {
        filename: input.filename,
        description: input.description,
        format: validated.format,
        uploadedBy: actor.id,
        simplifiedEvidence: validated.simplifiedEvidence,
        traditionalEvidence: validated.traditionalEvidence,
      },
      matchingEvidence: {
        assetVersion: asset.version,
        assetChecksum: asset.checksum,
        exactMediaMatch: true,
        videoVersionMatch: true,
        ownerConfirmed: true,
        targetAuthority: work.authority,
        recoveryEpoch: runtime.recoveryEpoch,
        generations: Object.fromEntries(
          intents.map((intent) => [intent.mediaId, intent.generation]),
        ),
        replacementFor: {
          oldSubtitleId: old.id,
          expectedOldVersion: old.version,
        },
      },
    },
  });
  if (
    !work.targets.some((target) =>
      subtitleAccepted({
        subtitle: candidate,
        asset: work.asset,
        epoch: runtime.recoveryEpoch,
        target,
        allowStaged: true,
      }),
    )
  )
    throw new MediaError(
      "replacement_target_unrequested",
      "The candidate does not satisfy a current requested subtitle target",
      409,
    );
  await tx.applicationEvent.create({
    data: {
      actorId: actor.id,
      kind: "subtitle_replacement_candidate_uploaded",
      payload: {
        assetId: asset.id,
        subtitleId: candidate.id,
        oldSubtitleId: old.id,
        language: candidate.language,
      },
    },
  });
  return { subtitleId: candidate.id, status: "completed" };
}

function assertInstalledTarget(input: {
  old: SubtitleAsset;
  asset: LibraryAsset;
  expectedVersion: number;
  epoch: number;
}) {
  const { old, asset, expectedVersion, epoch } = input;
  if (
    old.assetId !== asset.id ||
    old.version !== expectedVersion ||
    old.state !== "installed" ||
    old.storageKind !== "sidecar" ||
    old.path === null ||
    old.checksum === null ||
    old.ownershipEpoch !== epoch ||
    old.videoChecksum !== asset.checksum ||
    old.videoVersion !== asset.version
  )
    throw new MediaError(
      "replacement_target_changed",
      "Select a current owned installed sidecar",
      409,
    );
}
