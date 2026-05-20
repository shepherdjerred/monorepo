import type {
  LeaguePuuid,
  RawCurrentGameInfo,
  RawCurrentGameParticipant,
  RawMatch,
  RawParticipant,
  RawTimeline,
} from "@scout-for-lol/data";
import { LeaguePuuidSchema, parseQueueType } from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export type StoredPayloadOptions = {
  s3Key?: string;
  importedFromS3?: boolean;
};

type AccountWithPlayer = Prisma.AccountGetPayload<{
  include: {
    player: true;
  };
}>;

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function toDate(timestampMs: number): Date {
  return new Date(timestampMs);
}

function participantKda(participant: RawParticipant): number {
  const takedowns = participant.kills + participant.assists;
  return participant.deaths === 0 ? takedowns : takedowns / participant.deaths;
}

function participantCreepScore(participant: RawParticipant): number {
  return participant.totalMinionsKilled + participant.neutralMinionsKilled;
}

function participantSurrendered(participant: RawParticipant): boolean {
  return participant.gameEndedInSurrender || participant.teamEarlySurrendered;
}

function participantEarlySurrendered(participant: RawParticipant): boolean {
  return (
    participant.gameEndedInEarlySurrender || participant.teamEarlySurrendered
  );
}

async function findTrackedAccounts(
  prisma: ExtendedPrismaClient,
  puuids: LeaguePuuid[],
): Promise<AccountWithPlayer[]> {
  return await prisma.account.findMany({
    where: {
      puuid: {
        in: puuids,
      },
    },
    include: {
      player: true,
    },
  });
}

function accountsByPuuid(
  accounts: AccountWithPlayer[],
): Map<LeaguePuuid, AccountWithPlayer[]> {
  const result = new Map<LeaguePuuid, AccountWithPlayer[]>();
  for (const account of accounts) {
    const existing = result.get(account.puuid) ?? [];
    existing.push(account);
    result.set(account.puuid, existing);
  }
  return result;
}

