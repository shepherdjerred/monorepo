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

import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import {
  confirmCreation,
  loadCreationIntent,
  requireCreationEnabled,
  type CreationConfirmer,
} from "#src/explore/creation/confirm.ts";
import type { User } from "#generated/prisma/client/index.js";
import { resolveGuildPermissions } from "#src/trpc/guild-permission.ts";
import { requireExploreUserAndGuilds } from "#src/trpc/router/explore/explore-intent-access.ts";
import { protectedProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";

const intentInput = z.strictObject({ intentId: z.uuid() });

/** A signed-in web session: OAuth guilds, OAuth permissions, request metadata. */
async function webConfirmer(
  user: User,
  session: { ipAddress: string | null; userAgent: string | null },
): Promise<CreationConfirmer> {
  const { userId, guildIds } = await requireExploreUserAndGuilds(user);
  return {
    actorId: userId,
    guildIds,
    resolvePermissions: (guildId) => resolveGuildPermissions(user, guildId),
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    surface: "web",
  };
}

const confirmCreationIntent = webMutationProcedure.input(intentInput).mutation(
  async ({ ctx, input }) =>
    await confirmCreation({
      intentId: input.intentId,
      confirmer: await webConfirmer(ctx.user, ctx.webSession),
    }),
);

const creationIntentStatus = protectedProcedure
  .input(intentInput)
  .query(async ({ ctx, input }) => {
    const { guildIds } = await requireExploreUserAndGuilds(ctx.user);
    const loaded = await loadCreationIntent(
      { actorId: DiscordAccountIdSchema.parse(ctx.user.discordId), guildIds },
      input.intentId,
    );
    const { intent } = loaded;
    // A consumed card reports what happened even after creation is switched
    // off, as confirmCreation and history replay do; the flag gates only
    // cards that could still be confirmed.
    if (intent.consumedAt === null)
      await requireCreationEnabled(loaded.guildId);
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
