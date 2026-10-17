import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type {
  HandoffScope,
  HandoffFileEvidenceSchema,
  HandoffNetworkEvidenceSchema,
} from "#shared/handoff.ts";
import { queueOperation } from "#automation/store.ts";
import { invalidateRetention } from "#infrastructure/action-guards.ts";
import { BundleReportSchema } from "#shared/migration-handoff.ts";
import { adoptSubtitles } from "./subtitles.ts";

type Network = z.infer<typeof HandoffNetworkEvidenceSchema>;
type Files = z.infer<typeof HandoffFileEvidenceSchema>;

export async function adoptHandoffRecords(
  tx: Prisma.TransactionClient,
  input: {
    planId: string;
    scope: HandoffScope;
    files: Files;
    network: Network;
    report: unknown;
  },
) {
  await adoptMedia(tx, input);
  await adoptFiles(tx, input.scope, input.files);
  const plan = await tx.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  await adoptSubtitles(tx, {
    scope: input.scope,
    planId: input.planId,
    actorId: plan.actorId,
    evidence: input.files.files.flatMap((file) => file.subtitles),
  });
  await adoptClaims(tx, input.scope, input.planId);
  await recordProtectedTorrents(tx, input.scope, input.report);
}

async function adoptMedia(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof adoptHandoffRecords>[1],
) {
  const { scope, network, planId } = input;
  const epoch = scope.request.recoveryEpoch;
  for (const selected of scope.media) {
    const intent = await tx.mediaIntent.upsert({
      where: { mediaId: selected.mediaId },
      create: {
        mediaId: selected.mediaId,
        profileId: selected.profileId,
        automationEpoch: epoch,
        generation: 1,
        desiredPresence: true,
        monitoring: selected.monitored,
      },
      update: {
        profileId: selected.profileId,
        automationEpoch: epoch,
        generation: { increment: 1 },
        version: { increment: 1 },
        desiredPresence: true,
        monitoring: selected.monitored,
        intentionallyRemovedAt: null,
      },
    });
    const plex = network.plex.find((item) => item.mediaId === selected.mediaId);
    const item = await tx.mediaItem.findUniqueOrThrow({
      where: { id: selected.mediaId },
    });
    const externalIds = z.record(z.string(), z.json()).parse(item.externalIds);
    await tx.mediaItem.update({
      where: { id: selected.mediaId },
      data: {
        version: { increment: 1 },
        ...(plex === undefined
          ? {}
          : {
              availability: "available",
              externalIds: {
                ...externalIds,
                plexRatingKey: plex.ratingKey,
                plexSectionId: plex.sectionId,
              },
            }),
      },
    });
    await invalidateRetention(tx, selected.mediaId);
    // Physical proof cannot reconstruct post-backup requests/Keep, nor silently import omitted claims.
    if (scope.files.some((file) => file.mediaIds.includes(selected.mediaId)))
      await tx.recoveryHold.upsert({
        where: { mediaId: selected.mediaId },
        create: {
          mediaId: selected.mediaId,
          recoveryEpoch: epoch,
          reason:
            scope.request.purpose === "recovery"
              ? "recovery_request_history_unconfirmed"
              : "migration_household_intent_review_required",
        },
        update: {
          recoveryEpoch: epoch,
          version: { increment: 1 },
          releasedAt: null,
          releasedById: null,
          releaseEvidence: Prisma.DbNull,
        },
      });
    await tx.applicationEvent.create({
      data: {
        mediaId: selected.mediaId,
        kind: "handoff_media_adopted",
        payload: {
          planId,
          generation: intent.generation,
          recoveryEpoch: epoch,
        },
      },
    });
  }
}

