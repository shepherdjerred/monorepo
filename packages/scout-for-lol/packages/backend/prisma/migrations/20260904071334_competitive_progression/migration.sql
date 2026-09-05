-- CreateTable
CREATE TABLE "HallSettings" (
    "guildId" TEXT NOT NULL,
    "catalogVersion" INTEGER NOT NULL,
    "channelId" TEXT,
    "enabledQueueFamilies" TEXT NOT NULL,
    "enabledRecords" TEXT NOT NULL,
    "baselineRevision" INTEGER NOT NULL DEFAULT 0,
    "updatedByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HallSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "HallRecordCell" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "queueFamilyId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "baselineStatus" TEXT NOT NULL DEFAULT 'building',
    "baselineRevision" INTEGER NOT NULL,
    "baselineValue" DOUBLE PRECISION,
    "currentValue" DOUBLE PRECISION,
    "holdersJson" TEXT NOT NULL DEFAULT '[]',
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "baselineStartedAt" TIMESTAMP(3),
    "baselineCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HallRecordCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallBaselineRun" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "baselineState" TEXT NOT NULL DEFAULT 'building',
    "requestedByDiscordId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HallBaselineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallRecordBreakOutbox" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HallRecordBreakOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT,
    "authorDiscordId" TEXT NOT NULL,
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "contractJson" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeDraft" (
    "id" TEXT NOT NULL,
    "ownerDiscordId" TEXT NOT NULL,
    "sourceTemplateId" TEXT,
    "contractJson" TEXT NOT NULL,
    "previewJson" TEXT,
    "previewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "publishedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeRun" (
    "id" TEXT NOT NULL,
    "ownerDiscordId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "runState" TEXT NOT NULL DEFAULT 'active',
    "originalStartAt" TIMESTAMP(3) NOT NULL,
    "importRequestedAt" TIMESTAMP(3),
    "frozenContractJson" TEXT NOT NULL,
    "evaluationRevision" INTEGER NOT NULL DEFAULT 1,
    "recomputing" BOOLEAN NOT NULL DEFAULT true,
    "currentSnapshotId" TEXT,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeActiveRun" (
    "ownerDiscordId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeActiveRun_pkey" PRIMARY KEY ("ownerDiscordId","templateId")
);

-- CreateTable
CREATE TABLE "ChallengeRunRevision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "selectedAccountsJson" TEXT NOT NULL,
    "revisionState" TEXT NOT NULL DEFAULT 'queued',
    "workflowId" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeRunRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeRunSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "progressJson" TEXT NOT NULL,
    "coverageJson" TEXT NOT NULL,
    "evaluatedThroughAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeRunSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeRunEvidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "gameEndAt" TIMESTAMP(3) NOT NULL,
    "timelineComplete" BOOLEAN NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeRunEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeRunCursor" (
    "runId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "lastMatchEndAt" TIMESTAMP(3),
    "lastMatchId" TEXT,
    "timelineRequired" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeRunCursor_pkey" PRIMARY KEY ("runId","puuid")
);

-- CreateTable
CREATE TABLE "ChallengeRunMatchTrigger" (
    "runId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeRunMatchTrigger_pkey" PRIMARY KEY ("runId","matchId")
);

-- CreateTable
CREATE TABLE "DuelRiotApproval" (
    "feature" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "recordedByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelRiotApproval_pkey" PRIMARY KEY ("feature")
);

-- CreateTable
CREATE TABLE "DuelEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "competitorKind" TEXT NOT NULL,
    "bestOf" INTEGER NOT NULL,
    "rulesetJson" TEXT NOT NULL,
    "registrationMode" TEXT NOT NULL,
    "seedMethod" TEXT NOT NULL,
    "randomSeed" TEXT NOT NULL,
    "matchWindowHours" INTEGER NOT NULL DEFAULT 168,
    "channelId" TEXT NOT NULL,
    "organizerDiscordId" TEXT NOT NULL,
    "eventState" TEXT NOT NULL DEFAULT 'draft',
    "registrationClosesAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelCompetitor" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "teamName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelCompetitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelCompetitorMember" (
    "competitorId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "playerAlias" TEXT NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelCompetitorMember_pkey" PRIMARY KEY ("competitorId","playerId")
);

