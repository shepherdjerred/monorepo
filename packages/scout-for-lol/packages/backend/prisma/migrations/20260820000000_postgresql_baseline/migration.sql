-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "filters" TEXT,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "updatedTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" SERIAL NOT NULL,
    "alias" TEXT NOT NULL,
    "discordId" TEXT,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "updatedTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "alias" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "riotGameName" TEXT,
    "riotTagLine" TEXT,
    "riotIdUpdatedAt" TIMESTAMP(3),
    "lastProcessedMatchId" TEXT,
    "lastMatchTime" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "updatedTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummonerIndex" (
    "id" SERIAL NOT NULL,
    "puuid" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "updatedTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SummonerIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRankHistory" (
    "id" SERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "rankBefore" TEXT,
    "rankAfter" TEXT,
    "matchGameCreationAt" TIMESTAMP(3),
    "matchGameEndAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchRankHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "queryText" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isSystemManaged" BOOLEAN NOT NULL DEFAULT false,
    "systemSource" TEXT,
    "sourceCompetitionId" INTEGER,
    "cronExpression" TEXT NOT NULL,
    "scheduleTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "nextScheduledRunAt" TIMESTAMP(3),
    "lastScheduledRunAt" TIMESTAMP(3),
    "lastScheduledLocalDate" TEXT,
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "updatedTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "serverId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "rowsReturned" INTEGER NOT NULL DEFAULT 0,
    "rowsScanned" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "renderedContent" TEXT,
    "imageS3Key" TEXT,
    "imageByteSize" INTEGER,
    "querySnapshot" TEXT,
    "visualizationS3Key" TEXT,
    "visualizationByteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL,
    "criteriaType" TEXT NOT NULL,
    "criteriaConfig" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 50,
    "analysisTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "seasonId" TEXT,
    "startProcessedAt" TIMESTAMP(3),
    "endProcessedAt" TIMESTAMP(3),
    "startNotifiedAt" TIMESTAMP(3),
    "endNotifiedAt" TIMESTAMP(3),
    "startNotificationMessageId" TEXT,
    "endNotificationMessageId" TEXT,
    "updateCronExpression" TEXT,
    "nextScheduledUpdateAt" TIMESTAMP(3),
    "lastScheduledUpdateAt" TIMESTAMP(3),
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "updatedTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionParticipant" (
    "id" SERIAL NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "invitedBy" TEXT,
    "invitedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "CompetitionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionSnapshot" (
    "id" SERIAL NOT NULL,
    "competitionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "snapshotType" TEXT NOT NULL,
    "snapshotData" TEXT NOT NULL,
    "snapshotTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerPermission" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildPermissionError" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorReason" TEXT,
    "firstOccurrence" TIMESTAMP(3) NOT NULL,
    "lastOccurrence" TIMESTAMP(3) NOT NULL,
    "consecutiveErrorCount" INTEGER NOT NULL DEFAULT 1,
    "lastSuccessfulSend" TIMESTAMP(3),
    "ownerNotified" BOOLEAN NOT NULL DEFAULT false,
    "notificationStage" INTEGER NOT NULL DEFAULT 0,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildPermissionError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmAuditLog" (
    "id" SERIAL NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientTag" TEXT,
    "guildId" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL,
    "ladderStage" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "discordId" TEXT NOT NULL,
    "discordUsername" TEXT NOT NULL,
    "discordAvatar" TEXT,
    "discordAccessToken" TEXT,
    "discordRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "analyticsUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "ExploreConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shareToken" TEXT,
    "sharedAt" TIMESTAMP(3),
    "currentLeafId" TEXT,
    "sharedLeafId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "parentId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "queryText" TEXT,
    "caveats" TEXT NOT NULL DEFAULT '[]',
    "followUps" TEXT NOT NULL DEFAULT '[]',
    "preview" TEXT,
    "visualization" TEXT,
    "trace" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'events:write',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesktopClient" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hostname" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeat" TIMESTAMP(3),
    "currentGameId" TEXT,
    "voiceChannelId" TEXT,
    "guildId" TEXT,
    "activeSoundPackId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesktopClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoundPack" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "settings" TEXT NOT NULL,
    "defaults" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoundPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredSound" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredSound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildInstall" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "ownerDiscordId" TEXT NOT NULL,
    "addedByDiscordId" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "analyticsInstallationId" TEXT NOT NULL,
    "analyticsLifecycleTracked" BOOLEAN NOT NULL DEFAULT true,
    "firstSubscriptionAt" TIMESTAMP(3),
    "firstCoreOutputAt" TIMESTAMP(3),
    "outreach3dSentAt" TIMESTAMP(3),
    "outreach14dSentAt" TIMESTAMP(3),
    "outreach30dSentAt" TIMESTAMP(3),
    "emailNudgeSentAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "GuildInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "serverId" TEXT,
    "rating" INTEGER,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackPromptState" (
    "discordId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FeedbackPromptState_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "OutreachConversion" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "ladderStage" INTEGER NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastSuccessfulPollAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveGame" (
    "id" SERIAL NOT NULL,
    "gameId" BIGINT NOT NULL,
    "trackedPuuids" TEXT NOT NULL,
    "prematchMessageIds" TEXT,
    "prematchMatchId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEventLog" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventData" TEXT NOT NULL,
    "soundPlayed" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchAiAttempt" (
    "matchId" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchAiAttempt_pkey" PRIMARY KEY ("matchId")
);

-- CreateTable
CREATE TABLE "GuildRemovalCandidate" (
    "serverId" TEXT NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildRemovalCandidate_pkey" PRIMARY KEY ("serverId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorDiscordId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetChannelId" TEXT,
    "targetPlayerId" INTEGER,
    "targetAccountId" INTEGER,
    "payload" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksAccount" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "isHouse" BOOLEAN NOT NULL DEFAULT false,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "peekPassExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucksAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksLedgerEntry" (
    "id" SERIAL NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "matchId" TEXT,
    "betId" INTEGER,
    "parlayBetId" INTEGER,
    "predictedTeamId" INTEGER,
    "actualWinningTeamId" INTEGER,
    "context" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BucksLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksBet" (
    "id" SERIAL NOT NULL,
    "poolId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "predictedTeamId" INTEGER NOT NULL,
    "subjectPuuid" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "humanMatchedStake" INTEGER,
    "houseMatchedStake" INTEGER,
    "matchedStake" INTEGER,
    "unmatchedStake" INTEGER,
    "betOutcome" TEXT NOT NULL DEFAULT 'pending',
    "grossPayout" INTEGER,
    "fee" INTEGER,
    "payout" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucksBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksOpenPosition" (
    "poolId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "betId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BucksOpenPosition_pkey" PRIMARY KEY ("poolId","bucksAccountId")
);

-- CreateTable
CREATE TABLE "BucksMatchPool" (
    "id" SERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "peekAvailableAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "queueType" TEXT,
    "roster" TEXT NOT NULL,
    "messageRefs" TEXT NOT NULL DEFAULT '[]',
    "prematchContentBase" TEXT,
    "poolState" TEXT NOT NULL DEFAULT 'open',
    "matchedAt" TIMESTAMP(3),
    "matchingJson" TEXT,
    "winningTeamId" INTEGER,
    "voidReason" TEXT,
    "predictionJson" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucksMatchPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksParlayDefinition" (
    "id" SERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "selectedTeamId" INTEGER NOT NULL,
    "subjects" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "yesProbabilityBps" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "generationContext" TEXT NOT NULL,
    "proposal" TEXT,
    "pricing" TEXT,
    "requestedModel" TEXT NOT NULL,
    "resolvedModel" TEXT,
    "usage" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BucksParlayDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksParlayMarket" (
    "id" SERIAL NOT NULL,
    "definitionId" INTEGER NOT NULL,
    "outcomePoolId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "messageRefs" TEXT NOT NULL DEFAULT '[]',
    "marketState" TEXT NOT NULL DEFAULT 'publishing',
    "yesResult" BOOLEAN,
    "legResults" TEXT,
    "voidReason" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucksParlayMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksParlayBet" (
    "id" SERIAL NOT NULL,
    "marketId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "houseReserve" INTEGER NOT NULL,
    "grossPayout" INTEGER NOT NULL,
    "betOutcome" TEXT NOT NULL DEFAULT 'pending',
    "payout" INTEGER,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucksParlayBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksMatchEarning" (
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'complete',
    "targetSnapshotJson" TEXT NOT NULL DEFAULT '[]',
    "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryCount" INTEGER NOT NULL,

    CONSTRAINT "BucksMatchEarning_pkey" PRIMARY KEY ("matchId","serverId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_serverId_playerId_channelId_key" ON "Subscription"("serverId", "playerId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_serverId_alias_key" ON "Player"("serverId", "alias");

-- CreateIndex
CREATE INDEX "Account_puuid_idx" ON "Account"("puuid");

-- CreateIndex
CREATE UNIQUE INDEX "Account_serverId_puuid_key" ON "Account"("serverId", "puuid");

-- CreateIndex
CREATE UNIQUE INDEX "SummonerIndex_puuid_key" ON "SummonerIndex"("puuid");

-- CreateIndex
CREATE INDEX "SummonerIndex_gameName_idx" ON "SummonerIndex"("gameName");

-- CreateIndex
CREATE INDEX "MatchRankHistory_puuid_capturedAt_idx" ON "MatchRankHistory"("puuid", "capturedAt");

-- CreateIndex
CREATE INDEX "MatchRankHistory_puuid_queueType_matchGameEndAt_idx" ON "MatchRankHistory"("puuid", "queueType", "matchGameEndAt");

-- CreateIndex
CREATE INDEX "MatchRankHistory_matchId_idx" ON "MatchRankHistory"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchRankHistory_matchId_puuid_queueType_key" ON "MatchRankHistory"("matchId", "puuid", "queueType");

-- CreateIndex
CREATE INDEX "Report_serverId_isEnabled_idx" ON "Report"("serverId", "isEnabled");

-- CreateIndex
CREATE INDEX "Report_nextScheduledRunAt_idx" ON "Report"("nextScheduledRunAt");

-- CreateIndex
CREATE INDEX "Report_sourceCompetitionId_idx" ON "Report"("sourceCompetitionId");

-- CreateIndex
CREATE INDEX "Report_systemSource_idx" ON "Report"("systemSource");

-- CreateIndex
CREATE INDEX "ReportRun_reportId_startedAt_idx" ON "ReportRun"("reportId", "startedAt");

-- CreateIndex
CREATE INDEX "ReportRun_serverId_startedAt_idx" ON "ReportRun"("serverId", "startedAt");

-- CreateIndex
CREATE INDEX "ReportRun_status_startedAt_idx" ON "ReportRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "Competition_serverId_isCancelled_idx" ON "Competition"("serverId", "isCancelled");

-- CreateIndex
CREATE INDEX "Competition_serverId_ownerId_isCancelled_idx" ON "Competition"("serverId", "ownerId", "isCancelled");

-- CreateIndex
CREATE INDEX "Competition_nextScheduledUpdateAt_idx" ON "Competition"("nextScheduledUpdateAt");

-- CreateIndex
CREATE INDEX "CompetitionParticipant_competitionId_status_idx" ON "CompetitionParticipant"("competitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionParticipant_competitionId_playerId_key" ON "CompetitionParticipant"("competitionId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionSnapshot_competitionId_playerId_snapshotType_key" ON "CompetitionSnapshot"("competitionId", "playerId", "snapshotType");

-- CreateIndex
CREATE INDEX "ServerPermission_serverId_discordUserId_idx" ON "ServerPermission"("serverId", "discordUserId");

-- CreateIndex
CREATE INDEX "ServerPermission_serverId_idx" ON "ServerPermission"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ServerPermission_serverId_discordUserId_permission_key" ON "ServerPermission"("serverId", "discordUserId", "permission");

-- CreateIndex
CREATE INDEX "GuildPermissionError_serverId_consecutiveErrorCount_idx" ON "GuildPermissionError"("serverId", "consecutiveErrorCount");

-- CreateIndex
CREATE INDEX "GuildPermissionError_lastOccurrence_idx" ON "GuildPermissionError"("lastOccurrence");

-- CreateIndex
CREATE UNIQUE INDEX "GuildPermissionError_serverId_channelId_key" ON "GuildPermissionError"("serverId", "channelId");

-- CreateIndex
CREATE INDEX "DmAuditLog_recipientId_createdAt_idx" ON "DmAuditLog"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "DmAuditLog_kind_createdAt_idx" ON "DmAuditLog"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "DmAuditLog_guildId_createdAt_idx" ON "DmAuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_analyticsUserId_key" ON "User"("analyticsUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreConversation_shareToken_key" ON "ExploreConversation"("shareToken");

-- CreateIndex
CREATE INDEX "ExploreConversation_userId_updatedAt_idx" ON "ExploreConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ExploreMessage_conversationId_idx" ON "ExploreMessage"("conversationId");

-- CreateIndex
CREATE INDEX "ExploreMessage_conversationId_parentId_idx" ON "ExploreMessage"("conversationId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_token_key" ON "ApiToken"("token");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DesktopClient_clientId_key" ON "DesktopClient"("clientId");

-- CreateIndex
CREATE INDEX "DesktopClient_userId_idx" ON "DesktopClient"("userId");

-- CreateIndex
CREATE INDEX "SoundPack_userId_idx" ON "SoundPack"("userId");

-- CreateIndex
CREATE INDEX "SoundPack_isPublic_idx" ON "SoundPack"("isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "SoundPack_userId_name_key" ON "SoundPack"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StoredSound_s3Key_key" ON "StoredSound"("s3Key");

-- CreateIndex
CREATE INDEX "StoredSound_userId_idx" ON "StoredSound"("userId");

-- CreateIndex
CREATE INDEX "StoredSound_sourceUrl_idx" ON "StoredSound"("sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "GuildInstall_serverId_key" ON "GuildInstall"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "GuildInstall_analyticsInstallationId_key" ON "GuildInstall"("analyticsInstallationId");

-- CreateIndex
CREATE INDEX "GuildInstall_installedAt_idx" ON "GuildInstall"("installedAt");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Feedback_discordId_createdAt_idx" ON "Feedback"("discordId", "createdAt");

-- CreateIndex
CREATE INDEX "OutreachConversion_ladderStage_idx" ON "OutreachConversion"("ladderStage");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachConversion_serverId_installedAt_key" ON "OutreachConversion"("serverId", "installedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveGame_prematchMatchId_key" ON "ActiveGame"("prematchMatchId");

-- CreateIndex
CREATE INDEX "ActiveGame_expiresAt_idx" ON "ActiveGame"("expiresAt");

-- CreateIndex
CREATE INDEX "GameEventLog_userId_timestamp_idx" ON "GameEventLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "GameEventLog_clientId_timestamp_idx" ON "GameEventLog"("clientId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_serverId_createdAt_idx" ON "AuditLog"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorDiscordId_createdAt_idx" ON "AuditLog"("actorDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "BucksAccount_serverId_balance_idx" ON "BucksAccount"("serverId", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "BucksAccount_serverId_discordId_key" ON "BucksAccount"("serverId", "discordId");

-- CreateIndex
CREATE INDEX "BucksLedgerEntry_bucksAccountId_createdAt_idx" ON "BucksLedgerEntry"("bucksAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "BucksLedgerEntry_matchId_idx" ON "BucksLedgerEntry"("matchId");

-- CreateIndex
CREATE INDEX "BucksBet_poolId_bucksAccountId_idx" ON "BucksBet"("poolId", "bucksAccountId");

-- CreateIndex
CREATE INDEX "BucksBet_poolId_predictedTeamId_idx" ON "BucksBet"("poolId", "predictedTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksOpenPosition_betId_key" ON "BucksOpenPosition"("betId");

-- CreateIndex
CREATE INDEX "BucksOpenPosition_poolId_idx" ON "BucksOpenPosition"("poolId");

-- CreateIndex
CREATE INDEX "BucksMatchPool_poolState_closesAt_idx" ON "BucksMatchPool"("poolState", "closesAt");

-- CreateIndex
CREATE INDEX "BucksMatchPool_serverId_poolState_peekAvailableAt_idx" ON "BucksMatchPool"("serverId", "poolState", "peekAvailableAt");

-- CreateIndex
CREATE INDEX "BucksMatchPool_serverId_poolState_settledAt_idx" ON "BucksMatchPool"("serverId", "poolState", "settledAt");

-- CreateIndex
CREATE INDEX "BucksMatchPool_matchId_idx" ON "BucksMatchPool"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksMatchPool_matchId_serverId_key" ON "BucksMatchPool"("matchId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksParlayDefinition_matchId_key" ON "BucksParlayDefinition"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksParlayMarket_outcomePoolId_key" ON "BucksParlayMarket"("outcomePoolId");

-- CreateIndex
CREATE INDEX "BucksParlayMarket_marketState_closesAt_idx" ON "BucksParlayMarket"("marketState", "closesAt");

-- CreateIndex
CREATE INDEX "BucksParlayMarket_matchId_idx" ON "BucksParlayMarket"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksParlayMarket_matchId_serverId_key" ON "BucksParlayMarket"("matchId", "serverId");

-- CreateIndex
CREATE INDEX "BucksParlayBet_marketId_side_idx" ON "BucksParlayBet"("marketId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "BucksParlayBet_marketId_bucksAccountId_key" ON "BucksParlayBet"("marketId", "bucksAccountId");

-- CreateIndex
CREATE INDEX "BucksMatchEarning_state_retryAt_idx" ON "BucksMatchEarning"("state", "retryAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionParticipant" ADD CONSTRAINT "CompetitionParticipant_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionParticipant" ADD CONSTRAINT "CompetitionParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionSnapshot" ADD CONSTRAINT "CompetitionSnapshot_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionSnapshot" ADD CONSTRAINT "CompetitionSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreConversation" ADD CONSTRAINT "ExploreConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreMessage" ADD CONSTRAINT "ExploreMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ExploreConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreMessage" ADD CONSTRAINT "ExploreMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ExploreMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopClient" ADD CONSTRAINT "DesktopClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopClient" ADD CONSTRAINT "DesktopClient_activeSoundPackId_fkey" FOREIGN KEY ("activeSoundPackId") REFERENCES "SoundPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoundPack" ADD CONSTRAINT "SoundPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredSound" ADD CONSTRAINT "StoredSound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksLedgerEntry" ADD CONSTRAINT "BucksLedgerEntry_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksLedgerEntry" ADD CONSTRAINT "BucksLedgerEntry_betId_fkey" FOREIGN KEY ("betId") REFERENCES "BucksBet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksLedgerEntry" ADD CONSTRAINT "BucksLedgerEntry_parlayBetId_fkey" FOREIGN KEY ("parlayBetId") REFERENCES "BucksParlayBet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksBet" ADD CONSTRAINT "BucksBet_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "BucksMatchPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksBet" ADD CONSTRAINT "BucksBet_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksOpenPosition" ADD CONSTRAINT "BucksOpenPosition_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "BucksMatchPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksOpenPosition" ADD CONSTRAINT "BucksOpenPosition_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksOpenPosition" ADD CONSTRAINT "BucksOpenPosition_betId_fkey" FOREIGN KEY ("betId") REFERENCES "BucksBet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksParlayMarket" ADD CONSTRAINT "BucksParlayMarket_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "BucksParlayDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksParlayMarket" ADD CONSTRAINT "BucksParlayMarket_outcomePoolId_fkey" FOREIGN KEY ("outcomePoolId") REFERENCES "BucksMatchPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksParlayBet" ADD CONSTRAINT "BucksParlayBet_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BucksParlayMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksParlayBet" ADD CONSTRAINT "BucksParlayBet_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
