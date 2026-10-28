import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { evaluateRetention } from "#domain/retention.ts";
import { FileGuardError, type RemovalEntry } from "#automation/files/types.ts";
import type { MovieRemovalScope } from "#automation/files/movie-editions/removal-scope.ts";
import type { RetentionPlexAuthority } from "#automation/files/plex-binding/retention.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { readMovieDemandAuthority } from "#infrastructure/movie-editions/fulfillment.ts";
import { readCurrentBoundWatch } from "#infrastructure/plex-binding/watch.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { MovieRetentionWarningV4Schema } from "#shared/movie-editions/retention-v4.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import {
  movieRetentionInclude,
  assertMovieQuarantineState,
  assertMovieQuarantineLegacyClaims,
  movieRetentionAssetVersion,
} from "./quarantine-scope.ts";

/**
 * This capability never leaves the final transaction. Canonical/target/request,
 * runtime/writer, identity, video/coverage/subtitle and watch-fence locks are held
 * by lockRemovalAuthority. These additional locks fence Keep, recovery holds,
 * reservation, warning acceptance/reconciliation and watch rows before one full
 * immutable cut/choice traversal. Callbacks retain its original expiry instead
 * of repeatedly charging the same parents or extending authority.
 */
export async function captureMovieQuarantineAuthorization(
  tx: Prisma.TransactionClient,
  input: {
    movie: MovieRemovalScope;
    decisionId: string;
    entry: RemovalEntry;
    policyTime: Date;
    movieAccess: MovieChoiceAccess;
    plex: RetentionPlexAuthority;
    purge?: boolean;
  },
) {
  const { scope, budget } = input.movie;
  await assertPublicationUnfenced(tx, [scope.mediaId], [input.entry.assetId]);
  await assertNoMediaSubtitleReplacement(tx, [scope.mediaId]);
  await assertMovieQuarantineLegacyClaims(tx, scope.mediaId);
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
  });
  budget.consume(1);
  const evidence = z
    .object({
      authorizedAt: z.iso.datetime(),
      activePlayback: z.literal(false),
      recoveryEpoch: z.int().nonnegative(),
      warningEventId: z.uuid(),
      ownerOverride: z.unknown().optional(),
    })
    .parse(decision.evidence);
  if (evidence.ownerOverride !== undefined)
    throw new FileGuardError("owner_override_not_supported");
  await lockMovieQuarantineFacts(tx, {
    ...scope,
    decisionId: decision.id,
    eventId: evidence.warningEventId,
  });
  const item = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
    include: movieRetentionInclude(scope.edition),
  });
  const target = assertMovieQuarantineState({
    decision,
    scope,
    item,
    generation: input.entry.generations[scope.mediaId],
    epoch: evidence.recoveryEpoch,
    purge: input.purge,
  });
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const age = observed.wall - Date.parse(evidence.authorizedAt);
  if (age < 0 || age > 60_000) throw new FileGuardError("evidence_stale");
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: evidence.warningEventId },
  });
  budget.consume(1);
  const warning = MovieRetentionWarningV4Schema.parse(event.payload);
  if (
    event.kind !== "retention_warning" ||
    event.mediaId !== scope.mediaId ||
    warning.decisionId !== decision.id ||
    warning.generation !== decision.generation ||
    warning.recoveryEpoch !== evidence.recoveryEpoch ||
    identityHash(warning.scope) !== identityHash(scope)
  )
    throw new FileGuardError("warning_unconfirmed");
  const demand = await readMovieDemandAuthority(tx, {
    mediaId: scope.mediaId,
    scope,
    budget,
    access: input.movieAccess,
    currentAsset: {
      assetId: input.entry.assetId,
      assetVersion: movieRetentionAssetVersion(
        input.entry.assetVersion,
        input.purge,
      ),
    },
  });
  if (
    identityHash(demand.demands.map((row) => row.requestId).sort()) !==
    identityHash(item.requests.map((row) => row.id).sort())
  )
    throw new FileGuardError("request_obsolete");
  const requesters = await quarantineRequesterFacts(tx, {
    ...input,
    eventId: event.id,
    item,
    demand,
    timestamp: observed.wall,
  });
  const evaluation = evaluateRetention({
    now: observed.wall,
    policyNow: input.policyTime.getTime(),
    generation: target.generation,
    decisionGeneration: decision.generation,
    owned: true,
    identityConfirmed: true,
    activePlayback: false,
    operationInProgress: false,
    requesters: requesters.values,
    holds: item.holds.map((hold) => ({
      isPin: hold.isPin,
      until: hold.until?.getTime() ?? null,
    })),
  });
  if (evaluation.state !== "quarantine_eligible")
    throw new FileGuardError(
      evaluation.state === "protected"
        ? evaluation.reason
        : "retention_not_due",
    );
  if (
    decision.graceUntil?.getTime() !== evaluation.graceUntil ||
    decision.warningAcceptedAt?.getTime() !==
      evaluation.graceUntil - 7 * 86_400_000
  )
    throw new FileGuardError("warning_unconfirmed");
  assertMoviePurgeElapsed(decision, input);
  const freshness = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(
      Date.parse(evidence.authorizedAt) + 60_000,
      input.plex.freshness.expiresAtMs,
      demand.freshness?.expiresAtMs ?? Infinity,
      ...requesters.deadlines,
    ),
    guards: [
      input.plex.freshness,
      ...(demand.freshness === null ? [] : [demand.freshness]),
    ],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  freshness.assertActive();
  return freshness;
}

