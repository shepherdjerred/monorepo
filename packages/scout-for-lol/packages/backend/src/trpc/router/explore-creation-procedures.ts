/**
 * Confirming an entity an Explore agent prepared.
 *
 * The security model in one line: **the model never writes domain state.** It
 * may mint an intent describing a report, subscription or competition; a human
 * then confirms it through a CSRF-protected mutation, and this path re-runs the
 * whole authorization decision from scratch. Nothing the model produced is
 * trusted — not the guild (read off the intent row), not the permissions
 * (re-resolved against Discord and the grant table now), not the channel
 * (re-checked against the guild), and not the feature gate (re-read, so
 * revoking it blocks intents that were already prepared).
 *
 * These procedures deliberately do **not** use `guildMutationProcedure`. That
 * builder reads `guildId` from the procedure *input*; here the guild comes from
 * the intent row, and binding the permission check to an input field would let
 * a caller pair someone's intent with a guild they happen to administer.
 *
 * Its own module rather than more of `explore.router.ts` because that file is
 * already close to the 500-line cap.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  DiscordGuildIdSchema,
  P,
  type ConfirmationIntentPayload,
  type CreationIntentKind,
  type CreationIntentPayload,
  type DiscordAccountId,
  type DiscordGuildId,
  type Permission,
  type PermissionDeniedCause,
  type PermissionSet,
} from "@scout-for-lol/data";
import type {
  ConfirmationIntent,
  User,
} from "#generated/prisma/client/index.js";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { captureFirstSubscriptionCreated } from "#src/analytics/guild-lifecycle.ts";
import { recordMutationAudit } from "#src/lib/audit/audited-mutation.ts";
import { claimAndExecute } from "#src/lib/confirmation-intent/claim.ts";
import {
  executeCreationIntent,
  type CreationPostCommit,
} from "#src/lib/confirmation-intent/creation.ts";
import { readConfirmationIntentPayload } from "#src/lib/confirmation-intent/payload.ts";
import { recordCompetitionCreation } from "#src/lib/competitions/create.ts";
import { runBackfillAfterCommit } from "#src/lib/subscription/add.ts";
import { notifyReportScheduleReconciler } from "#src/reports/temporal-schedules.ts";
import { assertChannelInGuild } from "#src/trpc/guild-guard.ts";
import { resolveGuildPermissions } from "#src/trpc/guild-permission.ts";
import {
  requireActorIntent,
  requireExploreUserAndGuilds,
} from "#src/trpc/router/explore-intent-access.ts";
import { protectedProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";

const intentInput = z.strictObject({ intentId: z.uuid() });

/** The permission each creation kind requires, in the guild on the intent. */
const CREATE_PERMISSION: Record<CreationIntentKind, Permission> = {
  report: P("reports", "create"),
  subscription: P("subscriptions", "create"),
  competition: P("competitions", "create"),
};

type LoadedCreationIntent = {
  intent: ConfirmationIntent;
  payload: CreationIntentPayload;
  /** The guild on the intent row — authoritative for every later check. */
  guildId: DiscordGuildId;
  userId: DiscordAccountId;
};

/**
 * Narrow a stored payload to a creation payload, or `null`.
 *
 * Switching on the discriminant rather than validating the string separately is
 * what lets TypeScript narrow the union without an assertion.
 */
function asCreationPayload(
  payload: ConfirmationIntentPayload,
): CreationIntentPayload | null {
  switch (payload.kind) {
    case "report":
    case "subscription":
    case "competition": {
      return payload;
    }
    case "dare_fund":
    case "dare_accept":
    case "dare_decline":
    case "dare_contribute":
    case "dare_cancel": {
      return null;
    }
  }
}

/**
 * Everything both procedures do before they diverge: prove the caller may see
 * this intent at all, that the feature is still enabled for its guild, and that
 * it really is a creation intent.
 */
async function loadCreationIntent(
  user: User,
  intentId: string,
): Promise<LoadedCreationIntent> {
  const { userId, guildIds } = await requireExploreUserAndGuilds(user);
  const intent = await requireActorIntent({ intentId, guildIds, userId });
  const guildId = DiscordGuildIdSchema.parse(intent.serverId);

  if (
    !(await isPolicyEnabled("explore_creation_enabled", { server: guildId }))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Creating things from Explore is not enabled for this server.",
    });
  }

  const payload = asCreationPayload(readConfirmationIntentPayload(intent));
  if (payload === null) {
    // A dare intent has its own confirm procedure with its own rules; it must
    // not be executable through this one.
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That confirmation does not create anything.",
    });
  }
  if (payload.guildId !== guildId) {
    // The mint path derives the column from the payload, so a disagreement is
    // a broken writer rather than user input — fail loudly instead of picking
    // a side.
    throw new Error(
      `Confirmation intent ${intent.id} stores guild ${intent.serverId} but its payload declares ${payload.guildId}.`,
    );
  }
  return { intent, payload, guildId, userId };
}

