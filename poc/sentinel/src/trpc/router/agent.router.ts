import { router, publicProcedure } from "@shepherdjerred/sentinel/trpc/trpc.ts";
import { agentRegistry } from "@shepherdjerred/sentinel/agents/registry.ts";

export const agentRouter = router({
  list: publicProcedure.query(() => {
    return [...agentRegistry.values()].map((agent) => ({
      name: agent.name,
      description: agent.description,
      permissionTier: agent.permissionTier,
      maxTurns: agent.maxTurns,
      tools: agent.tools,
      triggers: agent.triggers,
    }));
  }),
});