async function adoptFiles(
  tx: Prisma.TransactionClient,
  scope: HandoffScope,
  files: Files,
) {
  const epoch = scope.request.recoveryEpoch;
  for (const file of scope.files) {
    const evidence = files.files.find((item) => item.assetId === file.assetId);
    if (evidence === undefined)
      throw new Error("Handoff file evidence incomplete");
    const coverage = await tx.assetCoverage.findMany({
      where: { mediaId: { in: file.mediaIds }, current: true },
    });
    if (coverage.some((item) => item.assetId !== file.existingAssetId))
      throw new Error("Handoff overlaps another current asset");
    await assertExistingCoverage(tx, file);
    const data = {
      sourcePath: file.sourcePath,
      owned: true,
      ownershipEpoch: epoch,
      checksum: evidence.checksum,
      sizeBytes: BigInt(evidence.sizeBytes),
      properties: {
        ...z.record(z.string(), z.json()).parse(evidence.properties),
        handoffSidecarsUnresolved: evidence.unmanagedSidecars.some(
          (item) =>
            !evidence.subtitles.some(
              (subtitle) => subtitle.canonicalPath === item.canonicalPath,
            ),
        ),
        unmanagedSidecars: evidence.unmanagedSidecars.filter(
          (item) =>
            !evidence.subtitles.some(
              (subtitle) => subtitle.canonicalPath === item.canonicalPath,
            ),
        ),
      },
      state: "published",
      plexPublishedAt: new Date(),
    };
    if (file.existingAssetId === null)
      await tx.libraryAsset.create({
        data: {
          id: file.assetId,
          path: file.canonicalPath,
          ...data,
          coverage: {
            create: file.mediaIds.map((mediaId) => ({
              mediaId,
              current: true,
            })),
          },
        },
      });
    else {
      const updated = await tx.libraryAsset.updateMany({
        where: {
          id: file.existingAssetId,
          path: file.canonicalPath,
          version: file.existingAssetVersion ?? -1,
          state: "published",
        },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new Error("Handoff existing asset changed");
    }
  }
}

async function assertExistingCoverage(
  tx: Prisma.TransactionClient,
  file: HandoffScope["files"][number],
) {
  if (file.existingAssetId === null) return;
  const existing = await tx.assetCoverage.findMany({
    where: { assetId: file.existingAssetId, current: true },
  });
  if (
    existing.length !== file.mediaIds.length ||
    existing.some((item) => !file.mediaIds.includes(item.mediaId))
  )
    throw new Error("Handoff current shared coverage changed");
}

async function adoptClaims(
  tx: Prisma.TransactionClient,
  scope: HandoffScope,
  planId: string,
) {
  for (const claim of scope.claims) {
    const existing = await tx.mediaRequest.findUnique({
      where: {
        userId_mediaId: { userId: claim.userId, mediaId: claim.mediaId },
      },
    });
    const languages = [
      ...new Set([
        ...(existing?.subtitleLanguages ?? []),
        ...claim.subtitleLanguages,
      ]),
    ];
    const request = await tx.mediaRequest.upsert({
      where: {
        userId_mediaId: { userId: claim.userId, mediaId: claim.mediaId },
      },
      create: {
        userId: claim.userId,
        mediaId: claim.mediaId,
        subtitleLanguages: languages,
        includeFutureEpisodes: claim.includeFutureEpisodes,
      },
      update: {
        active: true,
        direct: true,
        excluded: false,
        subtitleLanguages: languages,
        includeFutureEpisodes: claim.includeFutureEpisodes,
        version: { increment: 1 },
        coverageCompletedAt: null,
      },
    });
    if (claim.includeFutureEpisodes)
      await queueOperation(tx, {
        key: `handoff-coverage:${planId}:${request.id}`,
        kind: "expand_request",
        targetId: claim.mediaId,
        userId: claim.userId,
        payload: {
          requestId: request.id,
          requestVersion: request.version,
          cursor: null,
        },
      });
  }
}

async function recordProtectedTorrents(
  tx: Prisma.TransactionClient,
  scope: HandoffScope,
  raw: unknown,
) {
  const report = BundleReportSchema.parse(raw);
  for (const selection of scope.protected.filter(
    (item) => item.reason === "protected_legacy_source",
  )) {
    const source = report.entries.find(
      (item) => item.provenanceKey === selection.provenanceKey,
    )?.sourceRecord;
    if (source?.kind !== "torrent")
      throw new Error("Handoff torrent provenance missing");
    await tx.torrent.upsert({
      where: { infoHash: source.infoHash },
      create: {
        infoHash: source.infoHash,
        qbittorrentId: source.wireId,
        providerId: "migration",
        owned: false,
        ownershipEpoch: -1,
        seedingPolicy: { kind: "unknown" },
        observation: source,
        state: "migration_protected",
      },
      update: {},
    });
  }
}
