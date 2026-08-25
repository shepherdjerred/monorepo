/**
 * One entry per Prisma model, in FK-safe topological order across the part
 * files (concatenated by run-import.ts). Authored via one-time codegen from
 * schema.prisma, maintained by hand: each transform is typed as the model's
 * branded CreateManyInput, so adding a model or column — or changing a
 * brand in scripts/brand-prisma-types.ts — without updating these maps is a
 * compile error here.
 */
import type { Prisma } from "#generated/prisma/client/index.js";
import { z } from "zod";
import {
  AccountIdSchema,
  CompetitionIdSchema,
  CompetitionVisibilitySchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  ParticipantStatusSchema,
  PermissionErrorIdSchema,
  PermissionIdSchema,
  PlayerIdSchema,
  RegionSchema,
  ReportIdSchema,
  ReportRunIdSchema,
  ReportRunStatusSchema,
  ReportRunTriggerSchema,
  ReportSystemSourceSchema,
  SeasonIdSchema,
  SnapshotIdSchema,
  SnapshotTypeSchema,
} from "@scout-for-lol/data";
import {
  defineImportModel,
  parseOrNull,
  toBool,
  toDate,
  toDateOrNull,
  toInt,
  toIntOrNull,
  toStr,
  toStrOrNull,
  type ImportModelSpec,
} from "#src/database/legacy-import/convert.ts";

const LegacyCriteriaConfigSchema = z.record(z.string(), z.unknown());

function canonicalCompetitionQueues(queue: unknown): string[] {
  if (queue === undefined || queue === "ALL") return ["ALL"];
  if (queue === "SOLO") return ["solo"];
  if (queue === "FLEX") return ["flex"];
  if (queue === "RANKED_ANY") return ["solo", "flex"];
  if (typeof queue === "string")
    return [queue.toLowerCase().replaceAll("_", " ")];
  throw new Error("Competition criteria queue must be a string");
}

function competitionInput(
  row: Record<string, unknown>,
): Prisma.CompetitionCreateManyInput {
  const criteriaType = toStr(row, "criteriaType");
  const rawConfig: unknown = JSON.parse(toStr(row, "criteriaConfig"));
  const config = LegacyCriteriaConfigSchema.parse(rawConfig);
  const { queue, ...rest } = config;
  const criteriaConfig = {
    ...rest,
    queues: canonicalCompetitionQueues(queue),
    ...(criteriaType === "HIGHEST_RANK" || criteriaType === "MOST_RANK_CLIMB"
      ? { aggregation: "MAX" }
      : {}),
  };
  const championId = config["championId"];
  const numericChampionId =
    typeof championId === "number"
      ? championId
      : typeof championId === "string"
        ? Number(championId)
        : undefined;

  return {
    id: CompetitionIdSchema.parse(toInt(row, "id")),
    serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
    ownerId: DiscordAccountIdSchema.parse(toStr(row, "ownerId")),
    title: toStr(row, "title"),
    description: toStr(row, "description"),
    gameVariant:
      numericChampionId !== undefined && numericChampionId >= 60_000
        ? "CLASSIC"
        : "MODERN",
    channelId: DiscordChannelIdSchema.parse(toStr(row, "channelId")),
    isCancelled: toBool(row, "isCancelled"),
    visibility: CompetitionVisibilitySchema.parse(toStr(row, "visibility")),
    criteriaType,
    criteriaConfig: JSON.stringify(criteriaConfig),
    maxParticipants: toInt(row, "maxParticipants"),
    analysisTimezone: toStr(row, "analysisTimezone"),
    startDate: toDateOrNull(row, "startDate"),
    endDate: toDateOrNull(row, "endDate"),
    seasonId: parseOrNull(SeasonIdSchema, toStrOrNull(row, "seasonId")),
    startProcessedAt: toDateOrNull(row, "startProcessedAt"),
    endProcessedAt: toDateOrNull(row, "endProcessedAt"),
    startNotifiedAt: toDateOrNull(row, "startNotifiedAt"),
    endNotifiedAt: toDateOrNull(row, "endNotifiedAt"),
    startNotificationMessageId: toStrOrNull(row, "startNotificationMessageId"),
    endNotificationMessageId: toStrOrNull(row, "endNotificationMessageId"),
    updateCronExpression: toStrOrNull(row, "updateCronExpression"),
    nextScheduledUpdateAt: toDateOrNull(row, "nextScheduledUpdateAt"),
    lastScheduledUpdateAt: toDateOrNull(row, "lastScheduledUpdateAt"),
    creatorDiscordId: DiscordAccountIdSchema.parse(
      toStr(row, "creatorDiscordId"),
    ),
    createdTime: toDate(row, "createdTime"),
    updatedTime: toDate(row, "updatedTime"),
  };
}

