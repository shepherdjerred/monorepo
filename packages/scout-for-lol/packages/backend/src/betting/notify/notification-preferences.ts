import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export type BucksNotificationPreferences = {
  ownBetSettlementDms: boolean;
  betsOnPlayerSettlementDms: boolean;
  dareLifecycleDms: boolean;
  dareProgressDms: boolean;
  settlementDmHintShownAt: Date | null;
};

export type BucksNotificationPreferenceUpdates = {
  ownBetSettlementDms?: boolean;
  betsOnPlayerSettlementDms?: boolean;
  dareLifecycleDms?: boolean;
  dareProgressDms?: boolean;
};

const DEFAULT_PREFERENCES: BucksNotificationPreferences = {
  ownBetSettlementDms: true,
  betsOnPlayerSettlementDms: true,
  dareLifecycleDms: true,
  dareProgressDms: true,
  settlementDmHintShownAt: null,
};

function parseIds(input: { serverId: string; discordIds: readonly string[] }): {
  serverId: DiscordGuildId;
  discordIds: DiscordAccountId[];
} {
  return {
    serverId: DiscordGuildIdSchema.parse(input.serverId),
    discordIds: input.discordIds.map((discordId) =>
      DiscordAccountIdSchema.parse(discordId),
    ),
  };
}

function preferencesFromRow(
  row: {
    ownBetSettlementDms: boolean;
    betsOnPlayerSettlementDms: boolean;
    dareLifecycleDms: boolean;
    dareProgressDms: boolean;
    settlementDmHintShownAt: Date | null;
  } | null,
): BucksNotificationPreferences {
  return row === null
    ? { ...DEFAULT_PREFERENCES }
    : {
        ownBetSettlementDms: row.ownBetSettlementDms,
        betsOnPlayerSettlementDms: row.betsOnPlayerSettlementDms,
        dareLifecycleDms: row.dareLifecycleDms,
        dareProgressDms: row.dareProgressDms,
        settlementDmHintShownAt: row.settlementDmHintShownAt,
      };
}

export async function getBucksNotificationPreferences(
  input: { serverId: string; discordId: string },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BucksNotificationPreferences> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  const discordId = DiscordAccountIdSchema.parse(input.discordId);
  const row = await prismaClient.bucksNotificationPreference.findUnique({
    where: { serverId_discordId: { serverId, discordId } },
    select: {
      ownBetSettlementDms: true,
      betsOnPlayerSettlementDms: true,
      dareLifecycleDms: true,
      dareProgressDms: true,
      settlementDmHintShownAt: true,
    },
  });
  return preferencesFromRow(row);
}

export async function getBucksNotificationPreferencesForUsers(
  input: { serverId: string; discordIds: readonly string[] },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<ReadonlyMap<string, BucksNotificationPreferences>> {
  const { serverId, discordIds } = parseIds(input);
  if (discordIds.length === 0) {
    return new Map();
  }

  const rows = await prismaClient.bucksNotificationPreference.findMany({
    where: { serverId, discordId: { in: discordIds } },
    select: {
      discordId: true,
      ownBetSettlementDms: true,
      betsOnPlayerSettlementDms: true,
      dareLifecycleDms: true,
      dareProgressDms: true,
      settlementDmHintShownAt: true,
    },
  });
  return new Map(rows.map((row) => [row.discordId, preferencesFromRow(row)]));
}

export async function updateBucksNotificationPreferences(
  input: {
    serverId: string;
    discordId: string;
    updates: BucksNotificationPreferenceUpdates;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BucksNotificationPreferences> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  const discordId = DiscordAccountIdSchema.parse(input.discordId);
  if (
    input.updates.ownBetSettlementDms === undefined &&
    input.updates.betsOnPlayerSettlementDms === undefined &&
    input.updates.dareLifecycleDms === undefined &&
    input.updates.dareProgressDms === undefined
  ) {
    return await getBucksNotificationPreferences(
      { serverId, discordId },
      prismaClient,
    );
  }

  const row = await prismaClient.bucksNotificationPreference.upsert({
    where: { serverId_discordId: { serverId, discordId } },
    create: {
      serverId,
      discordId,
      ownBetSettlementDms: input.updates.ownBetSettlementDms ?? true,
      betsOnPlayerSettlementDms:
        input.updates.betsOnPlayerSettlementDms ?? true,
      dareLifecycleDms: input.updates.dareLifecycleDms ?? true,
      dareProgressDms: input.updates.dareProgressDms ?? true,
    },
    update: {
      ...(input.updates.ownBetSettlementDms === undefined
        ? {}
        : { ownBetSettlementDms: input.updates.ownBetSettlementDms }),
      ...(input.updates.betsOnPlayerSettlementDms === undefined
        ? {}
        : {
            betsOnPlayerSettlementDms: input.updates.betsOnPlayerSettlementDms,
          }),
      ...(input.updates.dareLifecycleDms === undefined
        ? {}
        : { dareLifecycleDms: input.updates.dareLifecycleDms }),
      ...(input.updates.dareProgressDms === undefined
        ? {}
        : { dareProgressDms: input.updates.dareProgressDms }),
    },
    select: {
      ownBetSettlementDms: true,
      betsOnPlayerSettlementDms: true,
      dareLifecycleDms: true,
      dareProgressDms: true,
      settlementDmHintShownAt: true,
    },
  });
  return preferencesFromRow(row);
}

export async function markBucksSettlementDmHintShown(
  input: { serverId: string; discordId: string },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  const discordId = DiscordAccountIdSchema.parse(input.discordId);
  await prismaClient.bucksNotificationPreference.upsert({
    where: { serverId_discordId: { serverId, discordId } },
    create: {
      serverId,
      discordId,
      ownBetSettlementDms: true,
      betsOnPlayerSettlementDms: true,
      dareLifecycleDms: true,
      dareProgressDms: true,
      settlementDmHintShownAt: new Date(),
    },
    update: { settlementDmHintShownAt: new Date() },
    select: { id: true },
  });
}
