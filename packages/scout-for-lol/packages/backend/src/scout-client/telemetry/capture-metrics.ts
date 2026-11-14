import { z } from "zod";
import type {
  ScoutClientObservation,
  ScoutClientObservationQuarantineReason,
  ScoutClientPostGameOutcome,
} from "@scout-for-lol/data";
import {
  classifyGame,
  DiscordAccountIdSchema,
  type QueueType,
} from "@scout-for-lol/data";
import { isLcuUuid } from "#src/scout-client/identity-alias.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { createLogger } from "#src/logger.ts";
import {
  scoutClientActiveDevices,
  scoutClientAliasLookupBacklog,
  scoutClientGameEndToDeliveredSeconds,
  scoutClientObservationsTotal,
  scoutClientPostGameOutcomeTotal,
  scoutClientReconciliationBacklog,
  scoutClientReconciliationOldestAgeSeconds,
  scoutClientRiotListedAfterSelectionTotal,
} from "#src/metrics/scout-client.ts";
import { registerDatabaseMetricSweep } from "#src/metrics/sweep-registry.ts";

const logger = createLogger("scout-client-capture-metrics");

const ACTIVE_DEVICE_WINDOW_MS = 15 * 60 * 1000;
const ALIAS_BACKLOG_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Matches `reconcileAcceptedClientEvidence`'s five-minute retry spacing. */
const RECONCILIATION_SETTLE_MS = 5 * 60 * 1000;

const CountSchema = z.coerce.number().int().nonnegative();
const BacklogRowSchema = z.object({
  owner: z.string(),
  backlog: CountSchema,
  oldest: z.date().nullable(),
});

export type CaptureBacklog = {
  readonly activeDevices: number;
  readonly aliasBacklog: number;
  readonly reconciliationBacklog: number;
  readonly reconciliationOldestAgeSeconds: number;
};

/**
 * Read the Scout Client's operational backlogs.
 *
 * The reconciliation backlog counts accepted post-game and Clash rows the
 * reconciliation Activity has not finished with, once they are old enough that
 * its normal first pass should have done so. Quarantined rows are excluded:
 * they never complete, and counting them would pin the age forever.
 */
export async function readCaptureBacklog(
  db: Db,
  now = new Date(),
): Promise<CaptureBacklog> {
  const activeSince = new Date(now.getTime() - ACTIVE_DEVICE_WINDOW_MS);
  const aliasSince = new Date(now.getTime() - ALIAS_BACKLOG_WINDOW_MS);
  const settledBefore = new Date(now.getTime() - RECONCILIATION_SETTLE_MS);
  const [devices, aliases, reconciliation] = await Promise.all([
    db.scoutClientDevice.count({
      where: {
        deviceState: "ACTIVE",
        revokedAt: null,
        lastSeenAt: { gte: activeSince },
      },
    }),
    db.$queryRaw`
      SELECT COUNT(DISTINCT observation."localLcuUuid") AS backlog
      FROM "ScoutClientObservation" observation
      WHERE observation."localLcuUuid" IS NOT NULL
        AND observation."receivedAt" >= ${aliasSince}
        AND NOT EXISTS (
          SELECT 1 FROM "LeagueIdentityAlias" alias
          WHERE alias."lcuUuid" = observation."localLcuUuid"
        )
    `,
    db.$queryRaw`
      SELECT
        device."ownerId" AS owner,
        COUNT(*) AS backlog,
        MIN(observation."receivedAt") AS oldest
      FROM "ScoutClientObservation" observation
      JOIN "ScoutClientDevice" device ON device.id = observation."deviceId"
      WHERE observation.disposition = 'ACCEPTED'
        AND observation.kind IN ('post_game', 'clash')
        AND observation."recoveryComplete" = false
        AND observation."receivedAt" < ${settledBefore}
      GROUP BY device."ownerId"
    `,
  ]);
  const aliasRow = z
    .array(z.object({ backlog: CountSchema }))
    .length(1)
    .parse(aliases);
  // Rows the recovery policy skips (globally or per owner) are not stuck, so
  // they stay out of the backlog the stale-reconciliation alert watches.
  const eligible = [];
  for (const row of z.array(BacklogRowSchema).parse(reconciliation)) {
    if (
      await isPolicyEnabled("scout_client_result_recovery", {
        user: DiscordAccountIdSchema.parse(row.owner),
      })
    )
      eligible.push(row);
  }
  const backlogCount = eligible.reduce((sum, row) => sum + row.backlog, 0);
  const oldest = eligible.reduce<Date | null>(
    (min, row) =>
      row.oldest !== null && (min === null || row.oldest < min)
        ? row.oldest
        : min,
    null,
  );
  return {
    activeDevices: devices,
    aliasBacklog: aliasRow[0]?.backlog ?? 0,
    reconciliationBacklog: backlogCount,
    reconciliationOldestAgeSeconds:
      oldest === null
        ? 0
        : Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000)),
  };
}