export async function upsertStoredMatchWithFacts(
  prisma: ExtendedPrismaClient,
  match: RawMatch,
  options: StoredPayloadOptions = {},
): Promise<{ stored: boolean; factCount: number }> {
  const queue = parseQueueType(match.info.queueId);
  const matchId = match.metadata.matchId;
  const importedFromS3 = options.importedFromS3 ?? false;

  await prisma.storedMatch.upsert({
    where: { matchId },
    create: {
      matchId,
      gameId: match.info.gameId.toString(),
      platformId: match.info.platformId,
      queueId: match.info.queueId,
      queue: queue ?? null,
      gameMode: match.info.gameMode,
      gameType: match.info.gameType,
      gameVersion: match.info.gameVersion,
      gameCreationAt: toDate(match.info.gameCreation),
      gameStartAt: toDate(match.info.gameStartTimestamp),
      gameEndAt: toDate(match.info.gameEndTimestamp),
      durationSeconds: match.info.gameDuration,
      participantPuuidsJson: toJson(match.metadata.participants),
      rawJson: toJson(match),
      s3Key: options.s3Key ?? null,
      importedFromS3,
    },
    update: {
      gameId: match.info.gameId.toString(),
      platformId: match.info.platformId,
      queueId: match.info.queueId,
      queue: queue ?? null,
      gameMode: match.info.gameMode,
      gameType: match.info.gameType,
      gameVersion: match.info.gameVersion,
      gameCreationAt: toDate(match.info.gameCreation),
      gameStartAt: toDate(match.info.gameStartTimestamp),
      gameEndAt: toDate(match.info.gameEndTimestamp),
      durationSeconds: match.info.gameDuration,
      participantPuuidsJson: toJson(match.metadata.participants),
      rawJson: toJson(match),
      s3Key: options.s3Key ?? null,
      importedFromS3,
    },
  });

  const matchParticipantPuuids = match.metadata.participants.map((puuid) =>
    LeaguePuuidSchema.parse(puuid),
  );
  const trackedAccounts = await findTrackedAccounts(
    prisma,
    matchParticipantPuuids,
  );
  const accountLookup = accountsByPuuid(trackedAccounts);
  let factCount = 0;

  for (const participant of match.info.participants) {
    const puuid = LeaguePuuidSchema.parse(participant.puuid);
    const matchingAccounts = accountLookup.get(puuid) ?? [];
    for (const account of matchingAccounts) {
      await prisma.matchParticipantFact.upsert({
        where: {
          serverId_matchId_puuid: {
            serverId: account.serverId,
            matchId,
            puuid,
          },
        },
        create: {
          serverId: account.serverId,
          matchId,
          gameId: match.info.gameId.toString(),
          gameCreationAt: toDate(match.info.gameCreation),
          gameEndAt: toDate(match.info.gameEndTimestamp),
          queueId: match.info.queueId,
          queue: queue ?? null,
          durationSeconds: match.info.gameDuration,
          playerId: account.player.id,
          accountId: account.id,
          playerAlias: account.player.alias,
          discordId: account.player.discordId,
          puuid,
          region: account.region,
          participantId: participant.participantId,
          teamId: participant.teamId,
          championId: participant.championId,
          championName: participant.championName,
          win: participant.win,
          surrendered: participantSurrendered(participant),
          earlySurrendered: participantEarlySurrendered(participant),
          kills: participant.kills,
          deaths: participant.deaths,
          assists: participant.assists,
          kda: participantKda(participant),
          creepScore: participantCreepScore(participant),
          goldEarned: participant.goldEarned,
          totalDamageDealt: participant.totalDamageDealt,
          damageToChampions: participant.totalDamageDealtToChampions,
          damageTaken: participant.totalDamageTaken,
          visionScore: participant.visionScore,
          rawParticipantJson: toJson(participant),
        },
        update: {
          gameId: match.info.gameId.toString(),
          gameCreationAt: toDate(match.info.gameCreation),
          gameEndAt: toDate(match.info.gameEndTimestamp),
          queueId: match.info.queueId,
          queue: queue ?? null,
          durationSeconds: match.info.gameDuration,
          playerId: account.player.id,
          accountId: account.id,
          playerAlias: account.player.alias,
          discordId: account.player.discordId,
          region: account.region,
          participantId: participant.participantId,
          teamId: participant.teamId,
          championId: participant.championId,
          championName: participant.championName,
          win: participant.win,
          surrendered: participantSurrendered(participant),
          earlySurrendered: participantEarlySurrendered(participant),
          kills: participant.kills,
          deaths: participant.deaths,
          assists: participant.assists,
          kda: participantKda(participant),
          creepScore: participantCreepScore(participant),
          goldEarned: participant.goldEarned,
          totalDamageDealt: participant.totalDamageDealt,
          damageToChampions: participant.totalDamageDealtToChampions,
          damageTaken: participant.totalDamageTaken,
          visionScore: participant.visionScore,
          rawParticipantJson: toJson(participant),
        },
      });
      factCount++;
    }
  }

  return { stored: true, factCount };
}

export async function upsertStoredTimeline(
  prisma: ExtendedPrismaClient,
  timeline: RawTimeline,
  options: StoredPayloadOptions = {},
): Promise<void> {
  const matchId = timeline.metadata.matchId;
  const importedFromS3 = options.importedFromS3 ?? false;

  await prisma.storedMatchTimeline.upsert({
    where: { matchId },
    create: {
      matchId,
      rawJson: toJson(timeline),
      s3Key: options.s3Key ?? null,
      importedFromS3,
    },
    update: {
      rawJson: toJson(timeline),
      s3Key: options.s3Key ?? null,
      importedFromS3,
    },
  });
}

function participantPuuids(gameInfo: RawCurrentGameInfo): LeaguePuuid[] {
  return gameInfo.participants.flatMap((participant) =>
    participant.puuid === null
      ? []
      : [LeaguePuuidSchema.parse(participant.puuid)],
  );
}

