-- A guild the reconcile-removed-guilds sweep saw missing from the client cache
-- and unconfirmed by a live API fetch (10004 Unknown Guild). Cleanup only
-- proceeds once a candidate is re-observed missing on a later calendar day,
-- so a same-day Discord outage can't be mistaken for a real removal.
CREATE TABLE "GuildRemovalCandidate" (
    "serverId" TEXT NOT NULL PRIMARY KEY,
    "firstDetectedAt" DATETIME NOT NULL,
    "lastCheckedAt" DATETIME NOT NULL
);
