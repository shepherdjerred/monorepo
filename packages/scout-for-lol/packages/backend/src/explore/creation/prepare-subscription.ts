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
    joinExistingPlayer: boolean;
    memberId: DiscordAccountId | undefined;
  },
): Promise<string | null> {
  const account = await context.db.account.findUnique({
    where: { serverId_puuid: { serverId: input.guildId, puuid: input.puuid } },
    include: { player: true },
  });
  if (account !== null) {
    return `That Riot account is already tracked in this server as ${account.player.alias}.`;
  }
  // A member is one player per server: linking them to a second player would
  // give one person two identities.
  if (input.memberId !== undefined) {
    const linked = await context.db.player.findFirst({
      where: { serverId: input.guildId, discordId: input.memberId },
      select: { alias: true },
    });
    if (linked !== null && linked.alias !== input.alias) {
      return `That Discord member is already tracked as "${linked.alias}". To add this account to them, prepare it again with alias "${linked.alias}" and joinExistingPlayer; otherwise prepare it without a Discord link.`;
    }
  }
  const player = await context.db.player.findUnique({
    where: { serverId_alias: { serverId: input.guildId, alias: input.alias } },
    include: { subscriptions: { select: { channelId: true } } },
  });
  // Confirming under a taken alias attaches the account to that player, so
  // two people would share one name and one history. That needs the user to
  // have said the account is theirs.
  if (player === null) {
    return input.joinExistingPlayer
      ? `No tracked player here is named "${input.alias}". Prepare a new player instead.`
      : null;
  }
  if (!input.joinExistingPlayer) {
    return `"${input.alias}" is already a tracked player here. If this account belongs to them, prepare it again with joinExistingPlayer; otherwise ask the user for a different name.`;
  }
  // Joining keeps the existing player's Discord link; the confirm path does
  // not change it, so a card must not promise a different one.
  if (input.memberId !== undefined && player.discordId !== input.memberId) {
    return `"${input.alias}" is linked to a different Discord member (or none). Adding this account keeps that link; it can be changed on the Players page. Prepare it without a Discord link.`;
  }
  return player.subscriptions.some((row) => row.channelId === input.channelId)
    ? `${input.alias} is already subscribed in that channel. Adding this account would only attach it to the existing player.`
    : null;
}

/** Members one name search returns; a full page may not be every match. */
export const MEMBER_SEARCH_LIMIT = 10;

const DISCORD_UNREACHABLE =
  "Scout could not reach Discord to look that member up. Tell the user to try again shortly, or prepare the feed without a Discord link.";

type ResolvedMember =
  | {
      readonly kind: "ok";
      readonly member: { id: DiscordAccountId; label: string } | null;
    }
  | { readonly kind: "refused"; readonly result: CreationPrepareResult };

/** A member named by id: they must be in the server, checked now. */
async function memberById(
  context: CreationToolContext,
  guildId: DiscordGuildId,
  id: DiscordAccountId,
): Promise<ResolvedMember> {
  let member: boolean;
  try {
    member = await context.isMember(guildId, id);
  } catch (error) {
    if (!(error instanceof DiscordUpstreamError)) throw error;
    return {
      kind: "refused",
      result: creationRefusal("verification_unavailable", DISCORD_UNREACHABLE),
    };
  }
  if (!member) {
    return {
      kind: "refused",
      result: creationRefusal(
        "invalid",
        `Discord user ${id} is not a member of this server. Prepare the feed without a Discord link, or ask who the player is on Discord.`,
      ),
    };
  }
  return { kind: "ok", member: { id, label: id } };
}

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
  if ("id" in reference)
    return await memberById(context, guildId, reference.id);
  const wanted = reference.username.replace(/^@/u, "").trim().toLowerCase();
  // "@" alone names nobody; searching for "" would match the whole server.
  if (wanted.length === 0) {
    return {
      kind: "refused",
      result: creationRefusal(
        "invalid",
        "No Discord username was given. Prepare the feed without a Discord link, or ask the user who the player is on Discord.",
      ),
    };
  }
  let found;
  try {
    found = await context.findMembers(guildId, wanted);
  } catch (error) {
    if (!(error instanceof DiscordUpstreamError)) throw error;
    return {
      kind: "refused",
      result: creationRefusal("verification_unavailable", DISCORD_UNREACHABLE),
    };
  }
  // A username is unique on Discord, so an exact one is settled even on a
  // full page. A nickname or prefix match on a full page is not: the search
  // stops at its limit, and the person meant may be past it.
  const byUsername = found.filter(
    (member) => member.username.toLowerCase() === wanted,
  );
  const exact =
    byUsername.length === 1
      ? byUsername
      : found.filter(
          (member) =>
            member.username.toLowerCase() === wanted ||
            member.displayName.toLowerCase() === wanted,
        );
  if (byUsername.length !== 1 && found.length >= MEMBER_SEARCH_LIMIT) {
    return {
      kind: "refused",
      result: creationRefusal(
        "invalid",
        `Too many members match @${wanted} to be sure which one is meant. Ask for their exact Discord username.`,
      ),
    };
  }
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
    joinExistingPlayer: parsed.joinExistingPlayer,
    memberId: member.member?.id,
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
    summary: `${parsed.joinExistingPlayer ? `Add ${resolved.gameName}#${resolved.tagLine} (${parsed.region}) to the tracked player "${parsed.alias}"` : `Track ${resolved.gameName}#${resolved.tagLine} (${parsed.region}) as "${parsed.alias}"`} in ${lookup.guild.name}, posting to #${await postableChannelName(context, parsed.guildId, parsed.channelId)}${member.member === null ? "" : `, linked to ${member.member.label}`}.`,
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
    joinExistingPlayer: parsed.joinExistingPlayer,
    ...(discordUserId === undefined ? {} : { discordUserId }),
    // Frozen from Riot, never from the model: the stored Riot ID is seeded
    // from Riot's own casing exactly as `subscription.add` seeds it.
    puuid: resolved.puuid,
    riotId: { game_name: resolved.gameName, tag_line: resolved.tagLine },
  };
}
