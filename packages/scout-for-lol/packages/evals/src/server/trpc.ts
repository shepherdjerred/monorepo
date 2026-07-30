import { initTRPC } from "@trpc/server";

import type { EvalStore } from "#server/store.ts";
import * as EvalSchema from "#shared/schema.ts";

export type TRPCContext = { store: EvalStore };

const t = initTRPC.context<TRPCContext>().create();

const datasetsRouter = t.router({
  list: t.procedure
    .output(EvalSchema.DatasetSummarySchema.array())
    .query(({ ctx }) => ctx.store.listDatasets()),
  create: t.procedure
    .input(EvalSchema.CreateDatasetInputSchema)
    .output(EvalSchema.DatasetSummarySchema)
    .mutation(({ ctx, input }) => ctx.store.createDataset(input)),
  finalize: t.procedure
    .input(EvalSchema.DatasetInputSchema)
    .output(EvalSchema.DatasetSummarySchema)
    .mutation(({ ctx, input }) => ctx.store.finalizeDataset(input.datasetId)),
  export: t.procedure
    .input(EvalSchema.DatasetInputSchema)
    .output(EvalSchema.DatasetExportSchema)
    .query(({ ctx, input }) => ctx.store.exportDataset(input.datasetId)),
  import: t.procedure
    .input(EvalSchema.DatasetExportSchema)
    .output(EvalSchema.DatasetSummarySchema)
    .mutation(({ ctx, input }) => ctx.store.importDataset(input)),
});

const casesRouter = t.router({
  list: t.procedure
    .input(EvalSchema.DatasetInputSchema)
    .output(EvalSchema.CaseSummarySchema.array())
    .query(({ ctx, input }) => ctx.store.listCases(input.datasetId)),
  detail: t.procedure
    .input(EvalSchema.CaseInputSchema)
    .output(EvalSchema.CaseDetailSchema)
    .query(({ ctx, input }) =>
      ctx.store.getCaseDetail(input.datasetId, input.caseId),
    ),
  recordGeneration: t.procedure
    .input(EvalSchema.RecordGenerationInputSchema)
    .output(EvalSchema.GenerationSchema)
    .mutation(({ ctx, input }) => ctx.store.recordGeneration(input)),
  rate: t.procedure
    .input(EvalSchema.UpsertHumanRatingInputSchema)
    .output(EvalSchema.HumanRatingSchema)
    .mutation(({ ctx, input }) => ctx.store.upsertHumanRating(input)),
});

const freshnessRouter = t.router({
  detail: t.procedure
    .input(EvalSchema.StyleBatchInputSchema)
    .output(EvalSchema.StyleBatchSchema)
    .query(({ ctx, input }) =>
      ctx.store.listStyleBatch(input.datasetId, input.styleKey),
    ),
  rate: t.procedure
    .input(EvalSchema.UpsertFreshnessRatingInputSchema)
    .output(EvalSchema.FreshnessRatingSchema)
    .mutation(({ ctx, input }) => ctx.store.upsertFreshnessRating(input)),
});

export const appRouter = t.router({
  datasets: datasetsRouter,
  cases: casesRouter,
  freshness: freshnessRouter,
});

export type AppRouter = typeof appRouter;
