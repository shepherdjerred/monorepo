-- Revert SQLite DateTime storage back to INTEGER (epoch ms) after the
-- @prisma/adapter-libsql 7.8.0 upgrade defaulted parameter binding to
-- `timestampFormat: "iso8601"`. Mixed INTEGER/TEXT data triggered a SQLite
-- type-affinity bug: `INTEGER <= TEXT` is always TRUE, so `endDate <= now`
-- predicates wrongly matched legacy rows and `handleCompetitionEnds` ended
-- every active competition with a Prisma-6-era endDate.
--
-- Companion change: `src/database/index.ts` now passes
-- `timestampFormat: "unixepoch-ms"` to PrismaLibSql so future writes bind
-- as INTEGER. This migration converts the small post-upgrade tail of TEXT
-- rows back to INTEGER so the storage is uniform.
--
-- Per-column conversion handles two TEXT formats actually seen on disk:
--   * `YYYY-MM-DDTHH:MM:SS.fff+00:00` — Prisma 7 libsql iso8601 default
--   * `YYYY-MM-DD HH:MM:SS`           — SQLite datetime() output from the
--                                       20260511000000 backfill
-- Both are valid strftime() inputs. The CASE leaves any already-INTEGER row
-- untouched, making the migration idempotent.
--
-- Resurrection: at the very end, the four competitions that the bug ended
-- on 2026-05-12 07:45 UTC (Beta) and 2026-05-13 05:15 UTC (Prod) have their
-- end-state nulled out so the dispatcher's self-heal path re-seeds them.
-- Guarded by an `endDate > now` check so a re-run can't resurrect a
-- competition that has since genuinely ended.

-- Helper macro substituted inline per column:
--   CASE
--     WHEN col LIKE '____-__-__T__:__:__.___+__:__'
--          THEN CAST(strftime('%s', col) AS INTEGER) * 1000
--               + CAST(substr(col, 21, 3) AS INTEGER)
--     WHEN col LIKE '____-__-__ __:__:__'
--          THEN CAST(strftime('%s', col) AS INTEGER) * 1000
--     ELSE col  -- already integer/null; idempotent no-op
--   END

-- ─── Subscription ───
UPDATE "Subscription"
SET "createdTime" = CASE
      WHEN "createdTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000 + CAST(substr("createdTime", 21, 3) AS INTEGER)
      WHEN "createdTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000
      ELSE "createdTime" END
WHERE typeof("createdTime") = 'text';

UPDATE "Subscription"
SET "updatedTime" = CASE
      WHEN "updatedTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000 + CAST(substr("updatedTime", 21, 3) AS INTEGER)
      WHEN "updatedTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000
      ELSE "updatedTime" END
WHERE typeof("updatedTime") = 'text';

-- ─── Player ───
UPDATE "Player"
SET "createdTime" = CASE
      WHEN "createdTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000 + CAST(substr("createdTime", 21, 3) AS INTEGER)
      WHEN "createdTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000
      ELSE "createdTime" END
WHERE typeof("createdTime") = 'text';

UPDATE "Player"
SET "updatedTime" = CASE
      WHEN "updatedTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000 + CAST(substr("updatedTime", 21, 3) AS INTEGER)
      WHEN "updatedTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000
      ELSE "updatedTime" END
WHERE typeof("updatedTime") = 'text';

-- ─── Account ───
UPDATE "Account"
SET "lastMatchTime" = CASE
      WHEN "lastMatchTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastMatchTime") AS INTEGER) * 1000 + CAST(substr("lastMatchTime", 21, 3) AS INTEGER)
      WHEN "lastMatchTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastMatchTime") AS INTEGER) * 1000
      ELSE "lastMatchTime" END
WHERE typeof("lastMatchTime") = 'text';

UPDATE "Account"
SET "lastCheckedAt" = CASE
      WHEN "lastCheckedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastCheckedAt") AS INTEGER) * 1000 + CAST(substr("lastCheckedAt", 21, 3) AS INTEGER)
      WHEN "lastCheckedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastCheckedAt") AS INTEGER) * 1000
      ELSE "lastCheckedAt" END
