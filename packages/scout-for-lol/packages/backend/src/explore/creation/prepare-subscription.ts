import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { DiscordChannelId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  DiscordAccountIdSchema,
  P,
  type CreationIntentPayload,
  type DiscordAccountId,
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
  type DiscordMemberReference,
} from "#src/explore/creation/schemas.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
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
    puuid: LeaguePuuid;
    alias: string;
    channelId: DiscordChannelId;
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
  return player?.subscriptions.some(
    (row) => row.channelId === input.channelId,
  ) === true
    ? `${input.alias} is already subscribed in that channel. Adding this account would only attach it to the existing player.`
    : null;
}

type ResolvedMember =
  | {
      readonly kind: "ok";
      readonly member: { id: DiscordAccountId; label: string } | null;
    }
  | { readonly kind: "refused"; readonly result: CreationPrepareResult };

/**
 * The Discord member a feed should mention, from how the user named them.
 *
 * An exact username or nickname wins; otherwise a single prefix match does.
 * Two candidates are never guessed between — the refusal names them so the
 * model can ask which one, in the user's words rather than as a snowflake.
 */
async function resolveDiscordMember(
  context: CreationToolContext,
  guildId: DiscordGuildId,
  reference: DiscordMemberReference | null | undefined,
): Promise<ResolvedMember> {
  if (reference === null || reference === undefined) {
    return { kind: "ok", member: null };
  }
  if ("asker" in reference) {
    return {
      kind: "ok",
      member: { id: context.requesterId, label: "the person asking" },
    };
  }
  if ("id" in reference) {
    if (!(await context.isMember(guildId, reference.id))) {
      return {
        kind: "refused",
        result: creationRefusal(
          "invalid",
          `Discord user ${reference.id} is not a member of this server. Prepare the feed without a Discord link, or ask who the player is on Discord.`,
        ),
      };
    }
    return { kind: "ok", member: { id: reference.id, label: reference.id } };
  }
  const wanted = reference.username.replace(/^@/u, "").toLowerCase();
  let found;
  try {
    found = await context.findMembers(guildId, wanted);
  } catch (error) {
    if (!(error instanceof DiscordUpstreamError)) throw error;
    return {
      kind: "refused",
      result: creationRefusal(
        "verification_unavailable",
        "Scout could not reach Discord to look that member up. Tell the user to try again shortly, or prepare the feed without a Discord link.",
      ),
    };
  }
  const exact = found.filter(
    (member) =>
      member.username.toLowerCase() === wanted ||
      member.displayName.toLowerCase() === wanted,
  );
  const candidates = exact.length > 0 ? exact : found;
  const [only, ...others] = candidates;
  if (only === undefined) {
    return {
      kind: "refused",
      result: creationRefusal(
        "invalid",
        `No member of this server is named @${wanted}. Ask the user to check the name, or prepare the feed without a Discord link.`,
      ),
    };
  }
  if (others.length > 0) {
    const names = candidates
      .slice(0, 5)
      .map((member) => `@${member.username} (${member.displayName})`)
      .join(", ");
    return {
      kind: "refused",
      result: creationRefusal(
        "invalid",
        `Several members match @${wanted}: ${names}. Ask which one they mean.`,
      ),
    };
  }
  return {
    kind: "ok",
    member: {
      id: DiscordAccountIdSchema.parse(only.id),
      label: `@${only.username}`,
    },
  };
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

  const channelRefusal = await requirePostableChannel(context, {
    guildId: parsed.guildId,
    channelId: parsed.channelId,
  });
  if (channelRefusal !== null) return channelRefusal;

  const member = await resolveDiscordMember(
    context,
    parsed.guildId,
    parsed.discordMember,
  );
  if (member.kind === "refused") return member.result;

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
    payload: subscriptionPayload(parsed, resolved, member.member?.id),
    guildId: parsed.guildId,
    summary: `Track ${resolved.gameName}#${resolved.tagLine} (${parsed.region}) as "${parsed.alias}" in ${lookup.guild.name}, posting to #${await postableChannelName(context, parsed.guildId, parsed.channelId)}${member.member === null ? "" : `, linked to ${member.member.label}`}.`,
  });
}

function subscriptionPayload(
  parsed: SubscriptionInput,
  resolved: ResolvedRiotAccount,
  discordUserId: DiscordAccountId | undefined,
): CreationIntentPayload {
  return {
    kind: "subscription",
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    region: parsed.region,
    alias: parsed.alias,
    ...(discordUserId === undefined ? {} : { discordUserId }),
    // Frozen from Riot, never from the model: the stored Riot ID is seeded
    // from Riot's own casing exactly as `subscription.add` seeds it.
    puuid: resolved.puuid,
    riotId: { game_name: resolved.gameName, tag_line: resolved.tagLine },
  };
}
