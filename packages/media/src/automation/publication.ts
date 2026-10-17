import { z } from "zod";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { PlexItem } from "#integrations/plex.ts";
import type { MediaAutomationContext } from "./context.ts";
import { queueOperation, serializable } from "./store.ts";
import type { MediaItem } from "#generated/prisma/client.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { requireActiveRuntime } from "./runtime.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { queueCurrentSubtitleTargets } from "./subtitles/queue.ts";
import { recordVerifiedPublication } from "./reconciliation/upgrade-cleanup.ts";
import { publishRollback } from "./reconciliation/rollback-publication.ts";
import { queuePublicationNotifications } from "./notifications/events.ts";
import { queueSharedPublication } from "./notifications/shared.ts";

type PublicationActivities = Pick<
  MediaNetworkActivities,
  | "publishMediaToPlex"
  | "publishRolledBackMedia"
  | "publishRestoredMedia"
  | "finalizeMediaAcquisition"
>;

const ScanCheckpointSchema = z.object({
  plexScan: z
    .object({
      sectionId: z.string(),
      scope: z.string().optional(),
      offset: z.number().int().nonnegative(),
      matches: z.array(z.object({ path: z.string(), ratingKey: z.string() })),
    })
    .optional(),
});
const ExternalIdsSchema = z.record(z.string(), z.json());
async function findPublished(
  context: MediaAutomationContext,
  input: {
    sectionId: string;
    kind: "movie" | "episode";
    paths: ReadonlySet<string>;
    operationId: string;
    scope: string;
  },
): Promise<Map<string, PlexItem[]>> {
  const { sectionId, kind, paths, operationId } = input;
  const found = new Map<string, PlexItem[]>();
  const operation = await context.db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const stored = ScanCheckpointSchema.parse(operation.result ?? {}).plexScan;
  const checkpoint = stored?.scope === input.scope ? stored : undefined;
  let offset = checkpoint?.sectionId === sectionId ? checkpoint.offset : 0;
  for (const match of checkpoint?.matches ?? [])
    collectPaths(found, await context.plex.metadata(match.ratingKey), paths);
  for (let page = 0; page < 20; page++) {
    const result = await context.plex.libraryPage({
      sectionId,
      kind,
      offset,
      limit: 200,
    });
    for (const item of result.items) collectPaths(found, item, paths);
    offset += result.items.length;
    if (offset >= result.total) {
      offset = 0;
      break;
    }
  }
  const matches = [...found].flatMap(([path, items]) =>
    items.map((item) => ({ path, ratingKey: item.ratingKey })),
  );
  await context.db
    .$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ plexScan: { sectionId, scope: input.scope, offset, matches } })}::jsonb, "updatedAt" = NOW() WHERE id = ${operationId}`;
  return found;
}

function collectPaths(
  found: Map<string, PlexItem[]>,
  item: PlexItem,
  paths: ReadonlySet<string>,
): void {
  for (const part of item.Media?.flatMap((media) => media.Part) ?? []) {
    if (!paths.has(part.file)) continue;
    const items = found.get(part.file) ?? [];
    if (!items.some((existing) => existing.ratingKey === item.ratingKey))
      items.push(item);
    found.set(part.file, items);
  }
}

async function matchesIdentity(
  context: MediaAutomationContext,
  media: MediaItem,
  item: PlexItem,
): Promise<boolean> {
  const external = z
    .object({
      imdb: z.string().nullable().optional(),
      seriesTmdb: z.number().optional(),
    })
    .parse(media.externalIds);
  const metadata =
    media.kind === "episode" && item.grandparentRatingKey !== undefined
      ? await context.plex.metadata(item.grandparentRatingKey)
      : await context.plex.metadata(item.ratingKey);
  const identifiers = new Set(metadata.Guid?.map((guid) => guid.id));
  return media.kind === "episode"
    ? external.seriesTmdb !== undefined &&
        identifiers.has(`tmdb://${String(external.seriesTmdb)}`) &&
        item.index === media.episodeNumber &&
        item.parentIndex === media.seasonNumber
    : (media.tmdbId !== null &&
        identifiers.has(`tmdb://${String(media.tmdbId)}`)) ||
        (external.imdb != null && identifiers.has(`imdb://${external.imdb}`));
}

