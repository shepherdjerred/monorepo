/**
 * Limit previews for the creation tools.
 *
 * These call the same limit functions the create pipelines call, but they are
 * advisory only: the authoritative check runs again inside the confirm
 * transaction, where it sees the same snapshot as the insert it guards. Their
 * job is to stop the agent walking a user through a form it already knows will
 * be rejected — not to decide anything.
 */

import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  validateOwnerLimit,
  validateServerLimit,
} from "#src/database/competition/validation.ts";
import { canCreateAnotherUserReport } from "#src/lib/reports/authorization.ts";
import { creationRefusal } from "#src/explore/creation/context.ts";
import type { CreationPrepareResult } from "#src/explore/creation/schemas.ts";
import { checkSubscriptionAndAccountLimits } from "#src/lib/subscription/limits.ts";

export type CreationLimitPreview = {
  atLimit: boolean;
  limitMessage: string | null;
};

const WITHIN_LIMIT: CreationLimitPreview = {
  atLimit: false,
  limitMessage: null,
};

export async function previewReportLimit(
  db: ExtendedPrismaClient,
  input: { guildId: DiscordGuildId; ownerId: DiscordAccountId },
): Promise<CreationLimitPreview> {
  const limit = await canCreateAnotherUserReport({
    prisma: db,
    serverId: input.guildId,
    ownerId: input.ownerId,
  });
  return limit.allowed
    ? WITHIN_LIMIT
    : { atLimit: true, limitMessage: limit.reason };
}

/**
 * `isAddingToExistingPlayer` decides whether the per-server *player* limit
 * applies, so a preview without a chosen alias has to assume the stricter
 * branch — a new player — which is what "can this server track someone else"
 * actually asks.
 */
export async function previewSubscriptionLimit(
  db: ExtendedPrismaClient,
  input: { guildId: DiscordGuildId; alias?: string | undefined },
): Promise<CreationLimitPreview> {
  const existingPlayer =
    input.alias === undefined
      ? null
      : await db.player.findUnique({
          where: {
            serverId_alias: { serverId: input.guildId, alias: input.alias },
          },
        });
  const limit = await checkSubscriptionAndAccountLimits({
    guildId: input.guildId,
    isAddingToExistingPlayer: existingPlayer !== null,
    db,
  });
  if (limit.kind === "ok") return WITHIN_LIMIT;
  const subject =
    limit.kind === "subscription-limit-reached"
      ? "tracked players"
      : "tracked accounts";
  return {
    atLimit: true,
    limitMessage: `This server is at its limit of ${subject} (${limit.current.toString()}/${limit.max.toString()}). Remove one before adding another.`,
  };
}

/**
 * The competition limits throw rather than returning a result, so this reads
 * their messages back out. Both the server-wide and the per-owner ceiling
 * matter, and either one blocks.
 */
export async function previewCompetitionLimit(
  db: ExtendedPrismaClient,
  input: { guildId: DiscordGuildId; ownerId: DiscordAccountId },
): Promise<CreationLimitPreview> {
  try {
    await validateServerLimit(db, input.guildId, input.ownerId);
    await validateOwnerLimit(db, input.guildId, input.ownerId);
  } catch (error) {
    return {
      atLimit: true,
      limitMessage: error instanceof Error ? error.message : String(error),
    };
  }
  return WITHIN_LIMIT;
}

/**
 * A preview turned into the prepare tools' refusal, or `null` when there is
 * room. Shared so the three prepare tools state the rule once.
 */
export function limitRefusal(
  preview: CreationLimitPreview,
): CreationPrepareResult | null {
  return preview.atLimit && preview.limitMessage !== null
    ? creationRefusal("limit_reached", preview.limitMessage)
    : null;
}
