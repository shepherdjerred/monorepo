import { z } from "zod";
import { router, publicProcedure } from "@shepherdjerred/sentinel/trpc/trpc.ts";
import { enqueueJob } from "@shepherdjerred/sentinel/queue/index.ts";

const JobPrioritySchema = z.enum(["critical", "high", "normal", "low"]);
const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
]);

export const jobRouter = router({
  list: publicProcedure
    .input(
      z.object({
        status: JobStatusSchema.optional(),
        agent: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.status != null) where["status"] = input.status;
      if (input.agent != null) where["agent"] = input.agent;

      const jobs = await ctx.prisma.job.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take: input.limit + 1,
        ...(input.cursor == null ? {} : { cursor: { id: input.cursor }, skip: 1 }),
      });

      let nextCursor: string | undefined;
      if (jobs.length > input.limit) {
        const next = jobs.pop();
        nextCursor = next?.id;
      }

      return { jobs, nextCursor };
    }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.job.findUnique({ where: { id: input.id } });
    }),

  create: publicProcedure
    .input(
      z.object({
        agent: z.string().min(1),
        prompt: z.string().min(1),
        priority: JobPrioritySchema.default("normal"),
      }),
    )
    .mutation(async ({ input }) => {
      return enqueueJob({
        agent: input.agent,
        prompt: input.prompt,
        priority: input.priority,
        triggerType: "manual",
        triggerSource: "web-ui",
      });
    }),

  liveStatus: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.prisma.job.findUnique({ where: { id: input.id } });
      if (job == null) return null;
      const session = await ctx.prisma.agentSession.findFirst({
        where: { jobId: input.id },
        orderBy: { startedAt: "desc" },
      });
      return {
        ...job,
        session: session == null ? null : {
          id: session.id,
          turnsUsed: session.turnsUsed,
          status: session.status,
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          inputTokens: session.inputTokens,
          outputTokens: session.outputTokens,
        },
      };
    }),

  cancel: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.job.updateMany({
        where: { id: input.id, status: "pending" },
        data: { status: "cancelled", completedAt: new Date() },
      });
    }),
});