WHERE typeof("lastCheckedAt") = 'text';

UPDATE "Account"
SET "createdTime" = CASE
      WHEN "createdTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000 + CAST(substr("createdTime", 21, 3) AS INTEGER)
      WHEN "createdTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000
      ELSE "createdTime" END
WHERE typeof("createdTime") = 'text';

UPDATE "Account"
SET "updatedTime" = CASE
      WHEN "updatedTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000 + CAST(substr("updatedTime", 21, 3) AS INTEGER)
      WHEN "updatedTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000
      ELSE "updatedTime" END
WHERE typeof("updatedTime") = 'text';

-- ─── MatchRankHistory ───
UPDATE "MatchRankHistory"
SET "matchGameCreationAt" = CASE
      WHEN "matchGameCreationAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "matchGameCreationAt") AS INTEGER) * 1000 + CAST(substr("matchGameCreationAt", 21, 3) AS INTEGER)
      WHEN "matchGameCreationAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "matchGameCreationAt") AS INTEGER) * 1000
      ELSE "matchGameCreationAt" END
WHERE typeof("matchGameCreationAt") = 'text';

UPDATE "MatchRankHistory"
SET "matchGameEndAt" = CASE
      WHEN "matchGameEndAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "matchGameEndAt") AS INTEGER) * 1000 + CAST(substr("matchGameEndAt", 21, 3) AS INTEGER)
      WHEN "matchGameEndAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "matchGameEndAt") AS INTEGER) * 1000
      ELSE "matchGameEndAt" END
WHERE typeof("matchGameEndAt") = 'text';

UPDATE "MatchRankHistory"
SET "capturedAt" = CASE
      WHEN "capturedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "capturedAt") AS INTEGER) * 1000 + CAST(substr("capturedAt", 21, 3) AS INTEGER)
      WHEN "capturedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "capturedAt") AS INTEGER) * 1000
      ELSE "capturedAt" END
WHERE typeof("capturedAt") = 'text';

-- ─── Season ───
UPDATE "Season"
SET "startDate" = CASE
      WHEN "startDate" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "startDate") AS INTEGER) * 1000 + CAST(substr("startDate", 21, 3) AS INTEGER)
      WHEN "startDate" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "startDate") AS INTEGER) * 1000
      ELSE "startDate" END
WHERE typeof("startDate") = 'text';

UPDATE "Season"
SET "endDate" = CASE
      WHEN "endDate" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "endDate") AS INTEGER) * 1000 + CAST(substr("endDate", 21, 3) AS INTEGER)
      WHEN "endDate" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "endDate") AS INTEGER) * 1000
      ELSE "endDate" END
WHERE typeof("endDate") = 'text';

-- ─── Competition ───
UPDATE "Competition"
SET "startDate" = CASE
      WHEN "startDate" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "startDate") AS INTEGER) * 1000 + CAST(substr("startDate", 21, 3) AS INTEGER)
      WHEN "startDate" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "startDate") AS INTEGER) * 1000
      ELSE "startDate" END
WHERE typeof("startDate") = 'text';

UPDATE "Competition"
SET "endDate" = CASE
      WHEN "endDate" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "endDate") AS INTEGER) * 1000 + CAST(substr("endDate", 21, 3) AS INTEGER)
      WHEN "endDate" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "endDate") AS INTEGER) * 1000
      ELSE "endDate" END
WHERE typeof("endDate") = 'text';

UPDATE "Competition"
SET "startProcessedAt" = CASE
      WHEN "startProcessedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "startProcessedAt") AS INTEGER) * 1000 + CAST(substr("startProcessedAt", 21, 3) AS INTEGER)
      WHEN "startProcessedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "startProcessedAt") AS INTEGER) * 1000
      ELSE "startProcessedAt" END
WHERE typeof("startProcessedAt") = 'text';

UPDATE "Competition"
SET "endProcessedAt" = CASE
      WHEN "endProcessedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "endProcessedAt") AS INTEGER) * 1000 + CAST(substr("endProcessedAt", 21, 3) AS INTEGER)
      WHEN "endProcessedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "endProcessedAt") AS INTEGER) * 1000
      ELSE "endProcessedAt" END
