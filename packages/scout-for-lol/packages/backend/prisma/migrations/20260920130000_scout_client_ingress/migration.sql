BEGIN;

CREATE TABLE "ScoutClientPairing" (
  "id" TEXT NOT NULL,
  "secretDigest" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "architecture" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "protocolVersion" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "exchangedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutClientPairing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScoutClientPairing_platform_check" CHECK ("platform" IN ('windows', 'macos')),
  CONSTRAINT "ScoutClientPairing_architecture_check" CHECK ("architecture" IN ('x86_64', 'aarch64')),
  CONSTRAINT "ScoutClientPairing_state_check" CHECK ("state" IN ('PENDING', 'APPROVED', 'EXCHANGED', 'EXPIRED')),
  CONSTRAINT "ScoutClientPairing_protocol_check" CHECK ("protocolVersion" = 1)
);

CREATE UNIQUE INDEX "ScoutClientPairing_secretDigest_key" ON "ScoutClientPairing"("secretDigest");
CREATE INDEX "ScoutClientPairing_state_expiresAt_idx" ON "ScoutClientPairing"("state", "expiresAt");
CREATE INDEX "ScoutClientPairing_approvedById_createdAt_idx" ON "ScoutClientPairing"("approvedById", "createdAt");

CREATE TABLE "ScoutClientDevice" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "pairingId" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "architecture" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "protocolVersion" INTEGER NOT NULL,
  "deviceState" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutClientDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScoutClientDevice_platform_check" CHECK ("platform" IN ('windows', 'macos')),
  CONSTRAINT "ScoutClientDevice_architecture_check" CHECK ("architecture" IN ('x86_64', 'aarch64')),
  CONSTRAINT "ScoutClientDevice_state_check" CHECK ("deviceState" IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT "ScoutClientDevice_protocol_check" CHECK ("protocolVersion" = 1)
);

CREATE UNIQUE INDEX "ScoutClientDevice_pairingId_key" ON "ScoutClientDevice"("pairingId");
CREATE UNIQUE INDEX "ScoutClientDevice_tokenDigest_key" ON "ScoutClientDevice"("tokenDigest");
CREATE INDEX "ScoutClientDevice_ownerId_deviceState_idx" ON "ScoutClientDevice"("ownerId", "deviceState");
CREATE INDEX "ScoutClientDevice_lastSeenAt_idx" ON "ScoutClientDevice"("lastSeenAt");

CREATE TABLE "ScoutClientDeviceVersion" (
  "deviceId" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutClientDeviceVersion_pkey" PRIMARY KEY ("deviceId", "appVersion")
);

CREATE INDEX "ScoutClientDeviceVersion_appVersion_lastSeenAt_idx" ON "ScoutClientDeviceVersion"("appVersion", "lastSeenAt");

CREATE TABLE "ScoutClientObservation" (
  "observationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "protocolVersion" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "appVersion" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "leaguePatch" TEXT,
  "platformId" TEXT,
  "localPuuid" TEXT,
  "lobbyId" TEXT,
  "gameId" TEXT,
  "payload" JSONB NOT NULL,
  "bodyDigest" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "quarantineReason" TEXT,
  CONSTRAINT "ScoutClientObservation_pkey" PRIMARY KEY ("observationId"),
  CONSTRAINT "ScoutClientObservation_kind_check" CHECK ("kind" IN ('account_profile', 'champion_mastery', 'challenges', 'clash', 'lobby', 'champ_select', 'gameflow', 'live_game_frame', 'post_game', 'replay_status')),
  CONSTRAINT "ScoutClientObservation_disposition_check" CHECK ("disposition" IN ('ACCEPTED', 'QUARANTINED')),
  CONSTRAINT "ScoutClientObservation_protocol_check" CHECK ("protocolVersion" = 1),
  CONSTRAINT "ScoutClientObservation_schema_check" CHECK ("schemaVersion" = 1),
  CONSTRAINT "ScoutClientObservation_quarantine_check" CHECK (("disposition" = 'QUARANTINED') = ("quarantineReason" IS NOT NULL))
);

CREATE UNIQUE INDEX "ScoutClientObservation_deviceId_sequence_key" ON "ScoutClientObservation"("deviceId", "sequence");
CREATE INDEX "ScoutClientObservation_kind_capturedAt_idx" ON "ScoutClientObservation"("kind", "capturedAt");
CREATE INDEX "ScoutClientObservation_gameId_kind_idx" ON "ScoutClientObservation"("gameId", "kind");
CREATE INDEX "ScoutClientObservation_lobbyId_kind_idx" ON "ScoutClientObservation"("lobbyId", "kind");
CREATE INDEX "ScoutClientObservation_disposition_receivedAt_idx" ON "ScoutClientObservation"("disposition", "receivedAt");

