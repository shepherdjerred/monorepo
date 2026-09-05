import {
  P,
  type CreationIntentPayload,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  creationRefusal,
  lookupGuildAccess,
  mintCreationIntent,
  postableChannelName,
  requirePostableChannel,
  type CreationToolContext,
} from "#src/explore/creation/context.ts";
import {
  limitRefusal,
  previewSubscriptionLimit,
} from "#src/explore/creation/limits.ts";
import {
  PrepareSubscriptionToolInputSchema,
  type CreationPrepareResult,
} from "#src/explore/creation/schemas.ts";
import type { resolveSubscriptionPuuid } from "#src/lib/subscription/add.ts";

type SubscriptionInput = ReturnType<
  typeof PrepareSubscriptionToolInputSchema.parse
>;

/** The success arm of the Riot lookup, carrying the PUUID and canonical casing. */
type ResolvedRiotAccount = Extract<
  Awaited<ReturnType<typeof resolveSubscriptionPuuid>>,
  { kind: "ok" }
>;

/**
 * Anything already tracking this account, or this player in this channel.
 *
 * Both are refusals the confirm path would produce anyway; catching them here
 * means the agent can say "already tracked as X" in the conversation rather
 * than after a user has approved a card that then does nothing.
 */
async function existingSubscription(
  context: CreationToolContext,
  input: {
    guildId: DiscordGuildId;
    puuid: string;
    alias: string;
    channelId: string;
  },
): Promise<string | null> {
  const account = await context.db.account.findUnique({
    where: { serverId_puuid: { serverId: input.guildId, puuid: input.puuid } },
    include: { player: true },
  });
  if (account !== null) {
    return `That Riot account is already tracked in this server as ${account.player.alias}.`;
  }
  const player = await context.db.player.findUnique({
    where: { serverId_alias: { serverId: input.guildId, alias: input.alias } },
    include: { subscriptions: { select: { channelId: true } } },
  });
  if (
    player?.subscriptions.some((row) => row.channelId === input.channelId) ===
    true
  ) {
    return `${input.alias} is already subscribed in that channel. Adding this account would only attach it to the existing player.`;
  }
  return null;
}

/**
 * Prepare a tracked-player subscription for a human to confirm.
 *
 * The PUUID and Riot's canonical Riot ID casing are resolved here and frozen
 * into the payload. Two reasons, and both matter: the model must never author
 * the identity a confirmation acts on, and Riot's account lookup routinely
 * takes seconds while confirm runs inside a Prisma transaction whose 5s timeout
 * would trip `P2028`.
 */
export async function prepareSubscriptionCreation(
  context: CreationToolContext,
  raw: unknown,
): Promise<CreationPrepareResult> {
  const parsed = PrepareSubscriptionToolInputSchema.parse(raw);
  const lookup = await lookupGuildAccess(context, parsed.guildId);
  if (lookup.kind === "refused") return lookup.result;
  if (!lookup.guild.permissions.canAny(P("subscriptions", "create"))) {
    return creationRefusal(
      "forbidden_target",
      `This user cannot track players in ${lookup.guild.name}. Tell them they need the subscriptions:create permission there.`,
    );
  }

  const channelRefusal = requirePostableChannel(context, {
    guildId: parsed.guildId,
    channelId: parsed.channelId,
  });
  if (channelRefusal !== null) return channelRefusal;

  const resolved = await context.resolvePuuid(parsed.riotId, parsed.region);
  if (resolved.kind !== "ok") {
    return creationRefusal(
      "invalid",
      `Riot does not recognise ${parsed.riotId.game_name}#${parsed.riotId.tag_line} in that region: ${resolved.message}. Ask the user to check the Riot ID and region.`,
    );
  }

  const duplicate = await existingSubscription(context, {
    guildId: parsed.guildId,
    puuid: resolved.puuid,
    alias: parsed.alias,
    channelId: parsed.channelId,
  });
  if (duplicate !== null) return creationRefusal("invalid", duplicate);

  const limit = await previewSubscriptionLimit(context.db, {
    guildId: parsed.guildId,
    alias: parsed.alias,
  });
  const atLimit = limitRefusal(limit);
  if (atLimit !== null) return atLimit;

  return await mintCreationIntent(context, {
    payload: subscriptionPayload(parsed, resolved),
    guildId: parsed.guildId,
    summary: `Track ${resolved.gameName}#${resolved.tagLine} (${parsed.region}) as "${parsed.alias}" in ${lookup.guild.name}, posting to #${postableChannelName(context, parsed.guildId, parsed.channelId)}.`,
  });
}

function subscriptionPayload(
  parsed: SubscriptionInput,
  resolved: ResolvedRiotAccount,
): CreationIntentPayload {
  return {
    kind: "subscription",
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    region: parsed.region,
    alias: parsed.alias,
    ...(parsed.discordUserId === undefined
      ? {}
      : { discordUserId: parsed.discordUserId }),
    // Frozen from Riot, never from the model: the stored Riot ID is seeded
    // from Riot's own casing exactly as `subscription.add` seeds it.
    puuid: resolved.puuid,
    riotId: { game_name: resolved.gameName, tag_line: resolved.tagLine },
  };
}