export function createPublicationActivities(
  context: MediaAutomationContext,
): PublicationActivities {
  return {
    publishRolledBackMedia: async (input) =>
      publishRollback(context, input, (mediaIds, proof) =>
        publishCoverage(context, mediaIds, input.operationId, proof),
      ),
    async publishRestoredMedia(input) {
      const intent = await context.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId: input.mediaId },
      });
      if (intent.generation !== input.generation)
        return { status: "blocked", reason: "intent_changed" };
      const operation = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      const receipt = RestoreReceiptSchema.parse(
        operation.result,
      ).restoreReceipt;
      if (!receipt.mediaIds.includes(input.mediaId))
        throw new Error("Restore receipt does not cover requested media");
      const decision = await context.db.retentionDecision.findUniqueOrThrow({
        where: { id: receipt.decisionId },
      });
      const runtime = await requireActiveRuntime(context.db);
      return decision.state !== "restored" ||
        !runtime.active ||
        runtime.epoch !== receipt.recoveryEpoch
        ? { status: "blocked", reason: "restore_evidence_obsolete" }
        : publishCoverage(context, receipt.mediaIds, input.operationId, {
            epoch: receipt.recoveryEpoch,
            receipt,
          });
    },
    async publishMediaToPlex(input) {
      const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      return publishCoverage(context, attempt.mediaIds, input.operationId, {
        epoch: attempt.recoveryEpoch,
        notificationAttemptId: attempt.id,
        requiredGenerations: z
          .record(z.string(), z.number().int().nonnegative())
          .parse(attempt.generations),
      });
    },
    async finalizeMediaAcquisition(input) {
      await finalize(context, input.attemptId);
    },
  };
}

const RestoreReceiptSchema = z.object({
  restoreReceipt: z.object({
    decisionId: z.string(),
    mediaIds: z.array(z.string()).min(1),
    recoveryEpoch: z.number().int(),
    assets: z
      .array(
        z.object({
          assetId: z.string(),
          assetVersion: z.number().int(),
          checksum: z.string(),
        }),
      )
      .min(1),
  }),
});

async function publishCoverage(
  context: MediaAutomationContext,
  mediaIds: string[],
  operationId: string,
  proof: {
    epoch: number;
    notificationAttemptId?: string;
    receipt?: Pick<
      z.infer<typeof RestoreReceiptSchema>["restoreReceipt"],
      "mediaIds" | "assets"
    >;
    requiredGenerations?: Readonly<Record<string, number>>;
    releaseAttemptId?: string;
  },
): ReturnType<PublicationActivities["publishMediaToPlex"]> {
  const runtime = await requireActiveRuntime(context.db);
  if (!runtime.active) return { status: "blocked", reason: "runtime_observe" };
  if (runtime.epoch !== proof.epoch)
    return { status: "blocked", reason: "recovery_epoch_changed" };
  const { receipt } = proof;
  const coverages = await context.db.assetCoverage.findMany({
    where: { mediaId: { in: mediaIds }, current: true },
    include: { asset: true, media: { include: { intent: true } } },
  });
  if (coverages.length === 0)
    return { status: "blocked", reason: "published_asset_missing" };
  if (
    !(await recordsAuthorized(context.db, {
      epoch: runtime.epoch,
      mediaIds,
      assetIds: coverages.map((item) => item.assetId),
    }))
  )
    return { status: "blocked", reason: "record_ownership_unconfirmed" };
  if (
    proof.requiredGenerations !== undefined &&
    coverages.some(
      (coverage) =>
        coverage.media.intent?.desiredPresence !== true ||
        coverage.media.intent.generation !==
          proof.requiredGenerations?.[coverage.mediaId],
    )
  )
    return { status: "blocked", reason: "rollback_intent_changed" };
  if (
    receipt !== undefined &&
    (coverages.length !== receipt.mediaIds.length ||
      coverages.some(
        (coverage) =>
          !receipt.assets.some(
            (asset) =>
              asset.assetId === coverage.assetId &&
              asset.assetVersion === coverage.asset.version &&
              asset.checksum === coverage.asset.checksum,
          ),
      ))
  )
    return { status: "blocked", reason: "restore_evidence_obsolete" };
  const kind = coverages[0]?.media.kind === "movie" ? "movie" : "episode";
  const allSections = await context.plex.sections();
  const permitted = await context.permittedSections();
  const sections = allSections.filter(
    (section) =>
      section.type === (kind === "movie" ? "movie" : "show") &&
      section.key === (kind === "movie" ? permitted.movie : permitted.series),
  );
  const section = sections[0];
  if (section === undefined || sections.length !== 1)
    return { status: "blocked", reason: "plex_section_ambiguous" };
  await context.plex.refresh(section.key);
  const items = await findPublished(context, {
    sectionId: section.key,
    kind,
    paths: new Set(coverages.map((coverage) => coverage.asset.path)),
    operationId,
    scope:
      proof.releaseAttemptId === undefined
        ? "publication"
        : `rollback:${proof.releaseAttemptId}`,
  });
  if (
    items.size !==
    new Set(coverages.map((coverage) => coverage.asset.path)).size
  )
    return { status: "waiting", reason: "plex_scan_pending" };
  const verified: {
    mediaId: string;
    assetId: string;
    ratingKey: string;
    externalIds: z.infer<typeof ExternalIdsSchema>;
  }[] = [];
  for (const coverage of coverages) {
    const item = await matchedItem(
      context,
      coverage.media,
      items.get(coverage.asset.path) ?? [],
    );
    if (item === undefined)
      return { status: "blocked", reason: "plex_identity_mismatch" };
    const externalIds = ExternalIdsSchema.parse(coverage.media.externalIds);
    verified.push({
      mediaId: coverage.mediaId,
      assetId: coverage.assetId,
      ratingKey: item.ratingKey,
      externalIds,
    });
  }
  await serializable(context.db, async (tx) => {
    await lockMedia(tx, mediaIds);
    if (
      !(await lockRuntimeAuthority(tx, runtime.epoch)) ||
      !(await recordsAuthorized(tx, {
        epoch: runtime.epoch,
        mediaIds,
        assetIds: coverages.map((item) => item.assetId),
      }))
    )
      throw new Error("Publication ownership authority changed");
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
    const currentRuntime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      currentRuntime.mode !== "active" ||
      !currentRuntime.ownershipConfirmed ||
      currentRuntime.recoveryEpoch !== runtime.epoch
    )
      throw new Error("Publication recovery epoch changed");
    for (const snapshot of coverages) {
      const current = await tx.assetCoverage.findUniqueOrThrow({
        where: {
          assetId_mediaId: {
            assetId: snapshot.assetId,
            mediaId: snapshot.mediaId,
          },
        },
        include: { asset: true, media: { include: { intent: true } } },
      });
      if (
        !current.current ||
        current.asset.state !== "published" ||
        current.asset.version !== snapshot.asset.version ||
        current.asset.checksum !== snapshot.asset.checksum ||
        current.media.intent?.generation !== snapshot.media.intent?.generation
      )
        throw new Error("Publication evidence changed before commit");
    }
    for (const entry of verified) {
      const stillCurrent = await tx.assetCoverage.findUniqueOrThrow({
        where: {
          assetId_mediaId: { assetId: entry.assetId, mediaId: entry.mediaId },
        },
      });
      if (!stillCurrent.current)
        throw new Error("Publication asset changed during Plex verification");
      await tx.mediaItem.update({
        where: { id: entry.mediaId },
        data: {
          externalIds: {
            ...entry.externalIds,
            plexRatingKey: entry.ratingKey,
            plexSectionId: section.key,
          },
          availability: "available",
        },
      });
    }
    await recordVerifiedPublication(
      tx,
      verified.map((entry) => entry.assetId),
      runtime.epoch,
    );
    if (proof.notificationAttemptId !== undefined) {
      await queuePublicationNotifications(tx, proof.notificationAttemptId);
      const shared = await context.sharedAnnouncements?.();
      if (shared !== undefined)
        await queueSharedPublication(tx, proof.notificationAttemptId, shared);
    }
    if (proof.releaseAttemptId !== undefined)
      await tx.acquisitionReservation.deleteMany({
        where: { attemptId: proof.releaseAttemptId },
      });
  });
  return { status: "available", reason: null };
}

