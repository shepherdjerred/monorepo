-- Give each user an opaque, app-owned analytics identity.
--
-- The SPA previously called `posthog.identify()` with the Discord snowflake, so
-- an external identifier became the durable join key for a person's events and
-- session recordings. The analytics registry forbids sending Discord user ids,
-- so the browser now identifies with this value instead.
--
-- Existing rows get a fresh UUIDv4 built from `randomblob`, matching the
-- expression used for `GuildInstall.analyticsInstallationId`. SQLite cannot add
-- a NOT NULL UNIQUE column with a non-constant default, so the table is rebuilt.
-- Foreign keys reference `User.discordId`, which this migration preserves
-- unchanged, so every child row stays attached to the same user.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "discordId" TEXT NOT NULL PRIMARY KEY,
    "discordUsername" TEXT NOT NULL,
    "discordAvatar" TEXT,
    "discordAccessToken" TEXT,
    "discordRefreshToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "analyticsUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_User" (
  "discordId",
  "discordUsername",
  "discordAvatar",
  "discordAccessToken",
  "discordRefreshToken",
  "tokenExpiresAt",
  "analyticsUserId",
  "createdAt",
  "updatedAt"
)
SELECT
  "discordId",
  "discordUsername",
  "discordAvatar",
  "discordAccessToken",
  "discordRefreshToken",
  "tokenExpiresAt",
  lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', (random() & 3) + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  "createdAt",
  "updatedAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_analyticsUserId_key" ON "User"("analyticsUserId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
