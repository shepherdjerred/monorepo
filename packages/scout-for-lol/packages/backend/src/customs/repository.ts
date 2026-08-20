import {
  AccountIdSchema,
  CustomGameSnapshotSchema,
  CustomNightSnapshotSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
  type CustomGameParticipant,
  type CustomGameSnapshot,
  type CustomNightParticipant,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export type CustomTransactionClient = Pick<
  ExtendedPrismaClient,
  | "customNightParticipant"
  | "customGame"
  | "customGameParticipant"
  | "customConsent"
  | "customAuditEvent"
>;
import { parseCustomNightSnapshot } from "#src/customs/snapshot.ts";

export type CustomMutationResult = {
  applied: boolean;
  snapshot: CustomNightSnapshot;
};

function nightParticipantData(participant: CustomNightParticipant) {
  return {
    displayName: participant.displayName,
    avatarUrl: participant.avatarUrl,
    role: participant.role,
    availability: participant.availability,
    readyAt:
      participant.readyAt === null ? null : new Date(participant.readyAt),
    awayUntil:
      participant.awayUntil === null ? null : new Date(participant.awayUntil),
    awayOverdue: participant.awayOverdue,
    held: participant.held,
    consentedAt: new Date(participant.consentedAt),
    playerId:
      participant.playerId === null
        ? null
        : PlayerIdSchema.parse(participant.playerId),
    playerAlias: participant.playerAlias,
    accountsSnapshot: JSON.stringify(participant.accounts),
    selectedAccountId:
      participant.selectedAccountId === null
        ? null
        : AccountIdSchema.parse(participant.selectedAccountId),
  };
}

function gameParticipantData(participant: CustomGameParticipant) {
  return {
    displayName: participant.displayName,
    playerId: PlayerIdSchema.parse(participant.playerId),
    playerAlias: participant.playerAlias,
    accountId: AccountIdSchema.parse(participant.accountId),
    puuid: LeaguePuuidSchema.parse(participant.puuid),
    riotGameName: participant.riotGameName,
    riotTagLine: participant.riotTagLine,
    rosterOrder: participant.rosterOrder,
    benchOrder: participant.benchOrder,
    team: participant.team,
    side: participant.side,
    captain: participant.captain,
    pickOrder: participant.pickOrder,
    championId: participant.championId,
    won: participant.won,
  };
}

async function persistParticipants(
  transaction: CustomTransactionClient,
  snapshot: CustomNightSnapshot,
): Promise<void> {
  const participantDiscordIds = snapshot.participants.map((participant) =>
    DiscordAccountIdSchema.parse(participant.discordId),
  );
  await transaction.customNightParticipant.deleteMany({
    where:
      participantDiscordIds.length === 0
        ? { nightId: snapshot.id }
        : {
            nightId: snapshot.id,
            discordId: { notIn: participantDiscordIds },
          },
  });
  for (const participant of snapshot.participants) {
    await transaction.customNightParticipant.upsert({
      where: {
        nightId_discordId: {
          nightId: snapshot.id,
          discordId: DiscordAccountIdSchema.parse(participant.discordId),
        },
      },
      create: {
        nightId: snapshot.id,
        discordId: DiscordAccountIdSchema.parse(participant.discordId),
        ...nightParticipantData(participant),
      },
      update: nightParticipantData(participant),
    });
  }
}

async function persistGame(
  transaction: CustomTransactionClient,
  nightId: string,
  game: CustomGameSnapshot,
): Promise<void> {
  const parsedGame = CustomGameSnapshotSchema.parse(game);
  await transaction.customGame.upsert({
    where: { id: parsedGame.id },
    create: {
      id: parsedGame.id,
      nightId,
      sequence: parsedGame.sequence,
      state: parsedGame.state,
      rosterMode: parsedGame.rosterMode,
      map: parsedGame.map,
      pickMode: parsedGame.pickMode,
      snapshot: JSON.stringify(parsedGame),
      activeCaptain: parsedGame.activeCaptain,
      tournamentCode: parsedGame.tournamentCode,
      riotMatchId: parsedGame.riotMatchId,
      winner: parsedGame.winner,
      resultSource: parsedGame.resultSource,
      resultDisagreement: parsedGame.resultDisagreement,
      voiceReady: parsedGame.voiceReady,
      voiceOverride: parsedGame.voiceOverride,
      voiceError: parsedGame.voiceError,
      startedAt:
        parsedGame.startedAt === null ? null : new Date(parsedGame.startedAt),
      completedAt:
        parsedGame.completedAt === null
          ? null
          : new Date(parsedGame.completedAt),
    },
    update: {
      state: parsedGame.state,
      snapshot: JSON.stringify(parsedGame),
      activeCaptain: parsedGame.activeCaptain,
      tournamentCode: parsedGame.tournamentCode,
      riotMatchId: parsedGame.riotMatchId,
      winner: parsedGame.winner,
      resultSource: parsedGame.resultSource,
      resultDisagreement: parsedGame.resultDisagreement,
      voiceReady: parsedGame.voiceReady,
      voiceOverride: parsedGame.voiceOverride,
      voiceError: parsedGame.voiceError,
      startedAt:
        parsedGame.startedAt === null ? null : new Date(parsedGame.startedAt),
      completedAt:
        parsedGame.completedAt === null
          ? null
          : new Date(parsedGame.completedAt),
    },
  });
  const participantDiscordIds = parsedGame.participants.map((participant) =>
    DiscordAccountIdSchema.parse(participant.discordId),
  );
  await transaction.customGameParticipant.deleteMany({
    where:
      participantDiscordIds.length === 0
        ? { gameId: parsedGame.id }
        : {
            gameId: parsedGame.id,
            discordId: { notIn: participantDiscordIds },
          },
  });
  for (const participant of parsedGame.participants) {
    await transaction.customGameParticipant.upsert({
      where: {
        gameId_discordId: {
          gameId: parsedGame.id,
          discordId: DiscordAccountIdSchema.parse(participant.discordId),
        },
      },
      create: {
        gameId: parsedGame.id,
        discordId: DiscordAccountIdSchema.parse(participant.discordId),
        ...gameParticipantData(participant),
      },
      update: gameParticipantData(participant),
    });
  }
}

export async function getCustomNight(
  prisma: ExtendedPrismaClient,
  nightId: string,
): Promise<CustomNightSnapshot | null> {
  const night = await prisma.customNight.findUnique({ where: { id: nightId } });
  return night === null ? null : parseCustomNightSnapshot(night.snapshot);
}

export async function getActiveCustomNight(
  prisma: ExtendedPrismaClient,
  guildId: string,
): Promise<CustomNightSnapshot | null> {
  const pointer = await prisma.customActiveNight.findUnique({
    where: { guildId: DiscordGuildIdSchema.parse(guildId) },
    include: { night: true },
  });
  return pointer === null
    ? null
    : parseCustomNightSnapshot(pointer.night.snapshot);
}

export async function commitCustomMutation(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
  expectedRevision: number;
  actorDiscordId: string;
  action: string;
  payload: unknown;
  update: (snapshot: CustomNightSnapshot) => CustomNightSnapshot;
  sideEffect?: (
    transaction: CustomTransactionClient,
    snapshot: CustomNightSnapshot,
  ) => Promise<void>;
  additionalGames?: readonly CustomGameSnapshot[];
  auditGameId?: string;
  allowEnded?: boolean;
}): Promise<CustomMutationResult> {
  return await params.prisma.$transaction(async (transaction) => {
    const row = await transaction.customNight.findUnique({
      where: { id: params.nightId },
    });
    if (row === null) throw new Error("Custom night not found");
    const current = parseCustomNightSnapshot(row.snapshot);
    if (current.revision !== params.expectedRevision)
      return { applied: false, snapshot: current };
    if (current.state === "ENDED" && params.allowEnded !== true)
      throw new Error("Custom night has ended and cannot be changed");

    const updated = CustomNightSnapshotSchema.parse({
      ...params.update(current),
      revision: current.revision + 1,
    });
    const claimed = await transaction.customNight.updateMany({
      where: { id: params.nightId, revision: params.expectedRevision },
      data: {
        state: updated.state,
        revision: updated.revision,
        snapshot: JSON.stringify(updated),
        cohostDiscordIds: JSON.stringify(updated.cohostDiscordIds),
        recruitmentMessageId: updated.recruitmentMessageId,
        riotTournamentId: updated.riotTournamentId,
        teamAVoiceChannelId: updated.teamAVoiceChannelId,
        teamBVoiceChannelId: updated.teamBVoiceChannelId,
        currentGameId: updated.currentGame?.id ?? null,
        lastActivityAt: new Date(updated.lastActivityAt),
        expiresAt: new Date(updated.expiresAt),
        endedAt: updated.endedAt === null ? null : new Date(updated.endedAt),
      },
    });
    if (claimed.count !== 1) {
      const newest = await transaction.customNight.findUnique({
        where: { id: params.nightId },
      });
      if (newest === null)
        throw new Error("Custom night disappeared during mutation");
      return {
        applied: false,
        snapshot: parseCustomNightSnapshot(newest.snapshot),
      };
    }
    await persistParticipants(transaction, updated);
    if (updated.currentGame !== null)
      await persistGame(transaction, updated.id, updated.currentGame);
    for (const game of params.additionalGames ?? [])
      await persistGame(transaction, updated.id, game);
    await params.sideEffect?.(transaction, updated);
    await transaction.customAuditEvent.create({
      data: {
        nightId: updated.id,
        gameId: params.auditGameId ?? updated.currentGame?.id ?? null,
        revision: updated.revision,
        actorId: params.actorDiscordId,
        action: params.action,
        payload: JSON.stringify(params.payload),
      },
    });
    if (updated.state === "ENDED" && current.state !== "ENDED") {
      await transaction.customActiveNight.delete({
        where: { guildId: DiscordGuildIdSchema.parse(updated.guildId) },
      });
    }
    return { applied: true, snapshot: updated };
  });
}
