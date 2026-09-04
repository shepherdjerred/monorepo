import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import { recordCommitteeSeriesOutcome } from "#src/progression/duels/records.ts";

type DuelSeriesDecision =
  | { readonly kind: "replay" }
  | { readonly kind: "no_contest" }
  | { readonly kind: "advance"; readonly winnerCompetitorId: string };

type DecisionSeries = {
  readonly id: string;
  readonly guildId: string;
  readonly organizerDiscordId: string;
  readonly seriesState: string;
  readonly eventId: string | null;
  readonly competitorOneId: string;
  readonly competitorTwoId: string;
  readonly competitorOne: {
    readonly members: readonly { readonly playerId: number }[];
  };
  readonly competitorTwo: {
    readonly members: readonly { readonly playerId: number }[];
  };
  readonly games: readonly {
    readonly gameNumber: number;
    readonly resultState: string | null;
  }[];
};

function validateDecision(
  series: DecisionSeries,
  actorDiscordId: string,
  decision: DuelSeriesDecision,
): void {
  if (series.organizerDiscordId !== actorDiscordId) {
    throw new Error("Only the series organizer may committee a result");
  }
  if (!["overdue", "needs_review"].includes(series.seriesState)) {
    throw new Error("This series does not require an organizer decision");
  }
  if (
    decision.kind === "advance" &&
    decision.winnerCompetitorId !== series.competitorOneId &&
    decision.winnerCompetitorId !== series.competitorTwoId
  ) {
    throw new Error("The advancement winner is not assigned to this series");
  }
  if (decision.kind === "no_contest" && series.eventId !== null) {
    throw new Error(
      "Structured event series cannot be closed as no-contest; choose replay or advancement",
    );
  }
}

async function applyReplay(
  tx: Db,
  series: DecisionSeries,
  deadlineAt: Date,
): Promise<void> {
  await tx.duelGame.create({
    data: {
      seriesId: series.id,
      gameNumber:
        Math.max(0, ...series.games.map((game) => game.gameNumber)) + 1,
    },
  });
  await tx.duelSeriesParticipant.updateMany({
    where: { seriesId: series.id },
    data: { readyAt: null },
  });
  await tx.duelSeries.update({
    where: { id: series.id },
    data: {
      seriesState: "awaiting_readiness",
      deadlineAt,
      advancementKind: null,
      advancementReason: null,
    },
  });
}

async function applyNoContest(
  tx: Db,
  seriesId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await tx.duelSeries.update({
    where: { id: seriesId },
    data: {
      seriesState: "no_contest",
      advancementKind: "no_contest",
      advancementReason: reason,
      completedAt: now,
    },
  });
}

async function applyAdvancement(
  tx: Db,
  series: DecisionSeries,
  options: {
    readonly winnerCompetitorId: string;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<void> {
  if (series.games.some((game) => game.resultState === "verified")) {
    const winnerIsFirst = options.winnerCompetitorId === series.competitorOneId;
    await recordCommitteeSeriesOutcome(tx, {
      guildId: series.guildId,
      winner: winnerIsFirst ? series.competitorOne : series.competitorTwo,
      loser: winnerIsFirst ? series.competitorTwo : series.competitorOne,
      structured: series.eventId !== null,
    });
  }
  await tx.duelSeries.update({
    where: { id: series.id },
    data: {
      seriesState: "completed",
      winnerCompetitorId: options.winnerCompetitorId,
      advancementKind: "committee",
      advancementReason: options.reason,
      completedAt: options.now,
    },
  });
}

async function applyDecision(
  tx: Db,
  series: DecisionSeries,
  options: {
    readonly decision: DuelSeriesDecision;
    readonly reason: string;
    readonly now: Date;
    readonly deadlineAt: Date;
  },
): Promise<void> {
  if (options.decision.kind === "replay") {
    await applyReplay(tx, series, options.deadlineAt);
    return;
  }
  if (options.decision.kind === "no_contest") {
    await applyNoContest(tx, series.id, options.reason, options.now);
    return;
  }
  await applyAdvancement(tx, series, {
    winnerCompetitorId: options.decision.winnerCompetitorId,
    reason: options.reason,
    now: options.now,
  });
}

export async function decideDuelSeries(
  db: ExtendedPrismaClient,
  options: {
    readonly seriesId: string;
    readonly guildId: DiscordGuildId;
    readonly actorDiscordId: DiscordAccountId;
    readonly idempotencyKey: string;
    readonly reason: string;
    readonly decision: DuelSeriesDecision;
  },
) {
  if (options.reason.trim().length < 3) {
    throw new Error("An organizer decision requires an audited reason");
  }
  return await db.$transaction(async (tx) => {
    const prior = await tx.duelAuditDecision.findUnique({
      where: { idempotencyKey: options.idempotencyKey },
    });
    if (prior !== null) {
      if (prior.seriesId !== options.seriesId) {
        throw new Error(
          "The organizer decision key was reused for another series",
        );
      }
      const series = await tx.duelSeries.findFirstOrThrow({
        where: { id: options.seriesId, guildId: options.guildId },
      });
      return {
        seriesId: series.id,
        eventId: series.eventId,
        seriesComplete:
          series.seriesState === "completed" &&
          series.winnerCompetitorId !== null,
        deadlineAt: series.deadlineAt ?? new Date(),
      };
    }
    await tx.$executeRaw`SELECT 1 FROM "DuelSeries" WHERE "id" = ${options.seriesId} FOR UPDATE`;
    const series = await tx.duelSeries.findFirstOrThrow({
      where: { id: options.seriesId, guildId: options.guildId },
      include: {
        games: true,
        competitorOne: { include: { members: true } },
        competitorTwo: { include: { members: true } },
      },
    });
    validateDecision(series, options.actorDiscordId, options.decision);
    const now = new Date();
    const deadlineAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await tx.duelAuditDecision.create({
      data: {
        seriesId: series.id,
        actorDiscordId: options.actorDiscordId,
        action: options.decision.kind,
        reason: options.reason.trim(),
        payloadJson: JSON.stringify(options.decision),
        idempotencyKey: options.idempotencyKey,
      },
    });
    await applyDecision(tx, series, {
      decision: options.decision,
      reason: options.reason.trim(),
      now,
      deadlineAt,
    });
    return {
      seriesId: series.id,
      eventId: series.eventId,
      seriesComplete: options.decision.kind === "advance",
      deadlineAt,
    };
  });
}
