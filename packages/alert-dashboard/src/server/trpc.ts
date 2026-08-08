import { initTRPC, TRPCError } from "@trpc/server";

import {
  AlertNotFoundError,
  type AlertService,
} from "#application/alert-service";
import { changeStream, type ChangeBus } from "#server/change-bus";
import {
  AlertDetailSchema,
  AlertDetailInputSchema,
  AlertListInputSchema,
  AlertListResponseSchema,
  EventListInputSchema,
  EventListResponseSchema,
  PreviewInputSchema,
  PreviewsSchema,
  SummarySchema,
  SystemStatusSchema,
} from "#shared/schema";

export type TRPCContext = { service: AlertService; changes: ChangeBus };
const t = initTRPC.context<TRPCContext>().create();

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AlertNotFoundError)
      throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    throw error;
  }
}

export const appRouter = t.router({
  summary: t.router({
    get: t.procedure
      .output(SummarySchema)
      .query(({ ctx }) => ctx.service.summary()),
  }),
  alerts: t.router({
    list: t.procedure
      .input(AlertListInputSchema)
      .output(AlertListResponseSchema)
      .query(({ ctx, input }) => ctx.service.listAlerts(input)),
    byId: t.procedure
      .input(AlertDetailInputSchema)
      .output(AlertDetailSchema)
      .query(async ({ ctx, input }) => {
        const alert = await ctx.service.getAlert(input);
        if (alert === null)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Alert not found",
          });
        return alert;
      }),
  }),
  events: t.router({
    list: t.procedure
      .input(EventListInputSchema)
      .output(EventListResponseSchema)
      .query(({ ctx, input }) => ctx.service.listEvents(input)),
  }),
  previews: t.router({
    get: t.procedure
      .input(PreviewInputSchema)
      .output(PreviewsSchema)
      .query(({ ctx, input }) => translate(() => ctx.service.previews(input))),
  }),
  system: t.router({
    status: t.procedure
      .output(SystemStatusSchema)
      .query(({ ctx }) => ctx.service.systemStatus()),
  }),
  changes: t.procedure.subscription(({ ctx, signal }) =>
    changeStream(ctx.changes, signal),
  ),
});

export type AppRouter = typeof appRouter;
