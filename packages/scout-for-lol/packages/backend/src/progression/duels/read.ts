import {
  DuelEventFormatSchema,
  DuelSeriesStatusSchema,
  buildDuelStanding,
  rankRoundRobin,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { parseDuelCompetitor } from "#src/progression/duels/competitors.ts";
import {
  currentParticipantDiscordIds,
  duelSeriesVisibleTo,
  effectiveParticipantDiscordId,
} from "#src/progression/duels/series.ts";
import { latestRoundRobinResults } from "#src/progression/duels/round-robin.ts";

export async function listGuildDuels(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  viewerDiscordId: DiscordAccountId,
) {
  const viewerPlayers = await db.player.findMany({
    where: { serverId: guildId, discordId: viewerDiscordId },
    select: { id: true },
  });
  const viewerPlayerIds = viewerPlayers.map((player) => player.id);
  const [events, direct] = await Promise.all([
    db.duelEvent.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { entrants: true, series: true } } },
    }),
    db.duelSeries.findMany({
      where: {
        guildId,
        eventId: null,
        OR: [
          { participants: { every: { acceptedAt: { not: null } } } },
          { participants: { some: { playerId: { in: viewerPlayerIds } } } },
          { organizerDiscordId: viewerDiscordId },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        competitorOne: { include: { members: true } },
        competitorTwo: { include: { members: true } },
        participants: true,
      },
    }),
  ]);
  const currentDiscordIdByPlayer = await currentParticipantDiscordIds(
    db,
    guildId,
    direct.flatMap((series) => series.participants),
  );
  const visibleDirect = direct.filter((series) =>
    duelSeriesVisibleTo(currentDiscordIdByPlayer, series, viewerDiscordId),
  );
  return {
    events: events.map((event) => ({
      id: event.id,
      name: event.name,
      format: DuelEventFormatSchema.parse(event.format),
      competitorKind: event.competitorKind,
      state: event.eventState,
      entrants: event._count.entrants,
      series: event._count.series,
      createdAt: event.createdAt.toISOString(),
    })),
    direct: visibleDirect.map((series) => ({
      id: series.id,
      state: DuelSeriesStatusSchema.parse(series.seriesState),
      bestOf: series.bestOf,
      competitorOne: parseDuelCompetitor(series.competitorOne),
      competitorTwo: parseDuelCompetitor(series.competitorTwo),
      winnerCompetitorId: series.winnerCompetitorId,
      deadlineAt: series.deadlineAt?.toISOString() ?? null,
    })),
  };
}

export async function getDuelEvent(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  eventId: string,
  viewerDiscordId: DiscordAccountId,
) {
  const event = await db.duelEvent.findFirstOrThrow({
    where: { id: eventId, guildId },
    include: {
      entrants: {
        orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
        include: {
          competitor: { include: { members: true } },
        },
      },
      roundOverrides: { orderBy: { roundNumber: "asc" } },
      series: {
        orderBy: [{ roundNumber: "asc" }, { position: "asc" }],
        include: {
          competitorOne: { include: { members: true } },
          competitorTwo: { include: { members: true } },
          games: true,
          participants: true,
        },
      },
    },
  });
  const isOrganizer = event.organizerDiscordId === viewerDiscordId;
  const currentPlayers = await db.player.findMany({
    where: {
      serverId: guildId,
      id: {
        in: event.entrants.flatMap((entrant) =>
          entrant.competitor.members.map((member) => member.playerId),
        ),
      },
    },
    select: { id: true, discordId: true },
  });
  const currentDiscordIdByPlayer = new Map(
    currentPlayers.map((player) => [player.id, player.discordId]),
  );
  const viewerPlayerIds = new Set(
    currentPlayers
      .filter((player) => player.discordId === viewerDiscordId)
      .map((player) => player.id),
  );
  const visibleEntrants = event.entrants.filter(
    (entrant) =>
      (entrant.registrationState === "accepted" &&
        entrant.competitor.members.every(
          (member) =>
            effectiveParticipantDiscordId(currentDiscordIdByPlayer, member) ===
            member.discordId,
        )) ||
      isOrganizer ||
      entrant.competitor.members.some((member) =>
        viewerPlayerIds.has(member.playerId),
      ),
  );
  const visibleSeries = event.series.filter((series) =>
    duelSeriesVisibleTo(currentDiscordIdByPlayer, series, viewerDiscordId),
  );
  return {
    id: event.id,
    guildId: event.guildId,
    name: event.name,
    format: DuelEventFormatSchema.parse(event.format),
    competitorKind: event.competitorKind,
    bestOf: event.bestOf,
    registrationMode: event.registrationMode,
    seedMethod: event.seedMethod,
    matchWindowHours: event.matchWindowHours,
    state: event.eventState,
    registrationClosesAt: event.registrationClosesAt?.toISOString() ?? null,
    entrants: visibleEntrants.map((entrant) => ({
      competitor: parseDuelCompetitor(entrant.competitor),
      state: entrant.registrationState,
      seed: entrant.seed,
    })),
    roundOverrides: event.roundOverrides,
    series: visibleSeries.map((series) => ({
      id: series.id,
      roundNumber: series.roundNumber,
      bracket: series.bracket,
      position: series.position,
      state: DuelSeriesStatusSchema.parse(series.seriesState),
      competitorOne: parseDuelCompetitor(series.competitorOne),
      competitorTwo: parseDuelCompetitor(series.competitorTwo),
      winnerCompetitorId: series.winnerCompetitorId,
      gameWins: {
        first: series.games.filter(
          (game) => game.winnerCompetitorId === series.competitorOneId,
        ).length,
        second: series.games.filter(
          (game) => game.winnerCompetitorId === series.competitorTwoId,
        ).length,
      },
    })),
  };
}

