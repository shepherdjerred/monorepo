import { z } from "zod";
import {
  OperationsIntentPayloadSchema,
  type OperationsIntentPayload,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { recordMutationAudit } from "#src/lib/audit/audited-mutation.ts";
import { claimAndExecute } from "#src/lib/confirmation-intent/claim.ts";
import { createConfirmationIntent } from "#src/lib/confirmation-intent/create.ts";
import {
  executeOperationsIntent,
  type OperationsOutcome,
} from "#src/operations/operations-execution.ts";
import {
  OPERATIONS_QUEUE_MAX,
  readMatchPipeline,
  readOperationsQueues,
} from "#src/operations/operations-reads.ts";
import { SCOUT_OPERATIONS_GUILD } from "#src/operations/operator-allowlist.ts";
import {
  dispatchOperationsWorkflowStart,
  type OperationsDispatchResult,
  type OperationsWorkflowStart,
} from "#src/operations/workflow-dispatch.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { router } from "#src/trpc/trpc.ts";
import {
  operationsMutationProcedure,
  operationsProcedure,
  requireOperationsIntent,
} from "#src/trpc/router/operations/operations-access.ts";

/**
 * The operator surface over the durable match pipeline.
 *
 * Every procedure is built from `operationsProcedure` /
 * `operationsMutationProcedure`, so the allowlist check is structural rather
 * than remembered — see `operations-access.ts` for why that matters here more
 * than elsewhere.
 *
 * Nothing acts on a single request. An operation is PREPARED into a
 * confirmation intent and then CONFIRMED, through the same single-use,
 * expiring, actor-bound protocol Explore and Dares use: `prepare` writes
 * nothing but the intent, and `confirm` claims it with a guarded write that is
 * the first statement of its transaction, which is the entire double-spend
 * guard. Re-confirming replays the stored outcome instead of acting twice.
 *
 * `SCOUT_OPERATIONS_GUILD` is handed to `createConfirmationIntent` and
 * `recordMutationAudit` below purely as ATTRIBUTION. Both require a guild by
 * schema and operating the pipeline is global, so operations rows are booked
 * against the control guild the same way `http/weekly-parlay-control.ts` books
 * its actions. It is never an access check: no procedure here asks whether the
 * caller belongs to that guild, and belonging to it authorizes nothing.
 */

/**
 * How long an operator has to confirm. Short on purpose: these act on live
 * pipeline state, and an intent prepared against a view of the queues that has
 * since moved on should expire rather than wait.
 */
const OPERATIONS_INTENT_TTL_MS = 5 * 60 * 1000;

const intentInput = z.strictObject({ intentId: z.uuid() });

/**
 * The answer to one confirmation.
 *
 * `executed` reports the outcome the transaction actually produced and, only
 * for the arms that describe one, what the post-commit dispatch did.
 * `already_consumed` carries the stored outcome and deliberately carries NO
 * dispatch: this call dispatched nothing, and reporting the first call's
 * dispatch as though it were this one's would be claiming an effect that did
 * not happen here.
 */
type OperationsConfirmResult =
  | {
      kind: "executed";
      outcome: OperationsOutcome;
      dispatch: OperationsDispatchResult | null;
    }
  | { kind: "intent_expired" }
  | { kind: "already_consumed"; result: unknown };

const prepare = operationsMutationProcedure
  .input(z.strictObject({ payload: OperationsIntentPayloadSchema }))
  .mutation(async ({ ctx, input }) => {
    const payload: OperationsIntentPayload = input.payload;
    const expiresAt = new Date(Date.now() + OPERATIONS_INTENT_TTL_MS);
    const created = await createConfirmationIntent(prisma, {
      serverId: SCOUT_OPERATIONS_GUILD,
      actorDiscordId: ctx.operator,
      payload,
      idempotencyKey: crypto.randomUUID(),
      expiresAt,
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
    const now = new Date();

    // Captured out of the transaction callback rather than returned, so the
    // outcome stored on the intent stays exactly what the transaction did and
    // a replay repeats no side effects.
    const captured: { postCommit: OperationsWorkflowStart | null } = {
      postCommit: null,
    };
    const claimed = await claimAndExecute(
      prisma,
      { intentId: loaded.intent.id, actorDiscordId: ctx.operator, now },
      async (tx) => {
        const executed = await executeOperationsIntent(tx, {
          payload: loaded.payload,
          now,
        });
        captured.postCommit = executed.postCommit;
        await recordMutationAudit({
          ctx,
          guildId: SCOUT_OPERATIONS_GUILD,
          tx,
          detail: executed.audit,
        });
        return executed.outcome;
      },
    );

    if (claimed.kind === "intent_expired") {
      return { kind: "intent_expired" };
    }
    if (claimed.kind === "already_consumed") {
      return { kind: "already_consumed", result: claimed.result };
    }

    const postCommit = captured.postCommit;
    const dispatch =
      postCommit === null
        ? null
        : await dispatchOperationsWorkflowStart(
            configuration.environment,
            postCommit,
            ctx.operator,
          );
    return { kind: "executed", outcome: claimed, dispatch };
  });

const intentStatus = operationsProcedure
  .input(intentInput)
  .query(async ({ ctx, input }) => {
    const { intent, payload } = await requireOperationsIntent({
      intentId: input.intentId,
      operator: ctx.operator,
    });
    return {
      state:
        intent.consumedAt === null
          ? intent.expiresAt.getTime() <= Date.now()
            ? ("expired" as const)
            : ("pending" as const)
          : ("consumed" as const),
      kind: payload.kind,
      expiresAt: intent.expiresAt.toISOString(),
      result:
        intent.resultJson === null
          ? null
          : z.json().parse(JSON.parse(intent.resultJson)),
    };
  });

const queues = operationsProcedure
  .input(
    z.strictObject({
      limit: z
        .int()
        .min(1)
        .max(OPERATIONS_QUEUE_MAX)
        .default(OPERATIONS_QUEUE_MAX),
    }),
  )
  .query(async ({ input }) =>
    readOperationsQueues({ limit: input.limit, now: new Date() }),
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
 * Drawn here because here is where the fact is known. A console that offered
 * `reconcile` with no Temporal connection would be offering an action whose
 * only possible result is a durable request nothing will pick up.
 */
const availability = operationsProcedure.query(() => ({
  temporal:
    currentScoutTemporalSupervisor() === undefined
      ? ("unavailable" as const)
      : ("available" as const),
}));

export const operationsRouter = router({
  availability,
  queues,
  matchPipeline,
  prepare,
  confirm,
  intentStatus,
});
