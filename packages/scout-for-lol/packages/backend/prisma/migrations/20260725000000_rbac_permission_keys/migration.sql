-- RBAC: ServerPermission now stores canonical "resource:action" catalog keys
-- (@scout-for-lol/data). Rewrite the two legacy Discord-command grant strings to
-- their new keys; unknown/legacy strings that linger are simply ignored by the
-- resolver's parser, so this is a best-effort cleanup, not a correctness gate.
UPDATE "ServerPermission" SET "permission" = 'competitions:create' WHERE "permission" = 'CREATE_COMPETITION';
UPDATE "ServerPermission" SET "permission" = 'reports:create' WHERE "permission" = 'CREATE_REPORT';

-- Indexes for the new read paths (resolveGuildPermissions, roles.list).
CREATE INDEX "ServerPermission_serverId_discordUserId_idx" ON "ServerPermission"("serverId", "discordUserId");
CREATE INDEX "ServerPermission_serverId_idx" ON "ServerPermission"("serverId");
