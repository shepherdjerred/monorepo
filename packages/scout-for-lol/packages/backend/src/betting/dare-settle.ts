import * as Sentry from "@sentry/bun";
import {
  BucksDareHorizonKindSchema,
  resolveQueueTypeFromGame,
  type BucksDareHorizonKind,
  type RawMatch,
} from "@scout-for-lol/data";
import { z } from "zod";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import {
  DARE_ELIGIBLE_QUEUES,
  DARE_EVALUATOR_VERSION,
  DareConditionsSchema,
  DareTargetAccountsSchema,
  evaluateDareGame,
  evaluateDareTree,
  renderDareConditions,
  type DareConditions,
  type DareTargetIdentity,
} from "#src/betting/dare-criteria.ts";
import {
  payDareTargetsInTransaction,
  refundDareContributionsInTransaction,
  type DareContributorRefund,
  type DareLedgerFacts,
  type DareTargetPayout,
} from "#src/betting/dare-ledger.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingDareGamesCapturedTotal,
  bettingDareSettlementsTotal,
  bettingDaresTotal,
} from "#src/metrics/betting.ts";

const logger = createLogger("betting-dare-settle");

/**
 * Match-driven dare capture and settlement.
 *
 * Capture and evaluation share ONE transaction behind the dare-row claim: a
 * game row can never commit without the achievement check running, so an
 * early settlement cannot be lost to a crash, and contributions, sweeps, and
 * settles all serialize on the same row. The `(dareId, matchId)` unique key
 * makes ingest replays no-ops.
 */

export type DareResolution =
  "captured" | "achieved" | "unachieved" | "voided" | "expired" | "abandoned";

/**
 * What one dare resolution (or progress capture) looked like, for the
 * Discord delivery layer to announce. The domain stays Discord-free: it
 * returns these and never sends anything.
 */
export type DareSettlementSummary = {
  dareId: number;
  serverId: string;
  channelId: string;
  /** JSON BucksMessageRef for the public callout, when one was recorded. */
  messageRef: string | null;
  matchId: string | undefined;
  resolution: DareResolution;
  horizonKind: BucksDareHorizonKind;
  challengerDiscordId: string;
  targetAliases: string[];
  conditionSummary: string;
  potTotal: number;
  /** Per-target payouts — populated only for `achieved`. */
  payouts: DareTargetPayout[];
  /** Per-contributor refunds — populated for `unachieved`, `voided`, and
   * `expired`. */
  refunds: DareContributorRefund[];
  voidReason: string | undefined;
  /** Per-leaf qualifying-game counts after this capture, canonical order. */
  leafCounts: number[] | undefined;
};

const DareQueueSchema = z.enum(DARE_ELIGIBLE_QUEUES);
const LeafHitsSchema = z.array(z.boolean());

export type ActiveDareRow = {
  id: number;
  serverId: string;
  channelId: string;
  challengerDiscordId: string;
  horizonKind: string;
  windowEndsAt: Date | null;
  activatedAt: Date | null;
  conditions: string;
  evaluatorVersion: string;
  potTotal: number;
  messageRef: string | null;
  targets: {
    id: number;
    discordId: string;
    alias: string;
    accounts: string;
    bucksAccountId: number | null;
    acceptedAt: Date | null;
  }[];
};

export type ParsedDare = {
  row: ActiveDareRow;
  conditions: DareConditions;
  targets: DareTargetIdentity[];
  horizonKind: BucksDareHorizonKind;
  facts: DareLedgerFacts;
};

export function parseDare(row: ActiveDareRow, matchId?: string): ParsedDare {
  const conditions = DareConditionsSchema.parse(JSON.parse(row.conditions));
  const targets: DareTargetIdentity[] = row.targets.map((target) => ({
    discordId: target.discordId,
    alias: target.alias,
    accounts: DareTargetAccountsSchema.parse(JSON.parse(target.accounts)),
  }));
  const targetAliases = row.targets.map((target) => target.alias);
  return {
    row,
    conditions,
    targets,
    horizonKind: BucksDareHorizonKindSchema.parse(row.horizonKind),
    facts: {
      dareId: row.id,
      serverId: row.serverId,
      potTotal: row.potTotal,
      targetAliases,
      conditionSummary: renderDareConditions(conditions, targetAliases),
      matchId,
    },
  };
}

export function baseSummary(
  dare: ParsedDare,
  resolution: DareResolution,
  matchId?: string,
): DareSettlementSummary {
  return {
    dareId: dare.row.id,
    serverId: dare.row.serverId,
    channelId: dare.row.channelId,
    messageRef: dare.row.messageRef,
    matchId,
    resolution,
    horizonKind: dare.horizonKind,
    challengerDiscordId: dare.row.challengerDiscordId,
    targetAliases: [...dare.facts.targetAliases],
    conditionSummary: dare.facts.conditionSummary,
    potTotal: dare.row.potTotal,
    payouts: [],
    refunds: [],
    voidReason: undefined,
    leafCounts: undefined,
  };
}