WHERE typeof("endProcessedAt") = 'text';

UPDATE "Competition"
SET "startNotifiedAt" = CASE
      WHEN "startNotifiedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "startNotifiedAt") AS INTEGER) * 1000 + CAST(substr("startNotifiedAt", 21, 3) AS INTEGER)
      WHEN "startNotifiedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "startNotifiedAt") AS INTEGER) * 1000
      ELSE "startNotifiedAt" END
WHERE typeof("startNotifiedAt") = 'text';

UPDATE "Competition"
SET "endNotifiedAt" = CASE
      WHEN "endNotifiedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "endNotifiedAt") AS INTEGER) * 1000 + CAST(substr("endNotifiedAt", 21, 3) AS INTEGER)
      WHEN "endNotifiedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "endNotifiedAt") AS INTEGER) * 1000
      ELSE "endNotifiedAt" END
WHERE typeof("endNotifiedAt") = 'text';

UPDATE "Competition"
SET "nextScheduledUpdateAt" = CASE
      WHEN "nextScheduledUpdateAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "nextScheduledUpdateAt") AS INTEGER) * 1000 + CAST(substr("nextScheduledUpdateAt", 21, 3) AS INTEGER)
      WHEN "nextScheduledUpdateAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "nextScheduledUpdateAt") AS INTEGER) * 1000
      ELSE "nextScheduledUpdateAt" END
WHERE typeof("nextScheduledUpdateAt") = 'text';

UPDATE "Competition"
SET "lastScheduledUpdateAt" = CASE
      WHEN "lastScheduledUpdateAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastScheduledUpdateAt") AS INTEGER) * 1000 + CAST(substr("lastScheduledUpdateAt", 21, 3) AS INTEGER)
      WHEN "lastScheduledUpdateAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastScheduledUpdateAt") AS INTEGER) * 1000
      ELSE "lastScheduledUpdateAt" END
WHERE typeof("lastScheduledUpdateAt") = 'text';

UPDATE "Competition"
SET "createdTime" = CASE
      WHEN "createdTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000 + CAST(substr("createdTime", 21, 3) AS INTEGER)
      WHEN "createdTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdTime") AS INTEGER) * 1000
      ELSE "createdTime" END
WHERE typeof("createdTime") = 'text';

UPDATE "Competition"
SET "updatedTime" = CASE
      WHEN "updatedTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000 + CAST(substr("updatedTime", 21, 3) AS INTEGER)
      WHEN "updatedTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedTime") AS INTEGER) * 1000
      ELSE "updatedTime" END
WHERE typeof("updatedTime") = 'text';

-- ─── CompetitionParticipant ───
UPDATE "CompetitionParticipant"
SET "invitedAt" = CASE
      WHEN "invitedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "invitedAt") AS INTEGER) * 1000 + CAST(substr("invitedAt", 21, 3) AS INTEGER)
      WHEN "invitedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "invitedAt") AS INTEGER) * 1000
      ELSE "invitedAt" END
WHERE typeof("invitedAt") = 'text';

UPDATE "CompetitionParticipant"
SET "joinedAt" = CASE
      WHEN "joinedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "joinedAt") AS INTEGER) * 1000 + CAST(substr("joinedAt", 21, 3) AS INTEGER)
      WHEN "joinedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "joinedAt") AS INTEGER) * 1000
      ELSE "joinedAt" END
WHERE typeof("joinedAt") = 'text';

UPDATE "CompetitionParticipant"
SET "leftAt" = CASE
      WHEN "leftAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "leftAt") AS INTEGER) * 1000 + CAST(substr("leftAt", 21, 3) AS INTEGER)
      WHEN "leftAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "leftAt") AS INTEGER) * 1000
      ELSE "leftAt" END
WHERE typeof("leftAt") = 'text';

