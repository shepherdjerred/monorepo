import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import {
  admitMatchEvidence,
  evidenceRecoveryEnabled,
} from "#src/evidence/admission.ts";
import { resolveCompleteMatch } from "#src/evidence/matches.ts";
import { resolveMatchTimeline } from "#src/evidence/timelines.ts";
import { resolveScoutObservedMatchContext } from "./match-context.ts";
import {
  archiveMatchArtifacts,
  commitMatchObservation,
} from "./match-archive.ts";
import { renderMatchNotificationArtifact } from "#src/temporal/notification-lane/notification-render.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

async function ensureHistoryReport(
  matchId: RiotMatchId,
  policy: string,
  complete: boolean,
  context: Awaited<ReturnType<typeof resolveScoutObservedMatchContext>>,
): Promise<boolean> {
  if (policy !== "HISTORY_ONLY") return complete;
  if (context.trackedPlayers.length === 0) return false;
  if (!complete)
    await renderMatchNotificationArtifact({
      riotMatchId: matchId,
      kind: "postmatch",
      postmatchMode: { kind: "historical", rankChanges: new Map() },
    });
  return true;
}

/** Background capture/render only: this module has no effect or notification producer. */
export async function reconcileMatchHistory(now = new Date()): Promise<number> {
  if (!evidenceRecoveryEnabled()) return 0;
  // Adopt old silent FULL rows through the same audited admission boundary.
  const legacy = await prisma.$queryRaw<
    { riotMatchId: string; observedAt: Date }[]
  >`
    SELECT o."riotMatchId", o."observedAt"
    FROM "MatchObservation" o LEFT JOIN "MatchEvidenceAdmission" a USING ("riotMatchId")
    WHERE a."riotMatchId" IS NULL AND o."deliveryMode" = 'silent-backfill'
      AND o."pipelineOwner" = 'TEMPORAL_V2'
    ORDER BY o."observedAt", o."riotMatchId" LIMIT 50`;
  for (const row of legacy)
    await admitMatchEvidence({
      matchId: RiotMatchIdSchema.parse(row.riotMatchId),
      completedAt: null,
      discoveredAt: row.observedAt,
      historical: true,
    });
  const rows = await prisma.matchEvidenceAdmission.findMany({
    where: {
      recoveryNextAttemptAt: { lte: now },
      OR: [
        {
          policy: "HISTORY_ONLY",
          OR: [
            { historyReportComplete: false },
            { historyTimelineRecovered: false },
          ],
        },
        {
          policy: "FULL",
          timelineMissing: true,
          historyTimelineRecovered: false,
        },
      ],
    },
    // Historical rendering shares background capacity with live reports.
    // Bound each sweep tightly; durable deadlines rotate unfinished rows.
    take: 2,
    orderBy: [{ recoveryNextAttemptAt: "asc" }, { riotMatchId: "asc" }],
    select: { riotMatchId: true },
  });
  const failures: unknown[] = [];
  for (const item of rows) {
    const claim = crypto.randomUUID();
    const claimed = await prisma.matchEvidenceAdmission.updateMany({
      where: {
        riotMatchId: item.riotMatchId,
        recoveryNextAttemptAt: { lte: now },
      },
      data: {
        recoveryClaimId: claim,
        recoveryNextAttemptAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    if (claimed.count === 0) continue;
    try {
      const matchId = RiotMatchIdSchema.parse(item.riotMatchId);
      const admission = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
        where: { riotMatchId: matchId },
      });
      const match = await resolveCompleteMatch(matchId);
      if (match.kind !== "available") {
        await prisma.matchEvidenceAdmission.updateMany({
          where: { riotMatchId: matchId, recoveryClaimId: claim },
          data: { recoveryClaimId: null },
        });
        continue;
      }
      await prisma.matchEvidenceAdmission.updateMany({
        where: { riotMatchId: matchId, completedAt: null },
        data: { completedAt: new Date(match.value.info.gameEndTimestamp) },
      });
      if (admission.policy === "HISTORY_ONLY") {
        await archiveMatchArtifacts({ riotMatchId: matchId });
        await commitMatchObservation({
          riotMatchId: matchId,
          deliveryMode: "silent-backfill",
        });
        // The existing pipeline reconciliation scans raw-archive receipts
        // without filtering processing policy. It starts the lake projection
        // on the lake queue, which owns the staging volume; this worker never
        // writes match staging files on its own volume.
      }
      const context = await resolveScoutObservedMatchContext(matchId);
      const timeline = await resolveMatchTimeline({
        match: context.matchData,
        players: context.trackedPlayers,
        persistence: "required_if_available",
        purpose: "history",
      });
      if (timeline.kind === "conflict")
        throw new Error(`Conflicting history timeline evidence for ${matchId}`);
      const reportComplete = await ensureHistoryReport(
        matchId,
        admission.policy,
        admission.historyReportComplete,
        context,
      );
      await prisma.matchEvidenceAdmission.updateMany({
        where: { riotMatchId: matchId, recoveryClaimId: claim },
        data: {
          historyReportComplete: reportComplete,
          historyTimelineRecovered: timeline.kind === "available",
          recoveryClaimId: null,
          recoveryError: null,
        },
      });
    } catch (error) {
      failures.push(error);
      await prisma.matchEvidenceAdmission.updateMany({
        where: { riotMatchId: item.riotMatchId, recoveryClaimId: claim },
        data: {
          recoveryClaimId: null,
          recoveryError:
            "History recovery failed; durable work remains pending",
        },
      });
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "Historical evidence remains retryable");
  return rows.length;
}
