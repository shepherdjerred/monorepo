import {
  DuelRulesetV1Schema,
  DuelTimelineInputSchema,
  MatchIdSchema,
  evaluateDuelGame,
  type DuelResultEvidence,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import type { ScoutStage } from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { advanceDuelEvent } from "#src/progression/duels/advancement.ts";
import { parseDuelCompetitor } from "#src/progression/duels/competitors.ts";
import { signalDuelSeries } from "#src/progression/duels/launch.ts";
import {
  duelRecordSubjectKeys,
  recordDuelSide,
} from "#src/progression/duels/records.ts";
import {
  duelResults,
  duelSeriesTransitions,
} from "#src/metrics/progression.ts";
export async function duelMatchNeedsTimeline(
  match: RawMatch,
): Promise<boolean> {
  const tournamentCode = match.info.tournamentCode;
  if (tournamentCode === undefined) return false;
  return (
    (await prisma.duelGame.count({
      where: {
        gameState: { in: ["code_ready", "in_progress"] },
        tournamentLobby: { code: tournamentCode },
        series: { seriesState: { in: ["code_ready", "in_progress"] } },
      },
    })) > 0
  );
}

function timelineInput(match: RawMatch, timeline: RawTimeline) {
  const puuidByParticipant = new Map(
    timeline.info.participants.map((participant) => [
      participant.participantId,
      participant.puuid,
    ]),
  );
  return DuelTimelineInputSchema.parse({
    matchId: match.metadata.matchId,
    completed: true,
    timelineComplete: true,
    participants: match.info.participants.map((participant) => ({
      puuid: participant.puuid,
      teamId: participant.teamId,
    })),
    kills: timeline.info.frames.flatMap((frame) =>
      frame.events.flatMap((event) => {
        if (event.type !== "CHAMPION_KILL" || event.killerId === undefined) {
          return [];
        }
        const killerPuuid = puuidByParticipant.get(event.killerId);
        return killerPuuid === undefined
          ? []
          : [{ timestampMs: event.timestamp, killerPuuid }];
      }),
    ),
    turretKills: timeline.info.frames.flatMap((frame) =>
      frame.events.flatMap((event) => {
        if (
          event.type !== "BUILDING_KILL" ||
          event.buildingType !== "TOWER_BUILDING" ||
          event.teamId === undefined
        ) {
          return [];
        }
        return [
          { timestampMs: event.timestamp, destroyedTeamId: event.teamId },
        ];
      }),
    ),
    frames: timeline.info.frames.map((frame) => ({
      timestampMs: frame.timestamp,
      participants: Object.values(frame.participantFrames ?? {}).flatMap(
        (participant) => {
          const puuid = puuidByParticipant.get(participant.participantId);
          return puuid === undefined
            ? []
            : [
                {
                  puuid,
                  minionsKilled: participant.minionsKilled,
                  jungleMinionsKilled: participant.jungleMinionsKilled,
                },
              ];
        },
      ),
    })),
  });
}

function seriesAcceptsGame(
  seriesState: string,
  gameNumber: number,
  games: readonly { readonly gameNumber: number }[],
): boolean {
  return (
    ["code_ready", "in_progress"].includes(seriesState) &&
    !games.some((candidate) => candidate.gameNumber > gameNumber)
  );
}

async function recordVerifiedResult(
  gameId: string,
  evidence: DuelResultEvidence,
  stage: ScoutStage,
): Promise<void> {
  const change = await prisma.$transaction(async (tx) => {
    // Serialize every rolling-record mutation in a guild. Besides preserving
    // streak order, taking the lock before reading the game makes duplicate
    // post-match deliveries observe the committed verified result and return
    // without incrementing any record twice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-duel-records'), hashtext((SELECT "guildId" FROM "DuelSeries" WHERE id = (SELECT "seriesId" FROM "DuelGame" WHERE id = ${gameId}))))`;
    await tx.$executeRaw`SELECT 1 FROM "DuelSeries" WHERE "id" = (SELECT "seriesId" FROM "DuelGame" WHERE "id" = ${gameId}) FOR UPDATE`;
    const game = await tx.duelGame.findUniqueOrThrow({
      where: { id: gameId },
      include: {
        series: {
          include: {
            competitorOne: { include: { members: true } },
            competitorTwo: { include: { members: true } },
            games: true,
          },
        },
      },
    });
    if (game.resultState === "verified") return null;
    const series = game.series;
    if (!seriesAcceptsGame(series.seriesState, game.gameNumber, series.games))
      return null;
    const winnerIsFirst =
      evidence.winnerCompetitorId === series.competitorOneId;
    if (
      !winnerIsFirst &&
      evidence.winnerCompetitorId !== series.competitorTwoId
    ) {
      throw new Error("Verified duel evidence names an unassigned winner");
    }
    const winner = winnerIsFirst ? series.competitorOne : series.competitorTwo;
    const loser = winnerIsFirst ? series.competitorTwo : series.competitorOne;
    const priorWinnerGames = series.games.filter(
      (candidate) =>
        candidate.resultState === "verified" &&
        candidate.winnerCompetitorId === evidence.winnerCompetitorId,
    ).length;
    const requiredWins = Math.floor(series.bestOf / 2) + 1;
    const seriesComplete = priorWinnerGames + 1 >= requiredWins;
    const winnerKeys = duelRecordSubjectKeys(winner);
    const loserKeys = duelRecordSubjectKeys(loser);
    await tx.duelGame.update({
      where: { id: game.id },
      data: {
        matchId: MatchIdSchema.parse(evidence.matchId),
        gameState: "completed",
        resultState: "verified",
        winnerCompetitorId: evidence.winnerCompetitorId,
        objective: evidence.objective,
        objectiveTimestampMs: evidence.objectiveTimestampMs,
        evidenceJson: JSON.stringify(evidence),
        reviewReason: null,
        verifiedAt: new Date(),
      },
    });
    await recordDuelSide(tx, {
      guildId: series.guildId,
      own: winnerKeys,
      opponent: loserKeys,
      gameResult: "won",
      seriesResult: seriesComplete ? "won" : null,
      structured: series.eventId !== null,
    });
    await recordDuelSide(tx, {
      guildId: series.guildId,
      own: loserKeys,
      opponent: winnerKeys,
      gameResult: "lost",
      seriesResult: seriesComplete ? "lost" : null,
      structured: series.eventId !== null,
    });
    if (seriesComplete) {
      await tx.duelSeries.update({
        where: { id: series.id },
        data: {
          seriesState: "completed",
          winnerCompetitorId: evidence.winnerCompetitorId,
          advancementKind: "played",
          completedAt: new Date(),
        },
      });
    } else {
      await tx.duelSeries.update({
        where: { id: series.id },
        data: { seriesState: "awaiting_readiness" },
      });
      await tx.duelSeriesParticipant.updateMany({
        where: { seriesId: series.id },
        data: { readyAt: null },
      });
      await tx.duelGame.create({
        data: {
          seriesId: series.id,
          gameNumber:
            Math.max(...series.games.map((row) => row.gameNumber)) + 1,
        },
      });
    }
    return {
      seriesId: series.id,
      eventId: series.eventId,
      seriesComplete,
      deadlineAt: series.deadlineAt ?? new Date(),
      requestId: `duel-result:${game.id}`,
    };
  });
  if (change === null) return;
  duelResults.inc({ status: "verified" });
  duelSeriesTransitions.inc({
    from: "in_progress",
    to: change.seriesComplete ? "completed" : "awaiting_readiness",
  });
  await signalDuelSeries({
    stage,
    seriesId: change.seriesId,
    deadlineAt: change.deadlineAt,
    requestId: change.requestId,
  });
  if (change.seriesComplete && change.eventId !== null) {
    await advanceDuelEvent(change.eventId, stage);
  }
}

export async function processDuelResult(
  match: RawMatch,
  timeline: RawTimeline | null | undefined,
  stage: ScoutStage,
): Promise<void> {
  const tournamentCode = match.info.tournamentCode;
  const game = await prisma.duelGame.findFirst({
    where: {
      OR: [
        { matchId: MatchIdSchema.parse(match.metadata.matchId) },
        ...(tournamentCode === undefined
          ? []
          : [{ tournamentLobby: { code: tournamentCode } }]),
      ],
    },
    include: {
      series: {
        include: {
          participants: true,
          competitorOne: { include: { members: true } },
          competitorTwo: { include: { members: true } },
          games: true,
        },
      },
    },
  });
  if (game === null) return;
  if (game.resultState === "verified") return;
  const series = game.series;
  if (!seriesAcceptsGame(series.seriesState, game.gameNumber, series.games))
    return;
  const competitors = [
    parseDuelCompetitor(series.competitorOne),
    parseDuelCompetitor(series.competitorTwo),
  ];
  const evidence =
    timeline === null || timeline === undefined
      ? {
          matchId: match.metadata.matchId,
          state: "needs_review" as const,
          winnerCompetitorId: null,
          objective: null,
          objectiveTimestampMs: null,
          reason: "Complete timeline evidence is unavailable",
          participantPuuids: match.metadata.participants,
          timelineComplete: false,
        }
      : evaluateDuelGame(
          DuelRulesetV1Schema.parse(JSON.parse(series.rulesetJson)),
          competitors,
          timelineInput(match, timeline),
        );
  if (
    evidence.state === "needs_review" ||
    evidence.winnerCompetitorId === null
  ) {
    const applied = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "DuelSeries" WHERE "id" = ${series.id} FOR UPDATE`;
      const current = await tx.duelGame.findUniqueOrThrow({
        where: { id: game.id },
        include: { series: { include: { games: true } } },
      });
      if (
        !seriesAcceptsGame(
          current.series.seriesState,
          current.gameNumber,
          current.series.games,
        )
      ) {
        return false;
      }
      await tx.duelGame.update({
        where: { id: game.id },
        data: {
          matchId: MatchIdSchema.parse(match.metadata.matchId),
          gameState: "needs_review",
          resultState: "needs_review",
          evidenceJson: JSON.stringify(evidence),
          reviewReason: evidence.reason,
        },
      });
      await tx.duelSeries.update({
        where: { id: series.id },
        data: { seriesState: "needs_review" },
      });
      return true;
    });
    if (!applied) return;
    duelResults.inc({ status: "needs_review" });
    duelSeriesTransitions.inc({
      from: series.seriesState,
      to: "needs_review",
    });
    await signalDuelSeries({
      stage,
      seriesId: series.id,
      deadlineAt: series.deadlineAt ?? new Date(),
      requestId: `duel-result-review:${game.id}`,
    });
    return;
  }
  await recordVerifiedResult(game.id, evidence, stage);
}