-- ─── CompetitionSnapshot ───
UPDATE "CompetitionSnapshot"
SET "snapshotTime" = CASE
      WHEN "snapshotTime" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "snapshotTime") AS INTEGER) * 1000 + CAST(substr("snapshotTime", 21, 3) AS INTEGER)
      WHEN "snapshotTime" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "snapshotTime") AS INTEGER) * 1000
      ELSE "snapshotTime" END
WHERE typeof("snapshotTime") = 'text';

-- ─── ServerPermission ───
UPDATE "ServerPermission"
SET "grantedAt" = CASE
      WHEN "grantedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "grantedAt") AS INTEGER) * 1000 + CAST(substr("grantedAt", 21, 3) AS INTEGER)
      WHEN "grantedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "grantedAt") AS INTEGER) * 1000
      ELSE "grantedAt" END
WHERE typeof("grantedAt") = 'text';

-- ─── GuildPermissionError ───
UPDATE "GuildPermissionError"
SET "firstOccurrence" = CASE
      WHEN "firstOccurrence" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "firstOccurrence") AS INTEGER) * 1000 + CAST(substr("firstOccurrence", 21, 3) AS INTEGER)
      WHEN "firstOccurrence" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "firstOccurrence") AS INTEGER) * 1000
      ELSE "firstOccurrence" END
WHERE typeof("firstOccurrence") = 'text';

UPDATE "GuildPermissionError"
SET "lastOccurrence" = CASE
      WHEN "lastOccurrence" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastOccurrence") AS INTEGER) * 1000 + CAST(substr("lastOccurrence", 21, 3) AS INTEGER)
      WHEN "lastOccurrence" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastOccurrence") AS INTEGER) * 1000
      ELSE "lastOccurrence" END
WHERE typeof("lastOccurrence") = 'text';

UPDATE "GuildPermissionError"
SET "lastSuccessfulSend" = CASE
      WHEN "lastSuccessfulSend" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastSuccessfulSend") AS INTEGER) * 1000 + CAST(substr("lastSuccessfulSend", 21, 3) AS INTEGER)
      WHEN "lastSuccessfulSend" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastSuccessfulSend") AS INTEGER) * 1000
      ELSE "lastSuccessfulSend" END
WHERE typeof("lastSuccessfulSend") = 'text';

UPDATE "GuildPermissionError"
SET "createdAt" = CASE
      WHEN "createdAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 + CAST(substr("createdAt", 21, 3) AS INTEGER)
      WHEN "createdAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000
      ELSE "createdAt" END
WHERE typeof("createdAt") = 'text';

UPDATE "GuildPermissionError"
SET "updatedAt" = CASE
      WHEN "updatedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 + CAST(substr("updatedAt", 21, 3) AS INTEGER)
      WHEN "updatedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000
      ELSE "updatedAt" END
WHERE typeof("updatedAt") = 'text';

-- ─── User ───
UPDATE "User"
SET "tokenExpiresAt" = CASE
      WHEN "tokenExpiresAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "tokenExpiresAt") AS INTEGER) * 1000 + CAST(substr("tokenExpiresAt", 21, 3) AS INTEGER)
      WHEN "tokenExpiresAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "tokenExpiresAt") AS INTEGER) * 1000
      ELSE "tokenExpiresAt" END
WHERE typeof("tokenExpiresAt") = 'text';

UPDATE "User"
SET "createdAt" = CASE
      WHEN "createdAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 + CAST(substr("createdAt", 21, 3) AS INTEGER)
      WHEN "createdAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000
      ELSE "createdAt" END
WHERE typeof("createdAt") = 'text';

UPDATE "User"
SET "updatedAt" = CASE
      WHEN "updatedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 + CAST(substr("updatedAt", 21, 3) AS INTEGER)
      WHEN "updatedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000
      ELSE "updatedAt" END
WHERE typeof("updatedAt") = 'text';

-- ─── ApiToken ───
UPDATE "ApiToken"
SET "lastUsedAt" = CASE
      WHEN "lastUsedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastUsedAt") AS INTEGER) * 1000 + CAST(substr("lastUsedAt", 21, 3) AS INTEGER)
      WHEN "lastUsedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastUsedAt") AS INTEGER) * 1000
      ELSE "lastUsedAt" END
WHERE typeof("lastUsedAt") = 'text';