export const IMPORT_MODELS_PART_1: ImportModelSpec[] = [
  defineImportModel({
    model: "Player",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.PlayerCreateManyInput => ({
      id: PlayerIdSchema.parse(toInt(row, "id")),
      alias: toStr(row, "alias"),
      discordId: parseOrNull(
        DiscordAccountIdSchema,
        toStrOrNull(row, "discordId"),
      ),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      creatorDiscordId: DiscordAccountIdSchema.parse(
        toStr(row, "creatorDiscordId"),
      ),
      createdTime: toDate(row, "createdTime"),
      updatedTime: toDate(row, "updatedTime"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.player.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.player.count(),
    findAll: (tx) => tx.player.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "Account",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.AccountCreateManyInput => ({
      id: AccountIdSchema.parse(toInt(row, "id")),
      alias: toStr(row, "alias"),
      puuid: LeaguePuuidSchema.parse(toStr(row, "puuid")),
      region: RegionSchema.parse(toStr(row, "region")),
      playerId: PlayerIdSchema.parse(toInt(row, "playerId")),
      riotGameName: toStrOrNull(row, "riotGameName"),
      riotTagLine: toStrOrNull(row, "riotTagLine"),
      riotIdUpdatedAt: toDateOrNull(row, "riotIdUpdatedAt"),
      lastProcessedMatchId: parseOrNull(
        MatchIdSchema,
        toStrOrNull(row, "lastProcessedMatchId"),
      ),
      lastMatchTime: toDateOrNull(row, "lastMatchTime"),
      lastCheckedAt: toDateOrNull(row, "lastCheckedAt"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      creatorDiscordId: DiscordAccountIdSchema.parse(
        toStr(row, "creatorDiscordId"),
      ),
      createdTime: toDate(row, "createdTime"),
      updatedTime: toDate(row, "updatedTime"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.account.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.account.count(),
    findAll: (tx) => tx.account.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "SummonerIndex",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.SummonerIndexCreateManyInput => ({
      id: toInt(row, "id"),
      puuid: LeaguePuuidSchema.parse(toStr(row, "puuid")),
      gameName: toStr(row, "gameName"),
      tagLine: toStr(row, "tagLine"),
      region: RegionSchema.parse(toStr(row, "region")),
      lastVerifiedAt: toDate(row, "lastVerifiedAt"),
      createdTime: toDate(row, "createdTime"),
      updatedTime: toDate(row, "updatedTime"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.summonerIndex.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.summonerIndex.count(),
    findAll: (tx) => tx.summonerIndex.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "MatchRankHistory",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.MatchRankHistoryCreateManyInput => ({
      id: toInt(row, "id"),
      matchId: toStr(row, "matchId"),
      puuid: LeaguePuuidSchema.parse(toStr(row, "puuid")),
      queueType: toStr(row, "queueType"),
      rankBefore: toStrOrNull(row, "rankBefore"),
      rankAfter: toStrOrNull(row, "rankAfter"),
      matchGameCreationAt: toDateOrNull(row, "matchGameCreationAt"),
      matchGameEndAt: toDateOrNull(row, "matchGameEndAt"),
      capturedAt: toDate(row, "capturedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.matchRankHistory.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.matchRankHistory.count(),
    findAll: (tx) => tx.matchRankHistory.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "Report",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.ReportCreateManyInput => ({
      id: ReportIdSchema.parse(toInt(row, "id")),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      ownerId: DiscordAccountIdSchema.parse(toStr(row, "ownerId")),
      channelId: DiscordChannelIdSchema.parse(toStr(row, "channelId")),
      title: toStr(row, "title"),
      description: toStrOrNull(row, "description"),
      queryText: toStr(row, "queryText"),
      isEnabled: toBool(row, "isEnabled"),
      isSystemManaged: toBool(row, "isSystemManaged"),
      systemSource: parseOrNull(
        ReportSystemSourceSchema,
        toStrOrNull(row, "systemSource"),
      ),
      sourceCompetitionId: parseOrNull(
        CompetitionIdSchema,
        toIntOrNull(row, "sourceCompetitionId"),
      ),
      cronExpression: toStr(row, "cronExpression"),
      scheduleTimezone: toStr(row, "scheduleTimezone"),
      nextScheduledRunAt: toDateOrNull(row, "nextScheduledRunAt"),
      lastScheduledRunAt: toDateOrNull(row, "lastScheduledRunAt"),
      lastScheduledLocalDate: toStrOrNull(row, "lastScheduledLocalDate"),
      lastRunStatus: parseOrNull(
        ReportRunStatusSchema,
        toStrOrNull(row, "lastRunStatus"),
      ),
      lastRunError: toStrOrNull(row, "lastRunError"),
      createdTime: toDate(row, "createdTime"),
      updatedTime: toDate(row, "updatedTime"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.report.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.report.count(),
    findAll: (tx) => tx.report.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "ReportRun",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.ReportRunCreateManyInput => ({
      id: ReportRunIdSchema.parse(toInt(row, "id")),
      reportId: ReportIdSchema.parse(toInt(row, "reportId")),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      trigger: ReportRunTriggerSchema.parse(toStr(row, "trigger")),
      status: ReportRunStatusSchema.parse(toStr(row, "status")),
      startedAt: toDate(row, "startedAt"),
      completedAt: toDateOrNull(row, "completedAt"),
      durationMs: toIntOrNull(row, "durationMs"),
      rowsReturned: toInt(row, "rowsReturned"),
      rowsScanned: toInt(row, "rowsScanned"),
      errorMessage: toStrOrNull(row, "errorMessage"),
      renderedContent: toStrOrNull(row, "renderedContent"),
      imageS3Key: toStrOrNull(row, "imageS3Key"),
      imageByteSize: toIntOrNull(row, "imageByteSize"),
      querySnapshot: toStrOrNull(row, "querySnapshot"),
      visualizationS3Key: toStrOrNull(row, "visualizationS3Key"),
      visualizationByteSize: toIntOrNull(row, "visualizationByteSize"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.reportRun.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.reportRun.count(),
    findAll: (tx) => tx.reportRun.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "Season",
    idColumns: ["id"],
    resetIdSequence: false,
    transform: (row): Prisma.SeasonCreateManyInput => ({
      id: toStr(row, "id"),
      displayName: toStr(row, "displayName"),
      startDate: toDate(row, "startDate"),
      endDate: toDate(row, "endDate"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.season.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.season.count(),
    findAll: (tx) => tx.season.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "Competition",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: competitionInput,
    createMany: async (tx, data) => {
      const result = await tx.competition.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.competition.count(),
    findAll: (tx) => tx.competition.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "CompetitionParticipant",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.CompetitionParticipantCreateManyInput => ({
      id: ParticipantIdSchema.parse(toInt(row, "id")),
      competitionId: CompetitionIdSchema.parse(toInt(row, "competitionId")),
      playerId: PlayerIdSchema.parse(toInt(row, "playerId")),
      status: ParticipantStatusSchema.parse(toStr(row, "status")),
      invitedBy: parseOrNull(
        DiscordAccountIdSchema,
        toStrOrNull(row, "invitedBy"),
      ),
      invitedAt: toDateOrNull(row, "invitedAt"),
      joinedAt: toDateOrNull(row, "joinedAt"),
      leftAt: toDateOrNull(row, "leftAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.competitionParticipant.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.competitionParticipant.count(),
    findAll: (tx) =>
      tx.competitionParticipant.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "CompetitionSnapshot",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.CompetitionSnapshotCreateManyInput => ({
      id: SnapshotIdSchema.parse(toInt(row, "id")),
      competitionId: CompetitionIdSchema.parse(toInt(row, "competitionId")),
      playerId: PlayerIdSchema.parse(toInt(row, "playerId")),
      snapshotType: SnapshotTypeSchema.parse(toStr(row, "snapshotType")),
      snapshotData: toStr(row, "snapshotData"),
      snapshotTime: toDate(row, "snapshotTime"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.competitionSnapshot.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.competitionSnapshot.count(),
    findAll: (tx) =>
      tx.competitionSnapshot.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "ServerPermission",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.ServerPermissionCreateManyInput => ({
      id: PermissionIdSchema.parse(toInt(row, "id")),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      discordUserId: DiscordAccountIdSchema.parse(toStr(row, "discordUserId")),
      permission: toStr(row, "permission"),
      grantedBy: DiscordAccountIdSchema.parse(toStr(row, "grantedBy")),
      grantedAt: toDate(row, "grantedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.serverPermission.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.serverPermission.count(),
    findAll: (tx) => tx.serverPermission.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "GuildPermissionError",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.GuildPermissionErrorCreateManyInput => ({
      id: PermissionErrorIdSchema.parse(toInt(row, "id")),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      channelId: DiscordChannelIdSchema.parse(toStr(row, "channelId")),
      errorType: toStr(row, "errorType"),
      errorReason: toStrOrNull(row, "errorReason"),
      firstOccurrence: toDate(row, "firstOccurrence"),
      lastOccurrence: toDate(row, "lastOccurrence"),
      consecutiveErrorCount: toInt(row, "consecutiveErrorCount"),
      lastSuccessfulSend: toDateOrNull(row, "lastSuccessfulSend"),
      ownerNotified: toBool(row, "ownerNotified"),
      notificationStage: toInt(row, "notificationStage"),
      lastNotifiedAt: toDateOrNull(row, "lastNotifiedAt"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.guildPermissionError.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.guildPermissionError.count(),
    findAll: (tx) =>
      tx.guildPermissionError.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "DmAuditLog",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.DmAuditLogCreateManyInput => ({
      id: toInt(row, "id"),
      recipientId: toStr(row, "recipientId"),
      recipientTag: toStrOrNull(row, "recipientTag"),
      guildId: toStrOrNull(row, "guildId"),
      kind: toStr(row, "kind"),
      content: toStr(row, "content"),
      deliveryStatus: toStr(row, "deliveryStatus"),
      ladderStage: toIntOrNull(row, "ladderStage"),
      errorMessage: toStrOrNull(row, "errorMessage"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.dmAuditLog.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.dmAuditLog.count(),
    findAll: (tx) => tx.dmAuditLog.findMany({ orderBy: [{ id: "asc" }] }),
  }),
];
