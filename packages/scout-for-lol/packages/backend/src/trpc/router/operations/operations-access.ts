import { TRPCError } from "@trpc/server";
import type { DiscordAccountId } from "@scout-for-lol/data";
import {
  findOperationsIntent,
  operationsConsoleEnabled,
  type LoadedOperationsIntent,
} from "#src/operations/operations-commands.ts";
import { scoutOperatorId } from "#src/operations/operator-allowlist.ts";
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
 * for the pipeline must use `operationsProcedure` or `operationsMutationProcedure`.
 * The support inbox uses the same structural operator check without the
 * pipeline rollout flag, so switching off pipeline tools never disables support.
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
  return next({ ctx: { ...ctx, user, webSession, operator } });
});

/** Support remains available independently of the durable-pipeline rollout. */
export const operatorProcedure = webProcedure.use(isScoutOperatorSession);
export const operatorMutationProcedure = webMutationProcedure.use(
  isScoutOperatorSession,
);

async function requireOperationsConsole(
  operator: DiscordAccountId,
): Promise<void> {
  if (!(await operationsConsoleEnabled(operator))) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout operations are unavailable",
    });
  }
}

export const operationsProcedure = operatorProcedure.use(
  async ({ ctx, next }) => {
    await requireOperationsConsole(ctx.operator);
    return next();
  },
);
export const operationsMutationProcedure = operatorMutationProcedure.use(
  async ({ ctx, next }) => {
    await requireOperationsConsole(ctx.operator);
    return next();
  },
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

/**
 * Read the intent this operator minted, proving it is an operations intent.
 * See {@link findOperationsIntent} for why every refusal is the same absence.
 */
export async function requireOperationsIntent(args: {
  intentId: string;
  operator: DiscordAccountId;
}): Promise<LoadedOperationsIntent> {
  const loaded = await findOperationsIntent(args);
  if (loaded === null) {
    throw operationsIntentNotFound();
  }
  return loaded;
}