UPDATE "ApiToken"
SET "expiresAt" = CASE
      WHEN "expiresAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "expiresAt") AS INTEGER) * 1000 + CAST(substr("expiresAt", 21, 3) AS INTEGER)
      WHEN "expiresAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "expiresAt") AS INTEGER) * 1000
      ELSE "expiresAt" END
WHERE typeof("expiresAt") = 'text';

UPDATE "ApiToken"
SET "createdAt" = CASE
      WHEN "createdAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 + CAST(substr("createdAt", 21, 3) AS INTEGER)
      WHEN "createdAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000
      ELSE "createdAt" END
WHERE typeof("createdAt") = 'text';

UPDATE "ApiToken"
SET "revokedAt" = CASE
      WHEN "revokedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "revokedAt") AS INTEGER) * 1000 + CAST(substr("revokedAt", 21, 3) AS INTEGER)
      WHEN "revokedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "revokedAt") AS INTEGER) * 1000
      ELSE "revokedAt" END
WHERE typeof("revokedAt") = 'text';

-- ─── DesktopClient ───
UPDATE "DesktopClient"
SET "lastHeartbeat" = CASE
      WHEN "lastHeartbeat" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastHeartbeat") AS INTEGER) * 1000 + CAST(substr("lastHeartbeat", 21, 3) AS INTEGER)
      WHEN "lastHeartbeat" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastHeartbeat") AS INTEGER) * 1000
      ELSE "lastHeartbeat" END
WHERE typeof("lastHeartbeat") = 'text';

UPDATE "DesktopClient"
SET "createdAt" = CASE
      WHEN "createdAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 + CAST(substr("createdAt", 21, 3) AS INTEGER)
      WHEN "createdAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000
      ELSE "createdAt" END
WHERE typeof("createdAt") = 'text';

UPDATE "DesktopClient"
SET "updatedAt" = CASE
      WHEN "updatedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 + CAST(substr("updatedAt", 21, 3) AS INTEGER)
      WHEN "updatedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000
      ELSE "updatedAt" END
WHERE typeof("updatedAt") = 'text';

-- ─── SoundPack ───
UPDATE "SoundPack"
SET "createdAt" = CASE
      WHEN "createdAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 + CAST(substr("createdAt", 21, 3) AS INTEGER)
      WHEN "createdAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000
      ELSE "createdAt" END
WHERE typeof("createdAt") = 'text';

UPDATE "SoundPack"
SET "updatedAt" = CASE
      WHEN "updatedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 + CAST(substr("updatedAt", 21, 3) AS INTEGER)
      WHEN "updatedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000
      ELSE "updatedAt" END
WHERE typeof("updatedAt") = 'text';

-- ─── StoredSound ───
UPDATE "StoredSound"
SET "createdAt" = CASE
      WHEN "createdAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 + CAST(substr("createdAt", 21, 3) AS INTEGER)
      WHEN "createdAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000
      ELSE "createdAt" END
WHERE typeof("createdAt") = 'text';

-- ─── GuildInstall ───
UPDATE "GuildInstall"
SET "installedAt" = CASE
      WHEN "installedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "installedAt") AS INTEGER) * 1000 + CAST(substr("installedAt", 21, 3) AS INTEGER)
      WHEN "installedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "installedAt") AS INTEGER) * 1000
      ELSE "installedAt" END
WHERE typeof("installedAt") = 'text';

UPDATE "GuildInstall"
SET "outreach3dSentAt" = CASE
      WHEN "outreach3dSentAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "outreach3dSentAt") AS INTEGER) * 1000 + CAST(substr("outreach3dSentAt", 21, 3) AS INTEGER)
      WHEN "outreach3dSentAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "outreach3dSentAt") AS INTEGER) * 1000
      ELSE "outreach3dSentAt" END
WHERE typeof("outreach3dSentAt") = 'text';

UPDATE "GuildInstall"
SET "outreach14dSentAt" = CASE
      WHEN "outreach14dSentAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "outreach14dSentAt") AS INTEGER) * 1000 + CAST(substr("outreach14dSentAt", 21, 3) AS INTEGER)
      WHEN "outreach14dSentAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "outreach14dSentAt") AS INTEGER) * 1000
      ELSE "outreach14dSentAt" END
