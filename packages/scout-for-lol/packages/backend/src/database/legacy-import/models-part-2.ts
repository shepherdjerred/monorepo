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
  ApiTokenIdSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  GameEventLogIdSchema,
  SoundPackIdSchema,
  StoredSoundIdSchema,
} from "@scout-for-lol/data";
import {
  defineImportModel,
  parseOrNull,
  toBigInt,
  toBool,
  toDate,
  toDateOrNull,
  toDateOrNullIfMissing,
  toStrOrNullIfMissing,
  toInt,
  toIntOrNull,
  toStr,
  toStrOrNull,
  type ImportModelSpec,
} from "#src/database/legacy-import/convert.ts";

export const IMPORT_MODELS_PART_2: ImportModelSpec[] = [
  defineImportModel({
    model: "User",
    idColumns: ["discordId"],
    resetIdSequence: false,
    transform: (row): Prisma.UserCreateManyInput => ({
      discordId: DiscordAccountIdSchema.parse(toStr(row, "discordId")),
      discordUsername: toStr(row, "discordUsername"),
      discordAvatar: toStrOrNull(row, "discordAvatar"),
      discordAccessToken: toStrOrNull(row, "discordAccessToken"),
      discordRefreshToken: toStrOrNull(row, "discordRefreshToken"),
      tokenExpiresAt: toDateOrNull(row, "tokenExpiresAt"),
      analyticsUserId: toStr(row, "analyticsUserId"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
      // These nullable fields were added after the promoted SQLite image.
      lastSeenAt: toDateOrNullIfMissing(row, "lastSeenAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.user.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.user.count(),
    findAll: (tx) => tx.user.findMany({ orderBy: [{ discordId: "asc" }] }),
  }),
  defineImportModel({
    model: "ExploreConversation",
    idColumns: ["id"],
    resetIdSequence: false,
    transform: (row): Prisma.ExploreConversationCreateManyInput => ({
      id: toStr(row, "id"),
      userId: DiscordAccountIdSchema.parse(toStr(row, "userId")),
      title: toStr(row, "title"),
      shareToken: toStrOrNull(row, "shareToken"),
      sharedAt: toDateOrNull(row, "sharedAt"),
      currentLeafId: toStrOrNull(row, "currentLeafId"),
      sharedLeafId: toStrOrNull(row, "sharedLeafId"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.exploreConversation.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.exploreConversation.count(),
    findAll: (tx) =>
      tx.exploreConversation.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "ExploreMessage",
    idColumns: ["id"],
    resetIdSequence: false,
    transform: (row): Prisma.ExploreMessageCreateManyInput => ({
      id: toStr(row, "id"),
      conversationId: toStr(row, "conversationId"),
      parentId: toStrOrNull(row, "parentId"),
      role: toStr(row, "role"),
      content: toStr(row, "content"),
      queryText: toStrOrNull(row, "queryText"),
      caveats: toStr(row, "caveats"),
      followUps: toStr(row, "followUps"),
      preview: toStrOrNull(row, "preview"),
      visualization: toStrOrNull(row, "visualization"),
      trace: toStrOrNull(row, "trace"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.exploreMessage.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.exploreMessage.count(),
    findAll: (tx) => tx.exploreMessage.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "ApiToken",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.ApiTokenCreateManyInput => ({
      id: ApiTokenIdSchema.parse(toInt(row, "id")),
      userId: DiscordAccountIdSchema.parse(toStr(row, "userId")),
      token: toStr(row, "token"),
      name: toStr(row, "name"),
      scopes: toStr(row, "scopes"),
      lastUsedAt: toDateOrNull(row, "lastUsedAt"),
      expiresAt: toDateOrNull(row, "expiresAt"),
      createdAt: toDate(row, "createdAt"),
      revokedAt: toDateOrNull(row, "revokedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.apiToken.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.apiToken.count(),
    findAll: (tx) => tx.apiToken.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "SoundPack",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.SoundPackCreateManyInput => ({
      id: SoundPackIdSchema.parse(toInt(row, "id")),
      userId: DiscordAccountIdSchema.parse(toStr(row, "userId")),
      name: toStr(row, "name"),
      version: toStr(row, "version"),
      description: toStrOrNull(row, "description"),
      isPublic: toBool(row, "isPublic"),
      settings: toStr(row, "settings"),
      defaults: toStr(row, "defaults"),
      rules: toStr(row, "rules"),
      createdAt: toDate(row, "createdAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.soundPack.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.soundPack.count(),
    findAll: (tx) => tx.soundPack.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "StoredSound",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.StoredSoundCreateManyInput => ({
      id: StoredSoundIdSchema.parse(toInt(row, "id")),
      userId: DiscordAccountIdSchema.parse(toStr(row, "userId")),
      s3Key: toStr(row, "s3Key"),
      originalName: toStr(row, "originalName"),
      mimeType: toStr(row, "mimeType"),
      sizeBytes: toInt(row, "sizeBytes"),
      durationMs: toIntOrNull(row, "durationMs"),
      sourceType: toStr(row, "sourceType"),
      sourceUrl: toStrOrNull(row, "sourceUrl"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.storedSound.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.storedSound.count(),
    findAll: (tx) => tx.storedSound.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "GuildInstall",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.GuildInstallCreateManyInput => ({
      id: toInt(row, "id"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      serverName: toStr(row, "serverName"),
      ownerDiscordId: toStr(row, "ownerDiscordId"),
      addedByDiscordId: toStr(row, "addedByDiscordId"),
      memberCount: toInt(row, "memberCount"),
      installedAt: toDate(row, "installedAt"),
      analyticsInstallationId: toStr(row, "analyticsInstallationId"),
      analyticsLifecycleTracked: toBool(row, "analyticsLifecycleTracked"),
      firstSubscriptionAt: toDateOrNull(row, "firstSubscriptionAt"),
      firstCoreOutputAt: toDateOrNull(row, "firstCoreOutputAt"),
      outreach3dSentAt: toDateOrNull(row, "outreach3dSentAt"),
      outreach14dSentAt: toDateOrNull(row, "outreach14dSentAt"),
      outreach30dSentAt: toDateOrNull(row, "outreach30dSentAt"),
      emailNudgeSentAt: toDateOrNull(row, "emailNudgeSentAt"),
      removedAt: toDateOrNull(row, "removedAt"),
      attributedAt: toDateOrNullIfMissing(row, "attributedAt"),
      attributionSurface: toStrOrNullIfMissing(row, "attributionSurface"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.guildInstall.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.guildInstall.count(),
    findAll: (tx) => tx.guildInstall.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "InstallAttributionToken",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.InstallAttributionTokenCreateManyInput => ({
      id: toInt(row, "id"),
      token: toStr(row, "token"),
      discordId: DiscordAccountIdSchema.parse(toStr(row, "discordId")),
      surface: toStr(row, "surface"),
      createdAt: toDate(row, "createdAt"),
      expiresAt: toDate(row, "expiresAt"),
      consumedAt: toDateOrNull(row, "consumedAt"),
      guildId: toStrOrNull(row, "guildId"),
      reconciledAt: toDateOrNull(row, "reconciledAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.installAttributionToken.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.installAttributionToken.count(),
    findAll: (tx) =>
      tx.installAttributionToken.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "Feedback",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.FeedbackCreateManyInput => ({
      id: toInt(row, "id"),
      discordId: DiscordAccountIdSchema.parse(toStr(row, "discordId")),
      serverId: parseOrNull(DiscordGuildIdSchema, toStrOrNull(row, "serverId")),
      rating: toIntOrNull(row, "rating"),
      body: toStr(row, "body"),
      createdAt: toDate(row, "createdAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.feedback.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.feedback.count(),
    findAll: (tx) => tx.feedback.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "FeedbackPromptState",
    idColumns: ["discordId"],
    resetIdSequence: false,
    transform: (row): Prisma.FeedbackPromptStateCreateManyInput => ({
      discordId: DiscordAccountIdSchema.parse(toStr(row, "discordId")),
      dismissedAt: toDate(row, "dismissedAt"),
      submitted: toBool(row, "submitted"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.feedbackPromptState.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.feedbackPromptState.count(),
    findAll: (tx) =>
      tx.feedbackPromptState.findMany({ orderBy: [{ discordId: "asc" }] }),
  }),
  defineImportModel({
    model: "OutreachConversion",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.OutreachConversionCreateManyInput => ({
      id: toInt(row, "id"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      installedAt: toDate(row, "installedAt"),
      ladderStage: toInt(row, "ladderStage"),
      convertedAt: toDate(row, "convertedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.outreachConversion.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.outreachConversion.count(),
    findAll: (tx) =>
      tx.outreachConversion.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "BotState",
    idColumns: ["id"],
    resetIdSequence: false,
    transform: (row): Prisma.BotStateCreateManyInput => ({
      id: toInt(row, "id"),
      lastSuccessfulPollAt: toDateOrNull(row, "lastSuccessfulPollAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.botState.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.botState.count(),
    findAll: (tx) => tx.botState.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "ActiveGame",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.ActiveGameCreateManyInput => ({
      id: toInt(row, "id"),
      gameId: toBigInt(row, "gameId"),
      trackedPuuids: toStr(row, "trackedPuuids"),
      prematchMessageIds: toStrOrNull(row, "prematchMessageIds"),
      prematchMatchId: toStrOrNull(row, "prematchMatchId"),
      // Added after the promoted SQLite image; old games have no post-match
      // message collection to preserve.
      postmatchMessageIds: toStrOrNullIfMissing(row, "postmatchMessageIds"),
      detectedAt: toDate(row, "detectedAt"),
      expiresAt: toDate(row, "expiresAt"),
      updatedAt: toDate(row, "updatedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.activeGame.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.activeGame.count(),
    findAll: (tx) => tx.activeGame.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "GameEventLog",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.GameEventLogCreateManyInput => ({
      id: GameEventLogIdSchema.parse(toInt(row, "id")),
      userId: DiscordAccountIdSchema.parse(toStr(row, "userId")),
      clientId: toStr(row, "clientId"),
      eventType: toStr(row, "eventType"),
      eventData: toStr(row, "eventData"),
      soundPlayed: toStrOrNull(row, "soundPlayed"),
      timestamp: toDate(row, "timestamp"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.gameEventLog.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.gameEventLog.count(),
    findAll: (tx) => tx.gameEventLog.findMany({ orderBy: [{ id: "asc" }] }),
  }),
  defineImportModel({
    model: "MatchAiAttempt",
    idColumns: ["matchId"],
    resetIdSequence: false,
    transform: (row): Prisma.MatchAiAttemptCreateManyInput => ({
      matchId: toStr(row, "matchId"),
      attemptedAt: toDate(row, "attemptedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.matchAiAttempt.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.matchAiAttempt.count(),
    findAll: (tx) =>
      tx.matchAiAttempt.findMany({ orderBy: [{ matchId: "asc" }] }),
  }),
  defineImportModel({
    model: "GuildRemovalCandidate",
    idColumns: ["serverId"],
    resetIdSequence: false,
    transform: (row): Prisma.GuildRemovalCandidateCreateManyInput => ({
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      firstDetectedAt: toDate(row, "firstDetectedAt"),
      lastCheckedAt: toDate(row, "lastCheckedAt"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.guildRemovalCandidate.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.guildRemovalCandidate.count(),
    findAll: (tx) =>
      tx.guildRemovalCandidate.findMany({ orderBy: [{ serverId: "asc" }] }),
  }),
  defineImportModel({
    model: "AuditLog",
    idColumns: ["id"],
    resetIdSequence: true,
    transform: (row): Prisma.AuditLogCreateManyInput => ({
      id: toInt(row, "id"),
      createdAt: toDate(row, "createdAt"),
      actorDiscordId: toStr(row, "actorDiscordId"),
      serverId: DiscordGuildIdSchema.parse(toStr(row, "serverId")),
      action: toStr(row, "action"),
      targetChannelId: toStrOrNull(row, "targetChannelId"),
      targetPlayerId: toIntOrNull(row, "targetPlayerId"),
      targetAccountId: toIntOrNull(row, "targetAccountId"),
      payload: toStr(row, "payload"),
      ipAddress: toStrOrNull(row, "ipAddress"),
      userAgent: toStrOrNull(row, "userAgent"),
    }),
    createMany: async (tx, data) => {
      const result = await tx.auditLog.createMany({ data });
      return result.count;
    },
    count: (tx) => tx.auditLog.count(),
    findAll: (tx) => tx.auditLog.findMany({ orderBy: [{ id: "asc" }] }),
  }),
];