-- CreateTable
CREATE TABLE "DuelDisclosureAcceptance" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "discordId" TEXT NOT NULL,
    "disclosureVersion" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelDisclosureAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelEventEntrant" (
    "eventId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "registrationSource" TEXT NOT NULL,
    "registrationState" TEXT NOT NULL DEFAULT 'pending',
    "seed" INTEGER,
    "invitedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelEventEntrant_pkey" PRIMARY KEY ("eventId","competitorId")
);

-- CreateTable
CREATE TABLE "DuelEventRoundOverride" (
    "eventId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "bestOf" INTEGER NOT NULL,

    CONSTRAINT "DuelEventRoundOverride_pkey" PRIMARY KEY ("eventId","roundNumber")
);

-- CreateTable
CREATE TABLE "DuelSeries" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "eventId" TEXT,
    "roundNumber" INTEGER,
    "bracket" TEXT,
    "position" INTEGER,
    "competitorOneId" TEXT NOT NULL,
    "competitorTwoId" TEXT NOT NULL,
    "bestOf" INTEGER NOT NULL,
    "rulesetJson" TEXT NOT NULL,
    "seriesState" TEXT NOT NULL DEFAULT 'awaiting_acceptance',
    "channelId" TEXT NOT NULL,
    "organizerDiscordId" TEXT NOT NULL,
    "windowStartsAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "workflowId" TEXT NOT NULL,
    "winnerCompetitorId" TEXT,
    "advancementKind" TEXT,
    "advancementReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelSeriesParticipant" (
    "seriesId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "competitorId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "disclosureVersion" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelSeriesParticipant_pkey" PRIMARY KEY ("seriesId","playerId")
);

-- CreateTable
CREATE TABLE "DuelGame" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "gameNumber" INTEGER NOT NULL,
    "tournamentLobbyId" INTEGER,
    "matchId" TEXT,
    "gameState" TEXT NOT NULL DEFAULT 'awaiting_readiness',
    "resultState" TEXT,
    "winnerCompetitorId" TEXT,
    "objective" TEXT,
    "objectiveTimestampMs" INTEGER,
    "evidenceJson" TEXT,
    "reviewReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelAuditDecision" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelAuditDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelRecord" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "opponentKey" TEXT NOT NULL DEFAULT '',
    "games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "series" INTEGER NOT NULL DEFAULT 0,
    "seriesWins" INTEGER NOT NULL DEFAULT 0,
    "seriesLosses" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelStatusOutbox" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuelStatusOutbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DuelEvent"
    ADD CONSTRAINT "DuelEvent_bestOf_check" CHECK ("bestOf" IN (1, 3, 5)),
    ADD CONSTRAINT "DuelEvent_matchWindowHours_check" CHECK ("matchWindowHours" BETWEEN 24 AND 336),
    ADD CONSTRAINT "DuelEvent_format_check" CHECK ("format" IN ('single_elimination', 'double_elimination', 'round_robin')),
    ADD CONSTRAINT "DuelEvent_competitorKind_check" CHECK ("competitorKind" IN ('player', 'pair'));

ALTER TABLE "DuelEventRoundOverride"
    ADD CONSTRAINT "DuelEventRoundOverride_bestOf_check" CHECK ("bestOf" IN (1, 3, 5));

ALTER TABLE "DuelSeries"
    ADD CONSTRAINT "DuelSeries_bestOf_check" CHECK ("bestOf" IN (1, 3, 5));

-- CreateIndex
CREATE INDEX "HallSettings_updatedAt_idx" ON "HallSettings"("updatedAt");

-- CreateIndex
CREATE INDEX "HallRecordCell_guildId_baselineStatus_idx" ON "HallRecordCell"("guildId", "baselineStatus");

