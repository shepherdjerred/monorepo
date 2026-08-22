/**
 * One entry per Prisma model, in FK-safe topological order across the part
 * files (concatenated by run-import.ts). Authored via one-time codegen from
 * schema.prisma, maintained by hand: each transform is typed as the model's
 * branded CreateManyInput, so adding a model or column — or changing a
 * brand in scripts/brand-prisma-types.ts — without updating these maps is a
 * compile error here.
 */
import type { Prisma } from "#generated/prisma/client/index.js";
import {
  DesktopClientIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
  SubscriptionIdSchema,
} from "@scout-for-lol/data";
import {
  defineImportModel,
  toBool,
  toBoolOrNull,
  toDate,
  toDateOrNull,
  toInt,
  toIntOrNull,
  toStr,
  toStrOrNull,
  type ImportModelSpec,
} from "#src/database/legacy-import/convert.ts";

export const IMPORT_MODELS_PART_3: ImportModelSpec[] = [
  defineImportModel({
    model: "BucksAccount",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.BucksAccountCreateManyInput => ({
      id: toInt(row, "id"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      discordId: DiscordAccountIdSchema.parse(toStr(row, "discordId")),
      isHouse: toBool(row, "isHouse"),
      balance: toInt(row, "balance"),
      peekPassExpiresAt: toDateOrNull(row, "peekPassExpiresAt"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksAccount.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksAccount.count(),
    findAll: (tx) => tx.bucksAccount.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BucksMatchPool",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.BucksMatchPoolCreateManyInput => ({
      id: toInt(row, "id"),
      matchId: toStr(row, "matchId"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      detectedAt: toDate(row, "detectedAt"),
      peekAvailableAt: toDate(row, "peekAvailableAt"),
      closesAt: toDate(row, "closesAt"),
      queueType: toStrOrNull(row, "queueType"),
      roster: toStr(row, "roster"),
      messageRefs: toStr(row, "messageRefs"),
      prematchContentBase: toStrOrNull(row, "prematchContentBase"),
      poolState: toStr(row, "poolState"),
      matchedAt: toDateOrNull(row, "matchedAt"),
      matchingJson: toStrOrNull(row, "matchingJson"),
      winningTeamId: toIntOrNull(row, "winningTeamId"),
      voidReason: toStrOrNull(row, "voidReason"),
      predictionJson: toStrOrNull(row, "predictionJson"),
      settledAt: toDateOrNull(row, "settledAt"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksMatchPool.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksMatchPool.count(),
    findAll: (tx) => tx.bucksMatchPool.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BucksParlayDefinition",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.BucksParlayDefinitionCreateManyInput => ({
      id: toInt(row, "id"),
      matchId: toStr(row, "matchId"),
      queueType: toStr(row, "queueType"),
      selectedTeamId: toInt(row, "selectedTeamId"),
      subjects: toStr(row, "subjects"),
      criteria: toStr(row, "criteria"),
      yesProbabilityBps: toInt(row, "yesProbabilityBps"),
      promptVersion: toStr(row, "promptVersion"),
      catalogVersion: toStr(row, "catalogVersion"),
      schemaVersion: toInt(row, "schemaVersion"),
      evaluatorVersion: toStr(row, "evaluatorVersion"),
      generationContext: toStr(row, "generationContext"),
      proposal: toStrOrNull(row, "proposal"),
      pricing: toStrOrNull(row, "pricing"),
      requestedModel: toStr(row, "requestedModel"),
      resolvedModel: toStrOrNull(row, "resolvedModel"),
      usage: toStr(row, "usage"),
      durationMs: toInt(row, "durationMs"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksParlayDefinition.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksParlayDefinition.count(),
    findAll: (tx) =>
      tx.bucksParlayDefinition.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BucksParlayMarket",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.BucksParlayMarketCreateManyInput => ({
      id: toInt(row, "id"),
      definitionId: toInt(row, "definitionId"),
      outcomePoolId: toInt(row, "outcomePoolId"),
      matchId: toStr(row, "matchId"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      publishedAt: toDate(row, "publishedAt"),
      closesAt: toDate(row, "closesAt"),
      messageRefs: toStr(row, "messageRefs"),
      marketState: toStr(row, "marketState"),
      yesResult: toBoolOrNull(row, "yesResult"),
      legResults: toStrOrNull(row, "legResults"),
      voidReason: toStrOrNull(row, "voidReason"),
      settledAt: toDateOrNull(row, "settledAt"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksParlayMarket.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksParlayMarket.count(),
    findAll: (tx) =>
      tx.bucksParlayMarket.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BucksParlayBet",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.BucksParlayBetCreateManyInput => ({
      id: toInt(row, "id"),
      marketId: toInt(row, "marketId"),
      bucksAccountId: toInt(row, "bucksAccountId"),
      side: toStr(row, "side"),
      stake: toInt(row, "stake"),
      houseReserve: toInt(row, "houseReserve"),
      grossPayout: toInt(row, "grossPayout"),
      betOutcome: toStr(row, "betOutcome"),
      payout: toIntOrNull(row, "payout"),
      settledAt: toDateOrNull(row, "settledAt"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksParlayBet.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksParlayBet.count(),
    findAll: (tx) => tx.bucksParlayBet.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BucksMatchEarning",
    idColumns: ["matchId", "serverId"],
    resetIdSequence: false,
    transform: (row): Prisma.BucksMatchEarningCreateManyInput => ({
      matchId: toStr(row, "matchId"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      awardedAt: toDate(row, "awardedAt"),
      // This column was added after the currently promoted SQLite image. The
      // old schema's rows are all post-match earnings; keep that meaning when
      // importing them rather than requiring the source file to be mutated.
      phase: row["phase"] === undefined ? "postmatch" : toStr(row, "phase"),
      state: toStr(row, "state"),
      targetSnapshotJson: toStr(row, "targetSnapshotJson"),
      retryAt: toDate(row, "retryAt"),
      matchCreatedAt: toDate(row, "matchCreatedAt"),
      entryCount: toInt(row, "entryCount"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksMatchEarning.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksMatchEarning.count(),
    findAll: (tx) =>
      tx.bucksMatchEarning.findMany({
        orderBy: [{ matchId: "asc" }, { serverId: "asc" }],
      }),
  }),
  defineImportModel({
    model: "Subscription",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.SubscriptionCreateManyInput => ({
      id: SubscriptionIdSchema.parse(toInt(row, "id")),
      playerId: PlayerIdSchema.parse(toInt(row, "playerId")),
      channelId: DiscordChannelIdSchema.parse(toStr(row, "channelId")),
      filters: toStrOrNull(row, "filters"),
      isMuted: toBool(row, "isMuted"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      creatorDiscordId: DiscordAccountIdSchema.parse(
        toStr(row, "creatorDiscordId"),
      ),
      createdTime: toDate(row, "createdTime"),
      updatedTime: toDate(row, "updatedTime"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.subscription.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.subscription.count(),
    findAll: (tx) => tx.subscription.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "DesktopClient",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.DesktopClientCreateManyInput => ({
      id: DesktopClientIdSchema.parse(toInt(row, "id")),
      userId: DiscordAccountIdSchema.parse(toStr(row, "userId")),
      clientId: toStr(row, "clientId"),
      hostname: toStrOrNull(row, "hostname"),
      isConnected: toBool(row, "isConnected"),
      lastHeartbeat: toDateOrNull(row, "lastHeartbeat"),
      currentGameId: toStrOrNull(row, "currentGameId"),
      voiceChannelId: toStrOrNull(row, "voiceChannelId"),
      guildId: toStrOrNull(row, "guildId"),
      activeSoundPackId: toIntOrNull(row, "activeSoundPackId"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.desktopClient.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.desktopClient.count(),
    findAll: (tx) => tx.desktopClient.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BucksBet",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.BucksBetCreateManyInput => ({
      id: toInt(row, "id"),
      poolId: toInt(row, "poolId"),
      bucksAccountId: toInt(row, "bucksAccountId"),
      predictedTeamId: toInt(row, "predictedTeamId"),
      subjectPuuid: toStr(row, "subjectPuuid"),
      stake: toInt(row, "stake"),
      humanMatchedStake: toIntOrNull(row, "humanMatchedStake"),
      houseMatchedStake: toIntOrNull(row, "houseMatchedStake"),
      matchedStake: toIntOrNull(row, "matchedStake"),
      unmatchedStake: toIntOrNull(row, "unmatchedStake"),
      betOutcome: toStr(row, "betOutcome"),
      grossPayout: toIntOrNull(row, "grossPayout"),
      fee: toIntOrNull(row, "fee"),
      payout: toIntOrNull(row, "payout"),
      cancelledAt: toDateOrNull(row, "cancelledAt"),
      settledAt: toDateOrNull(row, "settledAt"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksBet.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksBet.count(),
    findAll: (tx) => tx.bucksBet.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BucksOpenPosition",
    idColumns: ["poolId", "bucksAccountId"],
    resetIdSequence: false,
    transform: (row): Prisma.BucksOpenPositionCreateManyInput => ({
      poolId: toInt(row, "poolId"),
      bucksAccountId: toInt(row, "bucksAccountId"),
      betId: toInt(row, "betId"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksOpenPosition.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksOpenPosition.count(),
    findAll: (tx) =>
      tx.bucksOpenPosition.findMany({
        orderBy: [{ poolId: "asc" }, { bucksAccountId: "asc" }],
      }),
  }),
  defineImportModel({
    model: "BucksLedgerEntry",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.BucksLedgerEntryCreateManyInput => ({
      id: toInt(row, "id"),
      bucksAccountId: toInt(row, "bucksAccountId"),
      delta: toInt(row, "delta"),
      balanceAfter: toInt(row, "balanceAfter"),
      kind: toStr(row, "kind"),
      matchId: toStrOrNull(row, "matchId"),
      betId: toIntOrNull(row, "betId"),
      parlayBetId: toIntOrNull(row, "parlayBetId"),
      predictedTeamId: toIntOrNull(row, "predictedTeamId"),
      actualWinningTeamId: toIntOrNull(row, "actualWinningTeamId"),
      context: toStr(row, "context"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.bucksLedgerEntry.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.bucksLedgerEntry.count(),
    findAll: (tx) => tx.bucksLedgerEntry.findMany({ orderBy: [{ id: "asc" }] }),
  }),
];