/**
 * Void a dare whose stored evaluator version this code no longer implements:
 * full refunds, no cut. Shared by capture and the window sweep. Runs its own
 * transaction; returns undefined when another resolution won the claim.
 */
export async function voidDareForEvaluatorMismatch(
  dare: ParsedDare,
  prismaClient: ExtendedPrismaClient,
  now: Date,
  surface: "postmatch" | "sweep" = "postmatch",
): Promise<DareSettlementSummary | undefined> {
  const refunds = await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksDare.updateMany({
      where: { id: dare.row.id, dareState: "active" },
      data: {
        dareState: "voided",
        voidReason: "unknown_evaluator",
        settledAt: now,
      },
    });
    if (claim.count !== 1) {
      return;
    }
    return await refundDareContributionsInTransaction(tx, {
      facts: dare.facts,
      resolution: "voided",
      withCut: false,
      voidReason: "unknown_evaluator",
    });
  });
  if (refunds === undefined) return undefined;
  bettingDaresTotal.inc({ result: "voided" });
  bettingDareSettlementsTotal.inc({ outcome: "voided" });
  logBucksTransition({
    event: "bucks.dare.voided",
    serverId: dare.row.serverId,
    dareId: dare.row.id,
    fromState: "active",
    toState: "voided",
    reason: "unknown_evaluator",
    surface,
  });
  const summary = baseSummary(dare, "voided");
  summary.refunds = refunds;
  summary.voidReason = "unknown_evaluator";
  return summary;
}

async function captureAndSettleDare(
  tx: Db,
  input: {
    dare: ParsedDare;
    matchData: RawMatch;
    queueType: string;
    leafHits: boolean[];
    snapshot: unknown;
    now: Date;
  },
): Promise<DareSettlementSummary | undefined> {
  const { dare, matchData, now } = input;
  const matchId = matchData.metadata.matchId;
  // Guarded first statement: the dare-row claim serializes capture against
  // contributions, sweeps, and any concurrent settlement of the same dare.
  const claim = await tx.bucksDare.updateMany({
    where: { id: dare.row.id, dareState: "active" },
    data: { updatedAt: now },
  });
  if (claim.count !== 1) return undefined;

  // Idempotent capture: an ingest replay hits the (dareId, matchId) unique
  // key, inserts nothing, and must not re-run settlement.
  const captured = await tx.bucksDareGame.createMany({
    data: [
      {
        dareId: dare.row.id,
        matchId,
        gameStartAt: new Date(matchData.info.gameStartTimestamp),
        gameEndAt: new Date(matchData.info.gameEndTimestamp),
        queueType: input.queueType,
        leafHits: JSON.stringify(input.leafHits),
        snapshot: JSON.stringify(input.snapshot),
      },
    ],
    skipDuplicates: true,
  });
  if (captured.count !== 1) return undefined;

  const rows = await tx.bucksDareGame.findMany({
    where: { dareId: dare.row.id },
    orderBy: { id: "asc" },
    select: { leafHits: true },
  });
  const tree = evaluateDareTree(
    dare.conditions,
    rows.map((row) => ({
      leafHits: LeafHitsSchema.parse(JSON.parse(row.leafHits)),
    })),
  );

  if (tree.achieved) {
    await tx.bucksDare.updateMany({
      where: { id: dare.row.id, dareState: "active" },
      data: { dareState: "achieved", settledAt: now },
    });
    const payees = dare.row.targets.map((target) => {
      if (target.bucksAccountId === null || target.acceptedAt === null) {
        throw new Error(
          `Active dare ${dare.row.id.toString()} has an unaccepted target ${target.id.toString()}`,
        );
      }
      return {
        id: target.id,
        discordId: target.discordId,
        alias: target.alias,
        bucksAccountId: target.bucksAccountId,
      };
    });
    const { payouts } = await payDareTargetsInTransaction(tx, {
      facts: { ...dare.facts, matchId },
      targets: payees,
    });
    const summary = baseSummary(dare, "achieved", matchId);
    summary.payouts = payouts;
    summary.leafCounts = tree.leafCounts;
    return summary;
  }

  if (dare.horizonKind === "next_game") {
    // The one bound game evaluated false, so the dare is settled unachieved
    // in the same transaction — a next-game dare never waits for its clock.
    await tx.bucksDare.updateMany({
      where: { id: dare.row.id, dareState: "active" },
      data: { dareState: "unachieved", settledAt: now },
    });
    const refunds = await refundDareContributionsInTransaction(tx, {
      facts: { ...dare.facts, matchId },
      resolution: "unachieved",
      withCut: true,
    });
    const summary = baseSummary(dare, "unachieved", matchId);
    summary.refunds = refunds;
    summary.leafCounts = tree.leafCounts;
    return summary;
  }

  const summary = baseSummary(dare, "captured", matchId);
  summary.leafCounts = tree.leafCounts;
  return summary;
}

