import { router } from "@shepherdjerred/sentinel/trpc/trpc.ts";
import { statsRouter } from "./stats.router.ts";
import { agentRouter } from "./agent.router.ts";
import { jobRouter } from "./job.router.ts";
import { approvalRouter } from "./approval.router.ts";
import { sessionRouter } from "./session.router.ts";
import { conversationRouter } from "./conversation.router.ts";

export const appRouter = router({
  stats: statsRouter,
  agent: agentRouter,
  job: jobRouter,
  approval: approvalRouter,
  session: sessionRouter,
  conversation: conversationRouter,
});

export type AppRouter = typeof appRouter;