export async function getDuelEventStandings(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  eventId: string,
) {
  const event = await db.duelEvent.findFirstOrThrow({
    where: { id: eventId, guildId },
    include: {
      entrants: { where: { registrationState: "accepted" } },
      series: { include: { games: true } },
    },
  });
  const standings = event.entrants.map((entrant) => {
    const relevant = event.series.filter(
      (series) =>
        series.competitorOneId === entrant.competitorId ||
        series.competitorTwoId === entrant.competitorId,
    );
    const games = relevant.flatMap((series) => series.games);
    return buildDuelStanding({
      competitorId: entrant.competitorId,
      gameWins: games.filter(
        (game) => game.winnerCompetitorId === entrant.competitorId,
      ).length,
      gameLosses: games.filter(
        (game) =>
          game.resultState === "verified" &&
          game.winnerCompetitorId !== entrant.competitorId,
      ).length,
      seriesWins: relevant.filter(
        (series) => series.winnerCompetitorId === entrant.competitorId,
      ).length,
      seriesLosses: relevant.filter(
        (series) =>
          series.seriesState === "completed" &&
          series.winnerCompetitorId !== entrant.competitorId,
      ).length,
      streak: 0,
    });
  });
  if (event.format !== "round_robin") return { standings, ranks: null };
  const results = latestRoundRobinResults(event.series);
  return {
    standings,
    ranks: rankRoundRobin(
      event.entrants.map((entrant) => entrant.competitorId),
      results,
    ),
  };
}

export async function getRollingDuelRecords(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  scope: "individual" | "pair",
) {
  const [records, competitors] = await Promise.all([
    db.duelRecord.findMany({
      where: { guildId, scope, opponentKey: "" },
      orderBy: [{ wins: "desc" }, { games: "desc" }, { subjectKey: "asc" }],
    }),
    db.duelCompetitor.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
      include: { members: true },
    }),
  ]);
  const labels = new Map<string, string>();
  for (const competitor of competitors) {
    const members = competitor.members.toSorted(
      (left, right) => left.position - right.position,
    );
    for (const member of members) {
      const key = `player:${member.playerId.toString()}`;
      if (!labels.has(key)) labels.set(key, member.playerAlias);
    }
    if (members.length === 2) {
      const pairKey = `pair:${members
        .map((member) => member.playerId)
        .toSorted((left, right) => left - right)
        .map(String)
        .join("+")}`;
      if (!labels.has(pairKey)) {
        labels.set(
          pairKey,
          competitor.teamName ??
            members.map((member) => member.playerAlias).join(" + "),
        );
      }
    }
  }
  return records.map((record) => ({
    subjectKey: record.subjectKey,
    label: labels.get(record.subjectKey) ?? record.subjectKey,
    games: record.games,
    series: record.series,
    wins: record.wins,
    losses: record.losses,
    seriesWins: record.seriesWins,
    seriesLosses: record.seriesLosses,
    winRate: record.games === 0 ? null : record.wins / record.games,
    placed: record.games >= 5,
    streak: record.streak,
  }));
}

export async function getDuelHeadToHead(
  db: ExtendedPrismaClient,
  options: {
    readonly guildId: DiscordGuildId;
    readonly scope: "individual" | "pair";
    readonly firstSubjectKey: string;
    readonly secondSubjectKey: string;
  },
) {
  const recordScope =
    options.scope === "individual"
      ? "head_to_head_individual"
      : "head_to_head_pair";
  const [first, second] = await Promise.all([
    db.duelRecord.findUnique({
      where: {
        guildId_scope_subjectKey_opponentKey: {
          guildId: options.guildId,
          scope: recordScope,
          subjectKey: options.firstSubjectKey,
          opponentKey: options.secondSubjectKey,
        },
      },
    }),
    db.duelRecord.findUnique({
      where: {
        guildId_scope_subjectKey_opponentKey: {
          guildId: options.guildId,
          scope: recordScope,
          subjectKey: options.secondSubjectKey,
          opponentKey: options.firstSubjectKey,
        },
      },
    }),
  ]);
  return { first, second };
}