-- CreateIndex
CREATE UNIQUE INDEX "HallRecordCell_guildId_queueFamilyId_recordId_key" ON "HallRecordCell"("guildId", "queueFamilyId", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "HallBaselineRun_workflowId_key" ON "HallBaselineRun"("workflowId");

-- CreateIndex
CREATE INDEX "HallBaselineRun_baselineState_createdAt_idx" ON "HallBaselineRun"("baselineState", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HallBaselineRun_guildId_revision_key" ON "HallBaselineRun"("guildId", "revision");

-- CreateIndex
CREATE INDEX "HallRecordBreakOutbox_deliveryStatus_createdAt_idx" ON "HallRecordBreakOutbox"("deliveryStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HallRecordBreakOutbox_guildId_matchId_key" ON "HallRecordBreakOutbox"("guildId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeTemplate_slug_key" ON "ChallengeTemplate"("slug");

-- CreateIndex
CREATE INDEX "ChallengeTemplate_createdAt_idx" ON "ChallengeTemplate"("createdAt");

-- CreateIndex
CREATE INDEX "ChallengeTemplateVersion_publishedAt_idx" ON "ChallengeTemplateVersion"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeTemplateVersion_templateId_version_key" ON "ChallengeTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeDraft_publishedVersionId_key" ON "ChallengeDraft"("publishedVersionId");

-- CreateIndex
CREATE INDEX "ChallengeDraft_ownerDiscordId_expiresAt_idx" ON "ChallengeDraft"("ownerDiscordId", "expiresAt");

-- CreateIndex
CREATE INDEX "ChallengeRun_ownerDiscordId_runState_updatedAt_idx" ON "ChallengeRun"("ownerDiscordId", "runState", "updatedAt");

-- CreateIndex
CREATE INDEX "ChallengeRun_templateId_runState_idx" ON "ChallengeRun"("templateId", "runState");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeActiveRun_runId_key" ON "ChallengeActiveRun"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeRunRevision_workflowId_key" ON "ChallengeRunRevision"("workflowId");

-- CreateIndex
CREATE INDEX "ChallengeRunRevision_revisionState_createdAt_idx" ON "ChallengeRunRevision"("revisionState", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeRunRevision_runId_revision_key" ON "ChallengeRunRevision"("runId", "revision");

-- CreateIndex
CREATE INDEX "ChallengeRunSnapshot_runId_createdAt_idx" ON "ChallengeRunSnapshot"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeRunSnapshot_runId_revision_key" ON "ChallengeRunSnapshot"("runId", "revision");

-- CreateIndex
CREATE INDEX "ChallengeRunEvidence_runId_revision_gameEndAt_matchId_idx" ON "ChallengeRunEvidence"("runId", "revision", "gameEndAt", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeRunEvidence_runId_revision_matchId_puuid_key" ON "ChallengeRunEvidence"("runId", "revision", "matchId", "puuid");

-- CreateIndex
CREATE INDEX "ChallengeRunCursor_puuid_updatedAt_idx" ON "ChallengeRunCursor"("puuid", "updatedAt");

-- CreateIndex
CREATE INDEX "ChallengeRunMatchTrigger_matchId_createdAt_idx" ON "ChallengeRunMatchTrigger"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "DuelEvent_guildId_eventState_createdAt_idx" ON "DuelEvent"("guildId", "eventState", "createdAt");

-- CreateIndex
CREATE INDEX "DuelCompetitor_guildId_kind_createdAt_idx" ON "DuelCompetitor"("guildId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "DuelCompetitorMember_playerId_createdAt_idx" ON "DuelCompetitorMember"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "DuelCompetitorMember_accountId_idx" ON "DuelCompetitorMember"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "DuelCompetitorMember_competitorId_position_key" ON "DuelCompetitorMember"("competitorId", "position");

-- CreateIndex
CREATE INDEX "DuelDisclosureAcceptance_discordId_acceptedAt_idx" ON "DuelDisclosureAcceptance"("discordId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DuelDisclosureAcceptance_guildId_playerId_disclosureVersion_key" ON "DuelDisclosureAcceptance"("guildId", "playerId", "disclosureVersion");

-- CreateIndex
CREATE INDEX "DuelEventEntrant_eventId_registrationState_idx" ON "DuelEventEntrant"("eventId", "registrationState");

-- CreateIndex
CREATE UNIQUE INDEX "DuelEventEntrant_eventId_seed_key" ON "DuelEventEntrant"("eventId", "seed");

-- CreateIndex
CREATE UNIQUE INDEX "DuelSeries_workflowId_key" ON "DuelSeries"("workflowId");

-- CreateIndex
CREATE INDEX "DuelSeries_guildId_seriesState_createdAt_idx" ON "DuelSeries"("guildId", "seriesState", "createdAt");

-- CreateIndex
CREATE INDEX "DuelSeries_eventId_roundNumber_position_idx" ON "DuelSeries"("eventId", "roundNumber", "position");

-- CreateIndex
CREATE INDEX "DuelSeries_deadlineAt_seriesState_idx" ON "DuelSeries"("deadlineAt", "seriesState");

-- CreateIndex
CREATE UNIQUE INDEX "DuelSeries_eventId_bracket_roundNumber_position_key" ON "DuelSeries"("eventId", "bracket", "roundNumber", "position");

-- CreateIndex
CREATE INDEX "DuelSeriesParticipant_discordId_acceptedAt_idx" ON "DuelSeriesParticipant"("discordId", "acceptedAt");

-- CreateIndex
CREATE INDEX "DuelSeriesParticipant_seriesId_readyAt_idx" ON "DuelSeriesParticipant"("seriesId", "readyAt");

-- CreateIndex
CREATE UNIQUE INDEX "DuelGame_tournamentLobbyId_key" ON "DuelGame"("tournamentLobbyId");

-- CreateIndex
CREATE UNIQUE INDEX "DuelGame_matchId_key" ON "DuelGame"("matchId");

-- CreateIndex
CREATE INDEX "DuelGame_seriesId_gameState_idx" ON "DuelGame"("seriesId", "gameState");

-- CreateIndex
CREATE UNIQUE INDEX "DuelGame_seriesId_gameNumber_key" ON "DuelGame"("seriesId", "gameNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DuelAuditDecision_idempotencyKey_key" ON "DuelAuditDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DuelAuditDecision_seriesId_createdAt_idx" ON "DuelAuditDecision"("seriesId", "createdAt");

-- CreateIndex
CREATE INDEX "DuelRecord_guildId_scope_wins_idx" ON "DuelRecord"("guildId", "scope", "wins");

-- CreateIndex
CREATE UNIQUE INDEX "DuelRecord_guildId_scope_subjectKey_opponentKey_key" ON "DuelRecord"("guildId", "scope", "subjectKey", "opponentKey");

-- CreateIndex
CREATE UNIQUE INDEX "DuelStatusOutbox_dedupeKey_key" ON "DuelStatusOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "DuelStatusOutbox_deliveryStatus_createdAt_idx" ON "DuelStatusOutbox"("deliveryStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "HallRecordCell" ADD CONSTRAINT "HallRecordCell_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "HallSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallBaselineRun" ADD CONSTRAINT "HallBaselineRun_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "HallSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeTemplateVersion" ADD CONSTRAINT "ChallengeTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChallengeTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeDraft" ADD CONSTRAINT "ChallengeDraft_ownerDiscordId_fkey" FOREIGN KEY ("ownerDiscordId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRun" ADD CONSTRAINT "ChallengeRun_ownerDiscordId_fkey" FOREIGN KEY ("ownerDiscordId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRun" ADD CONSTRAINT "ChallengeRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChallengeTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRun" ADD CONSTRAINT "ChallengeRun_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ChallengeTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeActiveRun" ADD CONSTRAINT "ChallengeActiveRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChallengeTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeActiveRun" ADD CONSTRAINT "ChallengeActiveRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChallengeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRunRevision" ADD CONSTRAINT "ChallengeRunRevision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChallengeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRunSnapshot" ADD CONSTRAINT "ChallengeRunSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChallengeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRunEvidence" ADD CONSTRAINT "ChallengeRunEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChallengeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRunCursor" ADD CONSTRAINT "ChallengeRunCursor_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChallengeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeRunMatchTrigger" ADD CONSTRAINT "ChallengeRunMatchTrigger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChallengeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelCompetitorMember" ADD CONSTRAINT "DuelCompetitorMember_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "DuelCompetitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelDisclosureAcceptance" ADD CONSTRAINT "DuelDisclosureAcceptance_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelEventEntrant" ADD CONSTRAINT "DuelEventEntrant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DuelEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelEventEntrant" ADD CONSTRAINT "DuelEventEntrant_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "DuelCompetitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelEventRoundOverride" ADD CONSTRAINT "DuelEventRoundOverride_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DuelEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelSeries" ADD CONSTRAINT "DuelSeries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DuelEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelSeries" ADD CONSTRAINT "DuelSeries_competitorOneId_fkey" FOREIGN KEY ("competitorOneId") REFERENCES "DuelCompetitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelSeries" ADD CONSTRAINT "DuelSeries_competitorTwoId_fkey" FOREIGN KEY ("competitorTwoId") REFERENCES "DuelCompetitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelSeriesParticipant" ADD CONSTRAINT "DuelSeriesParticipant_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "DuelSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelGame" ADD CONSTRAINT "DuelGame_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "DuelSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelGame" ADD CONSTRAINT "DuelGame_tournamentLobbyId_fkey" FOREIGN KEY ("tournamentLobbyId") REFERENCES "TournamentLobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelAuditDecision" ADD CONSTRAINT "DuelAuditDecision_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "DuelSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