export async function upsertStoredPrematchWithFacts(
  prisma: ExtendedPrismaClient,
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
  options: StoredPayloadOptions = {},
): Promise<{ storedPrematchId: number; factCount: number }> {
  const queue = parseQueueType(gameInfo.gameQueueConfigId);
  const importedFromS3 = options.importedFromS3 ?? false;
  const gameStartAt =
    gameInfo.gameStartTime > 0 ? toDate(gameInfo.gameStartTime) : undefined;
  const puuids = participantPuuids(gameInfo);
  const dedupeKey = `${gameInfo.gameId.toString()}:${observedAt.getTime().toString()}`;

  const storedPrematch = await prisma.storedPrematch.upsert({
    where: {
      dedupeKey,
    },
    create: {
      dedupeKey,
      gameId: gameInfo.gameId.toString(),
      gameStartAt: gameStartAt ?? null,
      observedAt,
      platformId: gameInfo.platformId,
      queueId: gameInfo.gameQueueConfigId,
      queue: queue ?? null,
      gameMode: gameInfo.gameMode,
      gameType: gameInfo.gameType,
      participantPuuidsJson: toJson(puuids),
      rawJson: toJson(gameInfo),
      s3Key: options.s3Key ?? null,
      importedFromS3,
    },
    update: {
      gameStartAt: gameStartAt ?? null,
      platformId: gameInfo.platformId,
      queueId: gameInfo.gameQueueConfigId,
      queue: queue ?? null,
      gameMode: gameInfo.gameMode,
      gameType: gameInfo.gameType,
      participantPuuidsJson: toJson(puuids),
      rawJson: toJson(gameInfo),
      s3Key: options.s3Key ?? null,
      importedFromS3,
    },
  });

  const trackedAccounts = await findTrackedAccounts(prisma, puuids);
  const accountLookup = accountsByPuuid(trackedAccounts);
  let factCount = 0;

  for (const participant of gameInfo.participants) {
    if (participant.puuid === null) {
      continue;
    }

    const puuid = LeaguePuuidSchema.parse(participant.puuid);
    const matchingAccounts = accountLookup.get(puuid) ?? [];
    for (const account of matchingAccounts) {
      await prisma.prematchParticipantFact.upsert({
        where: {
          storedPrematchId_serverId_puuid: {
            storedPrematchId: storedPrematch.id,
            serverId: account.serverId,
            puuid,
          },
        },
        create: prematchParticipantCreateData({
          account,
          gameInfo,
          gameStartAt,
          observedAt,
          participant,
          puuid,
          queue,
          storedPrematchId: storedPrematch.id,
        }),
        update: prematchParticipantUpdateData({
          account,
          gameInfo,
          gameStartAt,
          observedAt,
          participant,
          puuid,
          queue,
        }),
      });
      factCount++;
    }
  }

  return { storedPrematchId: storedPrematch.id, factCount };
}

type PrematchParticipantParams = {
  account: AccountWithPlayer;
  gameInfo: RawCurrentGameInfo;
  gameStartAt: Date | undefined;
  observedAt: Date;
  participant: RawCurrentGameParticipant;
  puuid: LeaguePuuid;
  queue: string | undefined;
};

function prematchParticipantCreateData(
  params: PrematchParticipantParams & { storedPrematchId: number },
) {
  return {
    ...prematchParticipantUpdateData(params),
    storedPrematchId: params.storedPrematchId,
    serverId: params.account.serverId,
    gameId: params.gameInfo.gameId.toString(),
    puuid: params.puuid,
  };
}

function prematchParticipantUpdateData(params: PrematchParticipantParams) {
  return {
    observedAt: params.observedAt,
    gameStartAt: params.gameStartAt ?? null,
    queueId: params.gameInfo.gameQueueConfigId,
    queue: params.queue ?? null,
    gameMode: params.gameInfo.gameMode,
    playerId: params.account.player.id,
    accountId: params.account.id,
    playerAlias: params.account.player.alias,
    discordId: params.account.player.discordId,
    region: params.account.region,
    teamId: params.participant.teamId,
    playerSubteamId: params.participant.playerSubteamId ?? null,
    championId: params.participant.championId,
    riotId: params.participant.riotId,
    summonerName: params.participant.summonerName ?? null,
    selectedSkinIndex: params.participant.lastSelectedSkinIndex,
    rawParticipantJson: toJson(params.participant),
  };
}
