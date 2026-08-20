import {
  CustomGameSnapshotSchema,
  CustomNightSnapshotSchema,
  MatchIdSchema,
  type RawMatch,
  type CustomGameParticipant,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  commitCustomMutation,
  getCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import { recruitmentCounts } from "#src/customs/snapshot.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { getChampionDisplayName } from "#src/utils/champion.ts";

export class TerminalCustomMatchImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalCustomMatchImportError";
  }
}

function enrichedParticipants(
  participants: readonly CustomGameParticipant[],
  matchParticipants: readonly {
    puuid: string;
    championId: number;
    win: boolean;
  }[],
): CustomGameParticipant[] {
  return participants.map((participant) => {
    const matchParticipant = matchParticipants.find(
      (candidate) => candidate.puuid === participant.puuid,
    );
    if (matchParticipant === undefined)
      throw new TerminalCustomMatchImportError(
        `${participant.displayName} is absent from Match-V5 data`,
      );
    return {
      ...participant,
      championId: matchParticipant.championId,
      won: matchParticipant.win,
    };
  });
}

function repeatWarnings(
  participants: readonly CustomGameParticipant[],
  previous: readonly CustomGameParticipant[],
): string[] {
  const warnings: string[] = [];
  for (const participant of participants) {
    const prior = previous.find(
      (candidate) => candidate.discordId === participant.discordId,
    );
    if (
      prior?.championId !== null &&
      prior?.championId !== undefined &&
      prior.championId === participant.championId
    ) {
      warnings.push(
        `${participant.displayName} repeated ${getChampionDisplayName(prior.championId)} from the immediately preceding game.`,
      );
    }
  }
  return warnings;
}

async function importHistoricalGame(params: {
  prisma: ExtendedPrismaClient;
  night: CustomNightSnapshot;
  gameId: string;
  gameSnapshot: ReturnType<typeof CustomGameSnapshotSchema.parse>;
  participants: CustomGameParticipant[];
  warnings: string[];
  match: RawMatch;
}): Promise<void> {
  await params.prisma.$transaction(async (transaction) => {
    const claimed = await transaction.customGame.updateMany({
      where: { id: params.gameId, importedAt: null, importError: null },
      data: {
        importedAt: new Date(),
        importError: null,
        matchSnapshot: JSON.stringify(params.match),
        snapshot: JSON.stringify({
          ...params.gameSnapshot,
          participants: params.participants,
          repeatChampionWarnings: params.warnings,
        }),
      },
    });
    if (claimed.count === 0) return;
    for (const participant of params.participants) {
      await transaction.customGameParticipant.update({
        where: {
          gameId_discordId: {
            gameId: params.gameId,
            discordId: participant.discordId,
          },
        },
        data: { championId: participant.championId, won: participant.won },
      });
    }
    await transaction.customAuditEvent.create({
      data: {
        nightId: params.night.id,
        gameId: params.gameId,
        revision: params.night.revision,
        actorId: "SCOUT",
        action: "MATCH_V5_IMPORTED",
        payload: JSON.stringify({ repeatChampionWarnings: params.warnings }),
        source: "RIOT",
      },
    });
  });
}

export async function importCustomMatchDetails(params: {
  prisma: ExtendedPrismaClient;
  gameId: string;
  fetcher?: typeof fetchMatchData;
}): Promise<CustomMutationResult | null> {
  const row = await params.prisma.customGame.findUnique({
    where: { id: params.gameId },
  });
  if (
    row?.riotMatchId === undefined ||
    row.riotMatchId === null ||
    row.importedAt !== null ||
    row.importError !== null
  )
    return null;
  const gameSnapshot = CustomGameSnapshotSchema.parse(JSON.parse(row.snapshot));
  const match = await (params.fetcher ?? fetchMatchData)(
    MatchIdSchema.parse(row.riotMatchId),
    "AMERICA_NORTH",
  );
  if (match === undefined) return null;
  if (
    gameSnapshot.tournamentCode !== null &&
    match.info.tournamentCode !== gameSnapshot.tournamentCode
  ) {
    throw new TerminalCustomMatchImportError(
      "Match-V5 Tournament code does not match the custom game",
    );
  }
  const participants = enrichedParticipants(
    gameSnapshot.participants,
    match.info.participants,
  );
  const previousRow = await params.prisma.customGame.findUnique({
    where: {
      nightId_sequence: {
        nightId: row.nightId,
        sequence: row.sequence - 1,
      },
    },
  });
  if (
    previousRow !== null &&
    previousRow.importedAt === null &&
    previousRow.importError === null
  )
    return null;
  const previousParticipants =
    previousRow === null
      ? []
      : CustomGameSnapshotSchema.parse(JSON.parse(previousRow.snapshot))
          .participants;
  const warnings = repeatWarnings(participants, previousParticipants);
  const night = await getCustomNight(params.prisma, row.nightId);
  if (night === null) throw new Error("Custom night not found during import");
  if (night.state === "ENDED" || night.currentGame?.id !== params.gameId) {
    await importHistoricalGame({
      prisma: params.prisma,
      night,
      gameId: params.gameId,
      gameSnapshot,
      participants,
      warnings,
      match,
    });
    return null;
  }
  return await commitCustomMutation({
    prisma: params.prisma,
    nightId: night.id,
    expectedRevision: night.revision,
    actorDiscordId: "SCOUT",
    action: "MATCH_V5_IMPORTED",
    payload: { repeatChampionWarnings: warnings },
    update: (snapshot) => {
      if (snapshot.currentGame?.id !== params.gameId)
        throw new Error("Current custom game changed during Match-V5 import");
      return CustomNightSnapshotSchema.parse({
        ...snapshot,
        recruitmentCounts: recruitmentCounts(snapshot.participants),
        currentGame: {
          ...snapshot.currentGame,
          participants,
          repeatChampionWarnings: warnings,
        },
      });
    },
    sideEffect: async (transaction) => {
      const claimed = await transaction.customGame.updateMany({
        where: { id: params.gameId, importedAt: null, importError: null },
        data: {
          importedAt: new Date(),
          matchSnapshot: JSON.stringify(match),
          importError: null,
        },
      });
      if (claimed.count !== 1)
        throw new Error("Custom game import was already recorded");
    },
  });
}

export async function recordTerminalCustomMatchImportFailure(params: {
  prisma: ExtendedPrismaClient;
  gameId: string;
  error: TerminalCustomMatchImportError;
}): Promise<void> {
  const message = params.error.message;
  await params.prisma.$transaction(async (transaction) => {
    const game = await transaction.customGame.findUnique({
      where: { id: params.gameId },
      select: { nightId: true, night: { select: { revision: true } } },
    });
    if (game === null)
      throw new Error("Custom game not found during import failure recording");
    const claimed = await transaction.customGame.updateMany({
      where: {
        id: params.gameId,
        importedAt: null,
        importError: null,
      },
      data: { importError: message },
    });
    if (claimed.count !== 1) return;
    await transaction.customAuditEvent.create({
      data: {
        nightId: game.nightId,
        gameId: params.gameId,
        revision: game.night.revision,
        actorId: "SCOUT",
        action: "MATCH_V5_IMPORT_FAILED",
        payload: JSON.stringify({ error: message }),
        source: "RIOT",
      },
    });
  });
}