function assertMoviePurgeElapsed(
  decision: { quarantinedAt: Date | null; purgeAfter: Date | null },
  input: { purge?: boolean; policyTime: Date },
) {
  if (input.purge !== true) return;
  const quarantinedAt = decision.quarantinedAt?.getTime();
  if (
    quarantinedAt === undefined ||
    quarantinedAt > Date.now() ||
    decision.purgeAfter?.getTime() !== quarantinedAt + 7 * 86_400_000 ||
    input.policyTime.getTime() < quarantinedAt + 7 * 86_400_000
  )
    throw new FileGuardError("quarantine_incomplete");
}

async function quarantineRequesterFacts(
  tx: Prisma.TransactionClient,
  input: {
    movie: MovieRemovalScope;
    plex: RetentionPlexAuthority;
    eventId: string;
    item: Prisma.MediaItemGetPayload<{
      include: ReturnType<typeof movieRetentionInclude>;
    }>;
    demand: Awaited<ReturnType<typeof readMovieDemandAuthority>>;
    timestamp: number;
  },
) {
  const authority = input.plex.byMedia.get(input.movie.scope.mediaId);
  if (authority === undefined)
    throw new FileGuardError("reconciliation_required");
  const deadlines: number[] = [];
  const values = [];
  for (const request of input.item.requests) {
    const fulfillment = input.demand.demands.find(
      (row) => row.requestId === request.id,
    )?.fulfillment;
    if (fulfillment === undefined)
      throw new Error("Movie quarantine omitted request fulfillment");
    if (request.user.role === "owner") {
      values.push({
        userId: request.userId,
        owner: true,
        fulfillment,
        watched: null,
        observedAt: null,
        warningAcceptedAt: null,
        warningFailed: false,
      });
      continue;
    }
    const watch = await readCurrentBoundWatch(
      tx,
      { userId: request.userId, authority },
      input.movie.budget,
    );
    const projection = watch.status === "known" ? watch.projection : null;
    const delivery = await tx.notificationDelivery.findFirst({
      where: {
        eventId: input.eventId,
        userId: request.userId,
        state: "accepted",
        channel: { in: ["email", "discord"] },
        OR: [{ providerStatus: null }, { providerStatus: { not: "bounced" } }],
        acceptedAt: { not: null, lte: new Date(input.timestamp) },
        reconciledAt: {
          gte: new Date(input.timestamp - 60_000),
          lte: new Date(input.timestamp),
        },
      },
      orderBy: { acceptedAt: "asc" },
    });
    if (projection !== null)
      deadlines.push(Date.parse(projection.observedAt) + 900_000);
    if (delivery?.reconciledAt != null)
      deadlines.push(delivery.reconciledAt.getTime() + 60_000);
    values.push({
      userId: request.userId,
      owner: false,
      fulfillment,
      watched: projection?.watched ?? null,
      observedAt:
        projection === null ? null : Date.parse(projection.observedAt),
      warningAcceptedAt: delivery?.acceptedAt?.getTime() ?? null,
      warningFailed: delivery === null,
    });
  }
  return { values, deadlines };
}

async function lockMovieQuarantineFacts(
  tx: Prisma.TransactionClient,
  input: {
    mediaId: string;
    edition: string;
    decisionId: string;
    eventId: string;
  },
) {
  await tx.$queryRaw`SELECT id FROM "RetentionDecision" WHERE id=${input.decisionId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "RetentionHold" WHERE "mediaId"=${input.mediaId} AND edition=${input.edition} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT "mediaId" FROM "RecoveryHold" WHERE "mediaId"=${input.mediaId} AND edition=${input.edition} FOR SHARE`;
  await tx.$queryRaw`SELECT "mediaId" FROM "AcquisitionReservation" WHERE "mediaId"=${input.mediaId} AND edition=${input.edition} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "ApplicationEvent" WHERE id=${input.eventId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE "eventId"=${input.eventId} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "PlexWatchProjection" WHERE "mediaId"=${input.mediaId} AND edition=${input.edition} ORDER BY "userId" FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "WatchState" WHERE "mediaId"=${input.mediaId} AND edition=${input.edition} ORDER BY "userId" FOR SHARE`;
}
