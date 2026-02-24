import { z } from "zod";
import { router, publicProcedure } from "@shepherdjerred/sentinel/trpc/trpc.ts";
import { emitSSE } from "@shepherdjerred/sentinel/sse/index.ts";

export const approvalRouter = router({
  list: publicProcedure
    .input(
      z.object({
        status: z.enum(["pending", "approved", "denied"]).optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.status != null) where["status"] = input.status;

      return ctx.prisma.approvalRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take: input.limit,
      });
    }),

  decide: publicProcedure
    .input(
      z.object({
        id: z.string(),
        approved: z.boolean(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const status = input.approved ? "approved" : "denied";
      const result = await ctx.prisma.approvalRequest.updateMany({
        where: { id: input.id, status: "pending" },
        data: {
          status,
          decidedBy: "web-ui",
          decidedAt: new Date(),
          reason: input.reason ?? `${status} via web UI`,
        },
      });

      if (result.count > 0) {
        emitSSE({
          type: "approval:decided",
          id: input.id,
          status,
        });
      }

      return { updated: result.count > 0 };
    }),
});
