import {
  OperationsIntentPayloadSchema,
  type DiscordAccountId,
  type OperationsIntentPayload,
} from "@scout-for-lol/data";
import { z } from "zod";
import type { ConfirmationIntent } from "#generated/prisma/client/index.js";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { recordMutationAudit } from "#src/lib/audit/audited-mutation.ts";
import { claimAndExecute } from "#src/lib/confirmation-intent/claim.ts";
import {
  createConfirmationIntent,
  type CreateConfirmationIntentResult,
} from "#src/lib/confirmation-intent/create.ts";
import { readConfirmationIntentPayload } from "#src/lib/confirmation-intent/payload.ts";
import {
  executeOperationsIntent,
  type OperationsAuditProvenance,
  type OperationsOutcome,
} from "#src/operations/operations-execution.ts";
import { OPERATIONS_QUEUE_MAX } from "#src/operations/operations-reads.ts";
import { SCOUT_OPERATIONS_GUILD } from "#src/operations/operator-allowlist.ts";
import {
  dispatchOperationsWorkflowStart,
  type OperationsDispatchResult,
  type OperationsWorkflowStart,
} from "#src/operations/workflow-dispatch.ts";

/**
 * The operations protocol, independent of the transport that asks for it.
 *
 * The browser console (tRPC prepare, then confirm) and the machine API (one
 * request that does both) call these same functions, so there is one claim,
 * one execution, one audit row shape and one post-commit dispatch however an
 * operator arrives. Authorization stays in the transports: each must have
 * established that `operator` is on the Git allowlist and that the console is
 * enabled for them before calling anything here.
 */

/**
 * How long an operator has to confirm. Short on purpose: these act on live
 * pipeline state, and an intent prepared against a view of the queues that has
 * since moved on should expire rather than wait.
 */
export const OPERATIONS_INTENT_TTL_MS = 5 * 60 * 1000;

/**
 * Whether the durable-pipeline console is switched on for this operator.
 *
 * Only ever asked about someone already on the allowlist, so the flag can
 * remove the surface but never grant it.
 */
export async function operationsConsoleEnabled(
  operator: DiscordAccountId,
): Promise<boolean> {
  return await isPolicyEnabled("scout_operations_console_enabled", {
    user: operator,
    server: SCOUT_OPERATIONS_GUILD,
  });
}

export type LoadedOperationsIntent = {
  readonly intent: ConfirmationIntent;
  readonly payload: OperationsIntentPayload;
};

/**
 * The operations intent this operator minted, or `null`.
 *
 * `null` covers "no such intent", "another operator's intent" and "an intent
 * from another surface" alike. An intent id is a bearer-shaped handle to a
 * pipeline action, and a surface that told those apart would confirm the
 * existence of other operators' in-flight work to anyone who could guess one.
 *
 * The guild is compared against the intent ROW, never taken from an input: an
 * operations intent is attributed to the control guild when minted, and a row
 * with any other guild came from Explore or Dares, which share the table.
 */
export async function findOperationsIntent(args: {
  intentId: string;
  operator: DiscordAccountId;
}): Promise<LoadedOperationsIntent | null> {
  const intent = await prisma.confirmationIntent.findUnique({
    where: { id: args.intentId },
  });
  if (
    intent?.actorDiscordId !== args.operator ||
    intent.serverId !== SCOUT_OPERATIONS_GUILD
  ) {
    return null;
  }
  const parsed = OperationsIntentPayloadSchema.safeParse(
    readConfirmationIntentPayload(intent),
  );
  return parsed.success ? { intent, payload: parsed.data } : null;
}

/** Mint an operations intent bound to `operator` and the control guild. */
export async function prepareOperationsIntent(args: {
  operator: DiscordAccountId;
  payload: OperationsIntentPayload;
  idempotencyKey: string;
  now: Date;
}): Promise<CreateConfirmationIntentResult> {
  return await createConfirmationIntent(prisma, {
    serverId: SCOUT_OPERATIONS_GUILD,
    actorDiscordId: args.operator,
    payload: args.payload,
    idempotencyKey: args.idempotencyKey,
    expiresAt: new Date(args.now.getTime() + OPERATIONS_INTENT_TTL_MS),
  });
}

/**
 * Who confirmed, and where the request came from, for the audit row.
 *
 * `provenance` is absent for the browser console, whose rows keep the shape
 * they have always had. The machine API sets it, so a reviewer can tell an
 * agent-run resolution from a click without joining anything.
 */
export type OperationsActor = {
  readonly operator: DiscordAccountId;
  readonly request: {
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
  };
  readonly provenance?: OperationsAuditProvenance;
};

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
export type OperationsConfirmResult =
  | {
      kind: "executed";
      outcome: OperationsOutcome;
      dispatch: OperationsDispatchResult | null;
    }
  | { kind: "intent_expired" }
  | { kind: "already_consumed"; result: unknown };

/**
 * Claim `loaded` for exactly one execution, run it, audit it, then dispatch
 * any Workflow start it authorized.
 */
export async function confirmOperationsIntent(args: {
  loaded: LoadedOperationsIntent;
  actor: OperationsActor;
}): Promise<OperationsConfirmResult> {
  const { loaded, actor } = args;
  const now = new Date();

  // Captured out of the transaction callback rather than returned, so the
  // outcome stored on the intent stays exactly what the transaction did and
  // a replay repeats no side effects.
  const captured: { postCommit: OperationsWorkflowStart | null } = {
    postCommit: null,
  };
  const claimed = await claimAndExecute(
    prisma,
    { intentId: loaded.intent.id, actorDiscordId: actor.operator, now },
    async (tx) => {
      const executed = await executeOperationsIntent(tx, {
        payload: loaded.payload,
        now,
        provenance: actor.provenance,
      });
      captured.postCommit = executed.postCommit;
      await recordMutationAudit({
        ctx: {
          user: { discordId: actor.operator },
          webSession: actor.request,
        },
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
          actor.operator,
        );
  return { kind: "executed", outcome: claimed, dispatch };
}

/** Where an intent stands, as the console and the machine API report it. */
export function operationsIntentStatus(
  loaded: LoadedOperationsIntent,
  now: Date,
) {
  const { intent, payload } = loaded;
  return {
    state:
      intent.consumedAt === null
        ? intent.expiresAt.getTime() <= now.getTime()
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
}

/** Report chunks whose delivery is unresolved, oldest first. */
export async function listUnresolvedReportDeliveries() {
  return await prisma.reportDeliveryChunk.findMany({
    where: { state: { in: ["UNKNOWN", "SENDING"] } },
    orderBy: [
      { updatedAt: "asc" },
      { reportRunId: "asc" },
      { chunkIndex: "asc" },
    ],
    take: OPERATIONS_QUEUE_MAX,
  });
}
