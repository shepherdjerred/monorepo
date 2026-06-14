import { z } from "zod";
import { router, publicProcedure } from "@shepherdjerred/sentinel/trpc/trpc.ts";

export const sessionRouter = router({
  list: publicProcedure
    .input(
      z.object({
        agent: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.agent != null) where["agent"] = input.agent;

      const sessions = await ctx.prisma.agentSession.findMany({
        where,
        orderBy: [{ startedAt: "desc" }],
        take: input.limit + 1,
        ...(input.cursor == null
          ? {}
          : { cursor: { id: input.cursor }, skip: 1 }),
      });

      let nextCursor: string | undefined;
      if (sessions.length > input.limit) {
        const next = sessions.pop();
        nextCursor = next?.id;
      }

      return { sessions, nextCursor };
    }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.agentSession.findUnique({ where: { id: input.id } });
    }),
});
