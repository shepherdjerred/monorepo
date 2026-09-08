/**
 * Who may see an Explore confirmation intent.
 *
 * Its own module rather than a helper inside `explore.router.ts` because the
 * creation-confirm procedures are spread *into* that router: importing the
 * helpers from there would close an eager import cycle, which
 * `check-architecture` rejects for good reason — module initialisation order
 * would start to matter for an authorization check.
 */

import { TRPCError } from "@trpc/server";
import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import type {
  ConfirmationIntent,
  User,
} from "#generated/prisma/client/index.js";
import { prisma } from "#src/database/index.ts";
import { assertExploreAccess } from "#src/explore/access.ts";

/**
 * The one refusal every visibility check answers with.
 *
 * Probing another guild's or another person's intent has to be
 * indistinguishable from the intent not existing, so "you may not see this"
 * and "there is nothing here" must produce the same error and the same text.
 */
export function confirmationNotFound(): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "Confirmation not found.",
  });
}

/**
 * The caller's id together with the servers they belong to.
 *
 * `assertExploreAccess` already fetches those servers to make its allowlist
 * decision, so returning them costs nothing extra — and starting a turn needs
 * them, because a `player('…')` alias may only resolve against servers the
 * asker is actually in.
 */
export async function requireExploreUserAndGuilds(
  user: User,
): Promise<{ userId: DiscordAccountId; guildIds: string[] }> {
  const guildIds = await assertExploreAccess(user);
  return {
    userId: DiscordAccountIdSchema.parse(user.discordId),
    guildIds,
  };
}

/**
 * Loads a confirmation intent the caller's servers can see.
 *
 * The guild is stored on the intent, so this is a direct column comparison
 * rather than a join through the dare it targets.
 */
export async function requireGuildIntent(
  intentId: string,
  guildIds: string[],
): Promise<ConfirmationIntent> {
  const intent = await prisma.confirmationIntent.findUnique({
    where: { id: intentId },
  });
  if (!guildIds.includes(intent?.serverId ?? "")) {
    throw confirmationNotFound();
  }
  if (intent === null) {
    throw new Error("A visible confirmation unexpectedly disappeared.");
  }
  return intent;
}

/**
 * {@link requireGuildIntent} plus the actor check: an intent is only visible
 * to the person it was minted for.
 */
export async function requireActorIntent(params: {
  intentId: string;
  guildIds: string[];
  userId: DiscordAccountId;
}): Promise<ConfirmationIntent> {
  const intent = await requireGuildIntent(params.intentId, params.guildIds);
  if (intent.actorDiscordId !== params.userId) {
    throw confirmationNotFound();
  }
  return intent;
}