async function matchedItem(
  context: MediaAutomationContext,
  media: MediaItem,
  candidates: PlexItem[],
): Promise<PlexItem | undefined> {
  for (const candidate of candidates) {
    if (
      candidate.type === media.kind &&
      (await matchesIdentity(context, media, candidate))
    )
      return candidate;
  }
  return undefined;
}

async function finalize(
  context: MediaAutomationContext,
  attemptId: string,
): Promise<void> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  await serializable(context.db, async (tx) => {
    await lockMedia(tx, attempt.mediaIds);
    if (
      !(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)) ||
      !(await recordsAuthorized(tx, {
        epoch: attempt.recoveryEpoch,
        mediaIds: attempt.mediaIds,
      }))
    )
      throw new Error("Finalization ownership authority changed");
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed ||
      runtime.recoveryEpoch !== attempt.recoveryEpoch
    )
      throw new Error("Finalization recovery epoch changed");
    const media = await tx.mediaItem.findMany({
      where: { id: { in: attempt.mediaIds } },
    });
    if (media.some((item) => item.availability !== "available"))
      throw new Error("Cannot finalize media not verified in Plex");
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: attempt.id },
    });
    if (attempt.torrentId !== null)
      await queueOperation(tx, {
        key: `seed:${attempt.torrentId}`,
        kind: "maintain_torrent",
        targetId: attempt.torrentId,
        payload: { torrentId: attempt.torrentId },
      });
    const coverages = await tx.assetCoverage.findMany({
      where: { mediaId: { in: attempt.mediaIds }, current: true },
    });
    for (const assetId of new Set(coverages.map((item) => item.assetId)))
      await queueCurrentSubtitleTargets(tx, {
        assetId,
        epoch: attempt.recoveryEpoch,
      });
  });
}
