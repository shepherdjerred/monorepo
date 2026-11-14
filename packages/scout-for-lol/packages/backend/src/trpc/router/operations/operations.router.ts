import {
  confirmOperationsIntent,
  listUnresolvedReportDeliveries,
  operationsIntentStatus,
  prepareOperationsIntent,
  type OperationsConfirmResult,
} from "#src/operations/operations-commands.ts";
import {
  OPERATIONS_QUEUE_MAX,
  readMatchPipeline,
  readOperationsQueues,
} from "#src/operations/operations-reads.ts";
import { scoutTemporalStartsAvailable } from "#src/temporal/availability.ts";
import { inboxRouter } from "#src/trpc/router/operations/inbox.router.ts";
import {
  operationsMutationProcedure,
  operationsProcedure,
  requireOperationsIntent,
} from "#src/trpc/router/operations/operations-access.ts";
import { router } from "#src/trpc/trpc.ts";
import {
  OPERATIONS_QUEUE_NAMES,
  OperationsIntentPayloadSchema,
  type OperationsIntentPayload,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";

const intentInput = z.strictObject({ intentId: z.uuid() });

const prepare = operationsMutationProcedure
  .input(z.strictObject({ payload: OperationsIntentPayloadSchema }))
  .mutation(async ({ ctx, input }) => {
    const payload: OperationsIntentPayload = input.payload;
    const created = await prepareOperationsIntent({
      operator: ctx.operator,
      payload,
      idempotencyKey: crypto.randomUUID(),
      now: new Date(),
    });
    if (created.kind === "idempotency_conflict") {
      // A fresh UUID per call makes this a broken invariant rather than a user
      // outcome, and presenting a stranger's intent as this operator's
      // confirmation is the one thing this protocol exists to prevent.
      throw new Error(
        "Freshly generated operations idempotency key collided with an existing intent",
      );
    }
    return {
      intentId: created.intent.id,
      kind: payload.kind,
      expiresAt: created.intent.expiresAt.toISOString(),
    };
  });

const confirm = operationsMutationProcedure
  .input(intentInput)
  .mutation(async ({ ctx, input }): Promise<OperationsConfirmResult> => {
    const loaded = await requireOperationsIntent({
      intentId: input.intentId,
      operator: ctx.operator,
    });
    return await confirmOperationsIntent({
      loaded,
      actor: { operator: ctx.operator, request: ctx.webSession },
    });
  });

const intentStatus = operationsProcedure
  .input(intentInput)
  .query(async ({ ctx, input }) =>
    operationsIntentStatus(
      await requireOperationsIntent({
        intentId: input.intentId,
        operator: ctx.operator,
      }),
      new Date(),
    ),
  );

/**
 * Per-queue continuation tokens. Each queue pages independently: they drain at
 * different rates, and an operator working through one must not have their
 * position in it reset because another filled up.
 */
const queueCursorsInput = z.strictObject(
  Object.fromEntries(
    OPERATIONS_QUEUE_NAMES.map((name) => [name, z.string().min(1).optional()]),
  ),
);

const queues = operationsProcedure
  .input(
    z.strictObject({
      limit: z
        .int()
        .min(1)
        .max(OPERATIONS_QUEUE_MAX)
        .default(OPERATIONS_QUEUE_MAX),
      after: queueCursorsInput.optional(),
    }),
  )
  .query(async ({ input }) =>
    readOperationsQueues({
      limit: input.limit,
      now: new Date(),
      after: input.after,
    }),
  );

const matchPipeline = operationsProcedure
  .input(z.strictObject({ matchId: RiotMatchIdSchema }))
  .query(async ({ input }) => {
    const state = await readMatchPipeline({ matchId: input.matchId });
    // Returned rather than thrown: "this pipeline has never seen that match" is
    // an answer the console renders, not a failed request.
    return state === null
      ? ({ kind: "not-found" } as const)
      : ({ kind: "found", state } as const);
  });

/**
 * Whether a Workflow start can be dispatched at all right now.
 *
 * Drawn here because here is where the fact is known, and it asks about the
 * CONNECTION rather than the supervisor: the supervisor stays installed across
 * its whole reconnect loop, so its presence answers a different question than
 * the one an operator is asking. A console that offered
 * `reconcile` with no Temporal connection would be offering an action whose
 * only possible result is a durable request nothing will pick up.
 */
const availability = operationsProcedure.query(() => ({
  temporal: scoutTemporalStartsAvailable()
    ? ("available" as const)
    : ("unavailable" as const),
}));

export const operationsRouter = router({
  inbox: inboxRouter,
  reportDeliveries: operationsProcedure.query(
    async () => await listUnresolvedReportDeliveries(),
  ),
  availability,
  queues,
  matchPipeline,
  prepare,
  confirm,
  intentStatus,
});