function observeDareSettlement(summary: DareSettlementSummary): void {
  // A voided dare was already fully observed inside
  // voidDareForEvaluatorMismatch, and no game was captured for it.
  if (summary.resolution === "voided") {
    return;
  }
  bettingDareGamesCapturedTotal.inc();
  if (summary.resolution === "captured") {
    logger.info(
      `🎯 Captured ${summary.matchId ?? "a game"} against dare ${summary.dareId.toString()}`,
    );
    return;
  }
  bettingDaresTotal.inc({ result: summary.resolution });
  bettingDareSettlementsTotal.inc({ outcome: summary.resolution });
  logBucksTransition({
    event:
      summary.resolution === "achieved"
        ? "bucks.dare.achieved"
        : "bucks.dare.unachieved",
    serverId: summary.serverId,
    dareId: summary.dareId,
    ...(summary.matchId === undefined ? {} : { matchId: summary.matchId }),
    payout: summary.potTotal,
    fromState: "active",
    toState: summary.resolution,
    surface: "postmatch",
  });
}

/**
 * The one call the post-match pipeline makes into dares. Never throws: the
 * discovery read swallows into an empty batch and each dare is isolated in
 * its own try/catch, so one bad dare cannot block the ingest cursor or its
 * neighbours.
 */
export async function settleDaresForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareSettlementSummary[]> {
  const matchId = matchData.metadata.matchId;
  const queue = DareQueueSchema.safeParse(
    resolveQueueTypeFromGame(
      matchData.info.queueId,
      matchData.info.gameMode,
      matchData.info.gameType,
    ),
  );
  if (!queue.success) return [];
  // A remake (or unreadable result) is never captured and never consumes a
  // next-game bind — the same classification gate every other market uses.
  if (classifyMatchForBetting(matchData).kind !== "decided") return [];

  const dares = await (async () => {
    try {
      return await prismaClient.bucksDare.findMany({
        where: { dareState: "active" },
        include: { targets: { orderBy: { id: "asc" } } },
      });
    } catch (error) {
      logger.error(`Could not load active dares for ${matchId}:`, error);
      Sentry.captureException(error, {
        tags: { source: "betting-dare-settle-load", matchId },
      });
      return [];
    }
  })();

  const summaries: DareSettlementSummary[] = [];
  for (const row of dares) {
    try {
      const summary = await settleOneDareForMatch(row, {
        matchData,
        queueType: queue.data,
        prismaClient,
        now,
      });
      if (summary !== undefined) {
        summaries.push(summary);
        observeDareSettlement(summary);
      }
    } catch (error) {
      logger.error(
        `Could not settle dare ${row.id.toString()} for ${matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-dare-settle",
          matchId,
          dareId: row.id.toString(),
        },
      });
    }
  }
  return summaries;
}

async function settleOneDareForMatch(
  row: ActiveDareRow,
  input: {
    matchData: RawMatch;
    queueType: string;
    prismaClient: ExtendedPrismaClient;
    now: Date;
  },
): Promise<DareSettlementSummary | undefined> {
  const { matchData, prismaClient, now } = input;
  const dare = parseDare(row, matchData.metadata.matchId);
  if (row.evaluatorVersion !== DARE_EVALUATOR_VERSION) {
    return await voidDareForEvaluatorMismatch(dare, prismaClient, now);
  }
  if (row.activatedAt === null || row.windowEndsAt === null) {
    throw new Error(
      `Active dare ${row.id.toString()} is missing its activation clock`,
    );
  }
  const gameStartAt = new Date(matchData.info.gameStartTimestamp);
  const gameEndAt = new Date(matchData.info.gameEndTimestamp);
  // Eligibility is "played inside the window": started after activation and
  // ended by the deadline. Ingestion time is irrelevant — the sweep's grace
  // period exists precisely so a late ingest still lands here.
  if (gameStartAt.getTime() <= row.activatedAt.getTime()) {
    return undefined;
  }
  if (gameEndAt.getTime() > row.windowEndsAt.getTime()) {
    return undefined;
  }

  const evaluation = evaluateDareGame(dare.conditions, dare.targets, matchData);
  if (evaluation === undefined) {
    return undefined;
  }

  return await prismaClient.$transaction((tx) =>
    captureAndSettleDare(tx, {
      dare,
      matchData,
      queueType: input.queueType,
      leafHits: evaluation.leafHits,
      snapshot: evaluation.snapshot,
      now,
    }),
  );
}