/** Publish the backlogs; every gauge reads -1 when the read fails. */
export async function collectCaptureBacklogMetrics(db: Db): Promise<void> {
  try {
    const backlog = await readCaptureBacklog(db);
    scoutClientActiveDevices.set(backlog.activeDevices);
    scoutClientAliasLookupBacklog.set(backlog.aliasBacklog);
    scoutClientReconciliationBacklog.set(backlog.reconciliationBacklog);
    scoutClientReconciliationOldestAgeSeconds.set(
      backlog.reconciliationOldestAgeSeconds,
    );
  } catch (error) {
    scoutClientActiveDevices.set(-1);
    scoutClientAliasLookupBacklog.set(-1);
    scoutClientReconciliationBacklog.set(-1);
    scoutClientReconciliationOldestAgeSeconds.set(-1);
    logger.error("Failed to update the Scout Client capture backlog metrics", {
      error,
    });
  }
}

/** Add this sweep to the scrape-time set; called by the composition root. */
export function registerCaptureBacklogSweep(): void {
  registerDatabaseMetricSweep("scout-client-capture-backlog", async () => {
    await collectCaptureBacklogMetrics(prisma);
  });
}

/**
 * Observe how long a delivered post-match report took after its game ended.
 * The game's end is the admission's completion time; a match without one
 * (a legacy row) is skipped rather than guessed. Never fails the follow-up.
 */
export async function recordGameEndToDelivered(
  matchId: RiotMatchId,
  deliveredAt: string | undefined,
): Promise<void> {
  if (deliveredAt === undefined) return;
  try {
    const admission = await prisma.matchEvidenceAdmission.findUnique({
      where: { riotMatchId: matchId },
      select: { completedAt: true },
    });
    if (admission?.completedAt == null) return;
    const seconds =
      (Date.parse(deliveredAt) - admission.completedAt.getTime()) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0)
      scoutClientGameEndToDeliveredSeconds.observe(seconds);
  } catch (error) {
    logger.error("Failed to observe game-end to delivered latency", { error });
  }
}

/**
 * Count the matches a Riot history listing is about to list for the first time
 * that a client selection already covers: two sources now claim the match, the
 * duplicate-risk signal. Call before the listing is admitted, since admission
 * is what records that Riot listed it. Never fails the discovery pass.
 */
export async function recordRiotListedAfterClientSelection(
  matchIds: readonly RiotMatchId[],
): Promise<void> {
  if (matchIds.length === 0) return;
  try {
    const selected = await prisma.scoutClientCanonicalMatch.findMany({
      where: { riotMatchId: { in: [...matchIds] } },
      select: { riotMatchId: true },
    });
    if (selected.length === 0) return;
    const alreadyListed = await prisma.matchEvidenceAdmission.findMany({
      where: {
        riotMatchId: { in: selected.map((row) => row.riotMatchId) },
        riotHistoryListed: true,
      },
      select: { riotMatchId: true },
    });
    const counted = new Set(alreadyListed.map((row) => row.riotMatchId));
    const fresh = selected.filter((row) => !counted.has(row.riotMatchId));
    if (fresh.length > 0)
      scoutClientRiotListedAfterSelectionTotal.inc(fresh.length);
  } catch (error) {
    logger.error("Failed to count Riot-listed matches after selection", {
      error,
    });
  }
}

/** Count an observation once, when it is first stored. */
export function recordStoredObservation(
  observation: ScoutClientObservation,
  reason: ScoutClientObservationQuarantineReason | null,
): void {
  scoutClientObservationsTotal.inc({
    kind: observation.kind,
    outcome: reason === null ? "accepted" : "quarantined",
    quarantine_reason: reason ?? "none",
  });
  // A post-game bundle quarantined because its observer's League-client UUID
  // has no Riot alias is waiting on identity; the rest are projected later.
  if (
    reason === "unverified_local_puuid" &&
    observation.kind === "post_game" &&
    observation.localPuuid !== undefined &&
    isLcuUuid(observation.localPuuid)
  ) {
    recordPostGameOutcome("waiting_identity", "unknown");
  }
}

export function recordPostGameOutcome(
  outcome: ScoutClientPostGameOutcome,
  gameKind: QueueType | "unknown",
): void {
  scoutClientPostGameOutcomeTotal.inc({
    outcome,
    game_kind: gameKind,
  });
}

/** The shared classifier's queue type of a match, or `unknown`. */
export function gameKindOf(info: {
  readonly queueId: number;
  readonly gameMode: string;
  readonly gameType: string;
  readonly tournamentCode?: string | undefined;
}): QueueType | "unknown" {
  const classification = classifyGame(info);
  return classification.kind === "queue" ? classification.queue : "unknown";
}