CREATE TABLE "ScoutClientCanonicalMatch" (
    "riotMatchId" TEXT NOT NULL,
    "sourceObservationId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoutClientCanonicalMatch_pkey" PRIMARY KEY ("riotMatchId")
);

CREATE UNIQUE INDEX "ScoutClientCanonicalMatch_sourceObservationId_key" ON "ScoutClientCanonicalMatch"("sourceObservationId");
CREATE INDEX "ScoutClientCanonicalMatch_selectedAt_idx" ON "ScoutClientCanonicalMatch"("selectedAt");

ALTER TABLE "ScoutClientCanonicalMatch" ADD CONSTRAINT "ScoutClientCanonicalMatch_sourceObservationId_fkey" FOREIGN KEY ("sourceObservationId") REFERENCES "ScoutClientObservation"("observationId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ScoutClientPlayerSnapshot" (
    "localPuuid" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutClientPlayerSnapshot_pkey" PRIMARY KEY ("localPuuid", "resource")
);

CREATE UNIQUE INDEX "ScoutClientPlayerSnapshot_observationId_key" ON "ScoutClientPlayerSnapshot"("observationId");
CREATE INDEX "ScoutClientPlayerSnapshot_kind_capturedAt_idx" ON "ScoutClientPlayerSnapshot"("kind", "capturedAt");

ALTER TABLE "ScoutClientPlayerSnapshot" ADD CONSTRAINT "ScoutClientPlayerSnapshot_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ScoutClientObservation"("observationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomGame" ADD COLUMN "matchId" TEXT;
ALTER TABLE "CustomGame" ADD COLUMN "observedLobbyId" TEXT;
ALTER TABLE "CustomGame" ADD COLUMN "lobbyObservationId" TEXT;
CREATE UNIQUE INDEX "CustomGame_matchId_key" ON "CustomGame"("matchId");
CREATE INDEX "CustomGame_observedLobbyId_idx" ON "CustomGame"("observedLobbyId");
CREATE UNIQUE INDEX "CustomGame_lobbyObservationId_key" ON "CustomGame"("lobbyObservationId");

ALTER TABLE "DuelGame" ADD COLUMN "observedLobbyId" TEXT;
ALTER TABLE "DuelGame" ADD COLUMN "lobbyObservationId" TEXT;
CREATE INDEX "DuelGame_observedLobbyId_idx" ON "DuelGame"("observedLobbyId");
CREATE UNIQUE INDEX "DuelGame_lobbyObservationId_key" ON "DuelGame"("lobbyObservationId");

CREATE TABLE "ScoutClientReplayArtifact" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "bytes" BIGINT NOT NULL,
  "uploadState" TEXT NOT NULL,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutClientReplayArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScoutClientReplayArtifact_state_check" CHECK ("uploadState" IN ('UPLOADING', 'COMPLETED', 'FAILED', 'REJECTED')),
  CONSTRAINT "ScoutClientReplayArtifact_completion_check" CHECK (("uploadState" = 'COMPLETED') = ("completedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "ScoutClientReplayArtifact_digest_key" ON "ScoutClientReplayArtifact"("digest");
CREATE UNIQUE INDEX "ScoutClientReplayArtifact_objectKey_key" ON "ScoutClientReplayArtifact"("objectKey");
CREATE INDEX "ScoutClientReplayArtifact_gameId_uploadState_idx" ON "ScoutClientReplayArtifact"("gameId", "uploadState");
CREATE INDEX "ScoutClientReplayArtifact_deviceId_createdAt_idx" ON "ScoutClientReplayArtifact"("deviceId", "createdAt");

ALTER TABLE "ScoutClientPairing" ADD CONSTRAINT "ScoutClientPairing_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("discordId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScoutClientDevice" ADD CONSTRAINT "ScoutClientDevice_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutClientDevice" ADD CONSTRAINT "ScoutClientDevice_pairingId_fkey"
  FOREIGN KEY ("pairingId") REFERENCES "ScoutClientPairing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScoutClientDeviceVersion" ADD CONSTRAINT "ScoutClientDeviceVersion_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "ScoutClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutClientObservation" ADD CONSTRAINT "ScoutClientObservation_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "ScoutClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutClientReplayArtifact" ADD CONSTRAINT "ScoutClientReplayArtifact_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "ScoutClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
