-- The router is gone: a turn is no longer assigned a route and a primary tool
-- before it runs. `routeDisposition` survives as a post-hoc outcome, and
-- `toolCallCount` records what the turn actually did.
ALTER TABLE "AgentRun" ADD COLUMN "toolCallCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentRun" DROP COLUMN "route";
ALTER TABLE "AgentRun" DROP COLUMN "primaryToolId";
