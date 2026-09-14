import { TRPCError } from "@trpc/server";
import {
  OperationsIntentPayloadSchema,
  type DiscordAccountId,
  type OperationsIntentPayload,
} from "@scout-for-lol/data";
import type { ConfirmationIntent } from "#generated/prisma/client/index.js";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { readConfirmationIntentPayload } from "#src/lib/confirmation-intent/payload.ts";
import {
  SCOUT_OPERATIONS_GUILD,
  scoutOperatorId,
} from "#src/operations/operator-allowlist.ts";
import {
  middleware,
  webMutationProcedure,
  webProcedure,
} from "#src/trpc/trpc.ts";

/**
 * Who may reach the operations surface, and in what order it is decided.
 *
 * The gate is a procedure BUILDER rather than an assertion each procedure
 * remembers to call. Operating the durable pipeline is the one place in this
 * backend where forgetting a check hands a stranger the power to mark an
 * undelivered message delivered, so the check is made structural: a procedure
 * that is not built from `operationsProcedure` or `operationsMutationProcedure`
 * is not in the operations router at all.
 *
 * The ORDER of the two checks is the whole authorization story:
 *
 * 1. The Git-managed operator allowlist. A non-operator is refused here, with
 *    the flag in ANY state — so turning the flag on can never grant access to
 *    anyone, which is what "flags control visibility, never authorization"
 *    has to mean to be worth asserting.
 * 2. The rollout flag. An operator meeting a disabled console gets `NOT_FOUND`,
 *    matching how every other flag-gated surface here hides itself. The flag
 *    can only ever REMOVE the surface.
 *
 * Kept in its own module because the router spreads these procedures in, and an
 * eager import back the other way is the cycle `check-architecture` rejects.
 *
 * `SCOUT_OPERATIONS_GUILD` appears throughout this module and is NOT access
 * control. Read it as a column, not a check. Operating the pipeline is global,
 * but a confirmation intent and an audit row each require a guild by schema, so
 * every operations row is attributed to the control guild. Nothing here asks
 * whether the caller is in that guild, and being in it grants nothing — the
 * allowlist above is the entire access decision. The guild is compared in
 * {@link requireOperationsIntent} only to prove a row came from THIS surface
 * rather than from Explore or Dares, which share the table.
 */

const isScoutOperatorSession = middleware(async ({ ctx, next }) => {
  const { user, webSession } = ctx;
  if (user === null || webSession === null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Web session required — sign in at /app/login",
    });
  }
  const operator = scoutOperatorId(user.discordId);
  if (operator === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a Scout operator.",
    });
  }
  if (
    !(await isPolicyEnabled("scout_operations_console_enabled", {
      user: operator,
      server: SCOUT_OPERATIONS_GUILD,
    }))
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout operations are unavailable",
    });
  }
  return next({ ctx: { ...ctx, user, webSession, operator } });
});

export const operationsProcedure = webProcedure.use(isScoutOperatorSession);
export const operationsMutationProcedure = webMutationProcedure.use(
  isScoutOperatorSession,
);

/**
 * An operations intent belonging to this operator, or a refusal.
 *
 * Not-found and not-yours are deliberately the same answer. An operations
 * intent id is a bearer-shaped handle to a pipeline action, and a surface that
 * distinguished "someone else's intent" from "no such intent" would confirm the
 * existence of other operators' in-flight work to anyone who could guess an id.
 */
export function operationsIntentNotFound(): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "Operations confirmation not found.",
  });
}

export type LoadedOperationsIntent = {
  readonly intent: ConfirmationIntent;
  readonly payload: OperationsIntentPayload;
};

/**
 * Read the intent this operator minted, proving it is an operations intent.
 *
 * The guild is compared against the intent ROW, never taken from a payload or
 * an input: an operations intent is attributed to the control guild when it is
 * minted, and a row carrying any other guild did not come from this surface.
 */
export async function requireOperationsIntent(args: {
  intentId: string;
  operator: DiscordAccountId;
}): Promise<LoadedOperationsIntent> {
  const intent = await prisma.confirmationIntent.findUnique({
    where: { id: args.intentId },
  });
  if (intent === null) {
    throw operationsIntentNotFound();
  }
  if (
    intent.actorDiscordId !== args.operator ||
    intent.serverId !== SCOUT_OPERATIONS_GUILD
  ) {
    throw operationsIntentNotFound();
  }
  const parsed = OperationsIntentPayloadSchema.safeParse(
    readConfirmationIntentPayload(intent),
  );
  if (!parsed.success) {
    // A dare or creation intent minted by another surface. Reported as absent
    // rather than as a type error, for the same reason as above.
    throw operationsIntentNotFound();
  }
  return { intent, payload: parsed.data };
}