WHERE typeof("outreach14dSentAt") = 'text';

-- ─── BotState ───
UPDATE "BotState"
SET "lastSuccessfulPollAt" = CASE
      WHEN "lastSuccessfulPollAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "lastSuccessfulPollAt") AS INTEGER) * 1000 + CAST(substr("lastSuccessfulPollAt", 21, 3) AS INTEGER)
      WHEN "lastSuccessfulPollAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "lastSuccessfulPollAt") AS INTEGER) * 1000
      ELSE "lastSuccessfulPollAt" END
WHERE typeof("lastSuccessfulPollAt") = 'text';

UPDATE "BotState"
SET "updatedAt" = CASE
      WHEN "updatedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 + CAST(substr("updatedAt", 21, 3) AS INTEGER)
      WHEN "updatedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000
      ELSE "updatedAt" END
WHERE typeof("updatedAt") = 'text';

-- ─── ActiveGame ───
UPDATE "ActiveGame"
SET "detectedAt" = CASE
      WHEN "detectedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "detectedAt") AS INTEGER) * 1000 + CAST(substr("detectedAt", 21, 3) AS INTEGER)
      WHEN "detectedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "detectedAt") AS INTEGER) * 1000
      ELSE "detectedAt" END
WHERE typeof("detectedAt") = 'text';

UPDATE "ActiveGame"
SET "expiresAt" = CASE
      WHEN "expiresAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "expiresAt") AS INTEGER) * 1000 + CAST(substr("expiresAt", 21, 3) AS INTEGER)
      WHEN "expiresAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "expiresAt") AS INTEGER) * 1000
      ELSE "expiresAt" END
WHERE typeof("expiresAt") = 'text';

UPDATE "ActiveGame"
SET "updatedAt" = CASE
      WHEN "updatedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 + CAST(substr("updatedAt", 21, 3) AS INTEGER)
      WHEN "updatedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000
      ELSE "updatedAt" END
WHERE typeof("updatedAt") = 'text';

-- ─── GameEventLog ───
UPDATE "GameEventLog"
SET "timestamp" = CASE
      WHEN "timestamp" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "timestamp") AS INTEGER) * 1000 + CAST(substr("timestamp", 21, 3) AS INTEGER)
      WHEN "timestamp" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "timestamp") AS INTEGER) * 1000
      ELSE "timestamp" END
WHERE typeof("timestamp") = 'text';

-- ─── MatchAiAttempt ───
UPDATE "MatchAiAttempt"
SET "attemptedAt" = CASE
      WHEN "attemptedAt" LIKE '____-__-__T__:__:__.___+__:__'
        THEN CAST(strftime('%s', "attemptedAt") AS INTEGER) * 1000 + CAST(substr("attemptedAt", 21, 3) AS INTEGER)
      WHEN "attemptedAt" LIKE '____-__-__ __:__:__'
        THEN CAST(strftime('%s', "attemptedAt") AS INTEGER) * 1000
      ELSE "attemptedAt" END
WHERE typeof("attemptedAt") = 'text';

-- ─── Resurrection of the four wrongly-ended competitions ────────────────────
-- Beta tick at 2026-05-12T07:45:00.045Z = 1778571900045 ms
-- Prod tick at 2026-05-13T05:15:00.014Z = 1778649300014 ms
-- After the column conversions above, both endProcessedAt values are integers,
-- so we can match them as integers here. The `endDate > now` guard makes this
-- safe to re-run after any of the four rows have legitimately ended later.
UPDATE "Competition"
SET "endProcessedAt"           = NULL,
    "endNotifiedAt"            = NULL,
    "endNotificationMessageId" = NULL,
    "nextScheduledUpdateAt"    = NULL
WHERE "isCancelled"     = 0
  AND "endProcessedAt" IN (1778571900045, 1778649300014)
  AND "endDate" > CAST(strftime('%s', 'now') AS INTEGER) * 1000;