/**
 * The authoritative RBAC decision, re-run now.
 *
 * `resolveGuildPermissions` throws by itself for a non-member (FORBIDDEN), an
 * uninstalled guild (NOT_FOUND), and a Discord outage (UNAUTHORIZED /
 * SERVICE_UNAVAILABLE). Those propagate untouched: an outage is not a
 * permission answer and must never be reported as one.
 */
async function authorizeCreation(
  user: User,
  loaded: LoadedCreationIntent,
): Promise<PermissionSet> {
  const permissions = await resolveGuildPermissions(user, loaded.guildId);
  const required = CREATE_PERMISSION[loaded.payload.kind];
  if (!permissions.canAny(required)) {
    const cause: PermissionDeniedCause = { missingPermission: required };
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Missing permission ${required.resource}:${required.action}`,
      cause,
    });
  }
  // The competition sub-gates (competitions:invite / competitions:schedule) and
  // the creation rate limit live inside `createCompetitionForActor`, which
  // receives this same PermissionSet — re-checking them here would be a second
  // copy of a reviewed policy.
  assertChannelInGuild({
    guildId: loaded.guildId,
    channelId: loaded.payload.channelId,
  });
  return permissions;
}

async function runPostCommit(params: {
  postCommit: CreationPostCommit | null;
  permissions: PermissionSet;
  guildId: DiscordGuildId;
  ownerId: DiscordAccountId;
  initialHistoryImportEnabled: boolean;
}): Promise<void> {
  const { postCommit } = params;
  if (postCommit === null) return;
  if (postCommit.kind === "report") {
    await notifyReportScheduleReconciler();
    return;
  }
  if (postCommit.kind === "competition") {
    recordCompetitionCreation({
      permissions: params.permissions,
      guildId: params.guildId,
      ownerId: params.ownerId,
    });
    return;
  }
  if (postCommit.firstSubscription) {
    await captureFirstSubscriptionCreated(params.guildId, "web");
  }
  if (!params.initialHistoryImportEnabled) {
    void runBackfillAfterCommit({
      alias: postCommit.alias,
      puuid: postCommit.puuid,
      region: postCommit.region,
      discordUserId: postCommit.discordUserId,
    });
  }
}

const confirmCreationIntent = webMutationProcedure
  .input(intentInput)
  .mutation(async ({ ctx, input }) => {
    const loaded = await loadCreationIntent(ctx.user, input.intentId);
    const permissions = await authorizeCreation(ctx.user, loaded);
    // An operator control, so it is read now rather than frozen when the intent
    // was prepared.
    const initialHistoryImportEnabled = await isPolicyEnabled(
      "initial_match_history_import_enabled",
      { server: loaded.guildId },
    );

    // Captured out of the transaction callback rather than returned, so the
    // stored replay result stays the outcome the client sees and a replayed
    // confirmation repeats no side effects.
    const captured: { postCommit: CreationPostCommit | null } = {
      postCommit: null,
    };
    const outcome = await claimAndExecute(
      prisma,
      {
        intentId: loaded.intent.id,
        actorDiscordId: loaded.userId,
        now: new Date(),
      },
      async (tx) => {
        const executed = await executeCreationIntent(tx, {
          payload: loaded.payload,
          guildId: loaded.guildId,
          actorDiscordId: loaded.userId,
          permissions,
          initialHistoryImportEnabled,
        });
        captured.postCommit = executed.postCommit;
        await recordMutationAudit({
          ctx,
          guildId: loaded.guildId,
          tx,
          detail: executed.audit,
        });
        return executed.outcome;
      },
    );

    await runPostCommit({
      postCommit: captured.postCommit,
      permissions,
      guildId: loaded.guildId,
      ownerId: loaded.userId,
      initialHistoryImportEnabled,
    });
    return outcome;
  });

const creationIntentStatus = protectedProcedure
  .input(intentInput)
  .query(async ({ ctx, input }) => {
    const loaded = await loadCreationIntent(ctx.user, input.intentId);
    const { intent } = loaded;
    return {
      state:
        intent.consumedAt === null
          ? intent.expiresAt.getTime() <= Date.now()
            ? ("expired" as const)
            : ("pending" as const)
          : ("consumed" as const),
      // Taken from the payload, which `readConfirmationIntentPayload` has
      // already proved agrees with the row's `kind` column.
      kind: loaded.payload.kind,
      guildId: loaded.guildId,
      expiresAt: intent.expiresAt.toISOString(),
      result:
        intent.resultJson === null
          ? null
          : z.json().parse(JSON.parse(intent.resultJson)),
    };
  });

/** Spread into `exploreRouter`; see the module docblock for why they live here. */
export const exploreCreationProcedures = {
  confirmCreationIntent,
  creationIntentStatus,
};
