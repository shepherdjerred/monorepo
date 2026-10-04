-- Retire the one-shot SQLite importer, the Riot Tournament API lobby model,
-- the Hall and Duel outbox tables (unread since #3413), and the legacy
-- report-send claims adopted by report delivery receipts.
--
-- Before merge, the operator runs the read-only report-claim preflight on
-- beta and prod; see the PR. The statements below are correct whatever it
-- returns.

-- The importer's raw receipt table (not a Prisma model).
DROP TABLE IF EXISTS "_legacy_sqlite_import";

-- DropForeignKey
ALTER TABLE "CustomGame" DROP CONSTRAINT "CustomGame_tournamentLobbyId_fkey";

-- DropForeignKey
ALTER TABLE "DuelGame" DROP CONSTRAINT "DuelGame_tournamentLobbyId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentLobbyProvision" DROP CONSTRAINT "TournamentLobbyProvision_lobbyId_fkey";

-- DropIndex
DROP INDEX "CustomGame_tournamentLobbyId_key";

-- DropIndex
DROP INDEX "DuelGame_tournamentLobbyId_key";

-- AlterTable
ALTER TABLE "CustomGame" DROP COLUMN "tournamentLobbyId";

-- AlterTable
ALTER TABLE "DuelGame" DROP COLUMN "tournamentLobbyId";

-- AlterTable
ALTER TABLE "GuildPermissionError" DROP COLUMN "ownerNotified";

-- DropTable
DROP TABLE "DuelStatusOutbox";

-- DropTable
DROP TABLE "HallRecordBreakOutbox";

-- DropTable
DROP TABLE "TournamentLobby";

-- DropTable
DROP TABLE "TournamentLobbyProvision";

-- DropTable
DROP TABLE "TournamentRegistration";

-- Report delivery no longer adopts legacy per-chunk send claims. A run that
-- still awaits delivery, has a legacy claim, and has no delivery receipt
-- would otherwise freeze fresh PENDING chunks and send again, although an
-- unfinished claim may already have reached Discord. Move those runs to the
-- terminal NOT_REQUESTED state, which the dispatcher and the operator queue
-- both ignore, with the reason recorded; then retire the claims.
UPDATE "ReportRun" AS run
SET "deliveryState" = 'NOT_REQUESTED',
    "deliveryError" = 'Legacy report-discord send claim retired before delivery receipts; outcome unknown, not retried'
WHERE run."deliveryState" IN ('PENDING', 'UNKNOWN')
  AND EXISTS (
    SELECT 1 FROM "ScoutEffectClaim" AS claim
    WHERE claim."key" LIKE 'report-discord:' || run.id::text || ':%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ReportDeliveryChunk" AS chunk
    WHERE chunk."reportRunId" = run.id
  );

DELETE FROM "ScoutEffectClaim" WHERE "key" LIKE 'report-discord:%';
