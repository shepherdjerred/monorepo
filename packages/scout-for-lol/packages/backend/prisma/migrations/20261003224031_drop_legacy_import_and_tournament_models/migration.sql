-- Retire the one-shot SQLite importer, the Riot Tournament API lobby model,
-- and the legacy report-send claims adopted by report delivery receipts.
--
-- Before merge, the operator confirms on beta and prod that no
-- `report-discord:` claim lacks a ReportDeliveryChunk (or marks those runs
-- UNKNOWN); see the PR. The claims are then history only.

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
DROP TABLE "TournamentLobby";

-- DropTable
DROP TABLE "TournamentLobbyProvision";

-- DropTable
DROP TABLE "TournamentRegistration";

-- Report delivery no longer adopts legacy per-chunk send claims.
DELETE FROM "ScoutEffectClaim" WHERE "key" LIKE 'report-discord:%';
