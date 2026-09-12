import type { Channel, Client } from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { match } from "ts-pattern";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { getErrorMessage } from "#src/utils/errors.ts";
import { sendDM, type DmStatus } from "#src/discord/utils/dm.ts";
import { getFeedbackUrl } from "#src/discord/utils/feedback.ts";
import type { PermissionNotifyStage } from "#src/database/guild-permission-errors.ts";
import type { DeliveryFailureKind } from "#src/database/delivery-failure.ts";
import {
  discordPermissionErrorsTotal,
  discordOwnerNotificationsTotal,
} from "#src/metrics/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("permissions");

/**
 * Schema for Discord API errors
 */
const DiscordAPIErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

/**
 * Check if an error is a Discord permission error
 */
export function isPermissionError(error: unknown): boolean {
  const result = DiscordAPIErrorSchema.safeParse(error);
  if (!result.success) {
    return false;
  }

  // Discord API error code 50013 = Missing Permissions
  // Discord API error code 50001 = Missing Access (can't see channel)
  return result.data.code === 50_013 || result.data.code === 50_001;
}

/**
 * Check if an error means the target channel (or its guild) no longer exists /
 * is unreachable — i.e. the bot can't deliver because the channel is gone, not
 * because of a permission issue.
 */
export function isMissingChannelError(error: unknown): boolean {
  const result = DiscordAPIErrorSchema.safeParse(error);
  if (!result.success) {
    return false;
  }
  // 10003 = Unknown Channel, 10004 = Unknown Guild
  return result.data.code === 10_003 || result.data.code === 10_004;
}

/**
 * Check if an error confirms the bot is definitively not a member of a guild
 * (as opposed to a transient fetch failure). Used to gate destructive
 * guild-data cleanup on a positive signal from Discord, not just a local
 * cache miss.
 */
export function isUnknownGuildError(error: unknown): boolean {
  const result = DiscordAPIErrorSchema.safeParse(error);
  if (!result.success) {
    return false;
  }
  // 10004 = Unknown Guild
  return result.data.code === 10_004;
}

/**
 * How a delivery failed, for tailoring the owner notification copy.
 */

/**
 * A channel object that carries the guild it belongs to.
 *
 * discord.js types `GuildChannel.guild` as always present, and for a channel
 * built from the gateway cache it is. A channel fetched with
 * `allowUnknownGuild` — how `fetchChannelForDelivery` resolves every delivery,
 * because a gatewayless role has no guild cache to build from — carries no
 * guild at all. So this is a runtime question the types cannot answer, and it
 * is asked with Zod rather than trusted.
 */
const GuildBoundChannelSchema = z.object({
  guild: z.object({ id: z.string() }),
});

/**
 * Whether this channel object can answer permission questions at all.
 *
 * Every permission computation goes through the guild: `permissionsFor`
 * resolves the member and the roles against `guild.members` / `guild.roles`,
 * and `ThreadChannel` reaches its overwrites through `guild.channels`. Without
 * a guild those THROW rather than deny, so "unknown" and "denied" are different
 * answers here and must not be collapsed — a denial is DMed to the guild owner
 * as a permission they revoked.
 */
export function hasResolvedGuild(channel: Channel): boolean {
  return GuildBoundChannelSchema.safeParse(channel).success;
}

/**
 * Whether the bot may post in a channel — including the answer that cannot be
 * computed.
 *
 * `unknown` exists because the two ways of not being allowed have opposite
 * consequences: `denied` is a delivery problem the guild owner can fix and is
 * escalated to them, while `unknown` is an absence of local information (no
 * guild on the channel) that says nothing about the guild's configuration.
 * Reporting the second as the first is how an empty cache turns into a DM
 * accusing an owner of revoking a permission they still grant.
 */
export type SendMessagePermission =
  | { status: "allowed" }
  | { status: "denied"; reason: string }
  | { status: "unknown"; reason: string };

/**
 * Check if the bot has permission to send messages in a channel
 *
 * @param channel - The channel to check permissions for
 * @param botUserId - The bot's own user id, which for a bot is its application id
 * @returns Promise with the allowed / denied / unknown verdict
 */
export async function checkSendMessagePermission(
  channel: Channel,
  botUserId: string,
): Promise<SendMessagePermission> {
  // DM channels don't need permission checks
  if (channel.isDMBased()) {
    return { status: "allowed" };
  }

  // Check if this is a guild-based text channel
  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement &&
    channel.type !== ChannelType.GuildVoice &&
    channel.type !== ChannelType.GuildStageVoice &&
    channel.type !== ChannelType.GuildForum
  ) {
    return {
      status: "denied",
      reason: "Cannot check permissions for this channel type",
    };
  }

  if (!hasResolvedGuild(channel)) {
    return {
      status: "unknown",
      reason:
        "Channel was resolved without its guild (no gateway on this process), so its permissions cannot be read locally",
    };
  }

  try {
    const guild = channel.guild;
    // `guild.members.me` is the gateway cache's copy of the bot's member row,
    // so it is always null on a process that owns no shard — the REST fetch
    // below is then the only answer, and it is the one that matters. Taking the
    // bot's *id* rather than a `User` object is what makes that possible: a
    // gatewayless process has no `client.user`, and the previous null branch
    // reported "Bot user not available", which the delivery path escalated into
    // a DM telling the guild owner they had revoked a permission.
    let botMember = guild.members.me ?? null;

    if (!botMember) {
      try {
        botMember = await guild.members.fetch(botUserId);
      } catch (fetchError) {
        logger.warn(
          `[Permissions] Failed to fetch bot member: ${String(fetchError)}`,
        );
      }
    }

    const permissions = channel.permissionsFor(botMember ?? botUserId);

    if (!permissions) {
      return {
        status: "denied",
        reason:
          "Cannot access channel - bot may not be in the server or channel may be deleted",
      };
    }

    // Check for SendMessages permission
    const canSend = permissions.has(PermissionFlagsBits.SendMessages);
    if (!canSend) {
      return {
        status: "denied",
        reason: "Bot does not have 'Send Messages' permission in this channel",
      };
    }

    // Check for ViewChannel permission
    const canView = permissions.has(PermissionFlagsBits.ViewChannel);
    if (!canView) {
      return {
        status: "denied",
        reason: "Bot cannot view this channel",
      };
    }

    return { status: "allowed" };
  } catch (error) {
    return {
      status: "denied",
      reason: `Error checking permissions: ${String(error)}`,
    };
  }
}

/**
 * Return false only when Read Message History is explicitly unavailable.
 *
 * Resolving the id against an empty member cache yields `null` permissions,
 * which is treated as "unknown, allow" — the same permissive answer this gave
 * for an unready client before. A reply that Discord then rejects is retried as
 * a standalone message by the caller.
 *
 * A channel resolved without its guild is the same "unknown" with a harder
 * edge: `permissionsFor` does not return null there, it throws, and a throw out
 * of a pre-send check is a delivery that never happens. Allow, and let Discord
 * be the one to refuse the reply.
 */
export function hasReadMessageHistoryPermission(
  channel: Channel,
  botUserId: string,
): boolean {
  if (channel.isDMBased() || !hasResolvedGuild(channel)) {
    return true;
  }

  const permissions = channel.permissionsFor(botUserId);
  return (
    permissions === null ||
    permissions.has(PermissionFlagsBits.ReadMessageHistory)
  );
}

/**
 * Get a user-friendly error message for permission failures
 */
export function getPermissionErrorMessage(
  channelId: string,
  reason?: string,
): string {
  const baseMessage = `Unable to send message to channel <#${channelId}>`;

  if (reason !== undefined && reason.length > 0) {
    return `${baseMessage}: ${reason}`;
  }

  return `${baseMessage}. The bot may be missing the 'Send Messages' or 'View Channel' permission.`;
}

/**
 * Format error message for logging
 */
export function formatPermissionErrorForLog(
  channelId: string,
  error: unknown,
  reason?: string,
): string {
  const permissionCheck =
    reason !== undefined && reason.length > 0 ? ` (${reason})` : "";
  const errorDetail = isPermissionError(error)
    ? " [Discord Permission Error]"
    : ` - ${String(error)}`;
  return `Failed to send message to channel ${channelId}${permissionCheck}${errorDetail}`;
}

const FIX_STEPS = `**To fix this:**
1. Go to Server Settings → Roles
2. Find my role or check channel permissions
3. Ensure I have these permissions:
   • View Channel
   • Send Messages`;

/**
 * Build the stage-appropriate permission-error DM body (backed-off escalation).
 */
function buildPermissionMessage(
  stage: PermissionNotifyStage,
  guildName: string,
  channelId: string,
  reasonText: string,
): string {
  return match(stage)
    .with(
      "immediate",
      () => `⚠️ **Bot Permission Issue**

Hello! I'm having trouble posting messages in your server **${guildName}**.

**Channel:** <#${channelId}>
**Issue:** Missing permissions to send messages${reasonText}

${FIX_STEPS}

Need help? Check Discord's permission guide or contact your bot administrator.`,
    )
    .with(
      "week",
      () => `⚠️ **Still can't post in ${guildName}**

It's been about a week and I still can't deliver messages to **<#${channelId}>**.${reasonText}

${FIX_STEPS}

If you no longer want Scout here that's totally fine — you can remove me any time.`,
    )
    .with(
      "month",
      () => `⚠️ **Final reminder — Scout can't post in ${guildName}**

I've been unable to post to **<#${channelId}>** for about a month, so this is the last reminder I'll send about it (I'll stop nagging after this).${reasonText}

${FIX_STEPS}

If Scout isn't a fit, no hard feelings — you can remove me, and I'd love to hear why: ${getFeedbackUrl()}`,
    )
    .exhaustive();
}

const CHANNEL_MISSING_FIX = `**To fix this:**
• Re-create the channel, or
• Point Scout at a channel I can post in by setting things up again (e.g. \`/setup\` or the web dashboard).`;

/**
 * Build the stage-appropriate DM body for a channel that's gone / unreachable
 * (deleted, or the bot lost access) — a different fix than a permission issue.
 */
function buildChannelMissingMessage(
  stage: PermissionNotifyStage,
  guildName: string,
  channelId: string,
  reasonText: string,
): string {
  return match(stage)
    .with(
      "immediate",
      () => `⚠️ **Scout can't reach a channel in ${guildName}**

Hello! I can't find the channel **<#${channelId}>** I was posting to in your server **${guildName}** — it looks like it was deleted or I lost access to it, so your reports/match updates aren't being delivered.${reasonText}

${CHANNEL_MISSING_FIX}`,
    )
    .with(
      "week",
      () => `⚠️ **Still can't reach a channel in ${guildName}**

It's been about a week and the channel **<#${channelId}>** is still unreachable, so nothing is being delivered.${reasonText}

${CHANNEL_MISSING_FIX}

If you no longer want Scout here that's totally fine — you can remove me any time.`,
    )
    .with(
      "month",
      () => `⚠️ **Final reminder — Scout can't reach a channel in ${guildName}**

The channel **<#${channelId}>** has been unreachable for about a month, so this is the last reminder I'll send about it (I'll stop nagging after this).${reasonText}

${CHANNEL_MISSING_FIX}

If Scout isn't a fit, no hard feelings — you can remove me, and I'd love to hear why: ${getFeedbackUrl()}`,
    )
    .exhaustive();
}

/**
 * Notify a server owner that the bot can't deliver to a channel, via DM.
 *
 * Handles owner resolution + DM failure gracefully (never throws) and tracks
 * metrics. `stage` selects the backed-off escalation copy (immediate / 1-week /
 * final 1-month reminder); `kind` selects permission-issue vs missing-channel
 * copy. Defaults to `"permission"` for back-compat.
 */
export async function notifyServerOwnerAboutPermissionError(options: {
  client: Client;
  serverId: string;
  channelId: string;
  stage: PermissionNotifyStage;
  kind?: DeliveryFailureKind;
  reason?: string;
}): Promise<void> {
  const { client, serverId, channelId, stage, reason } = options;
  const kind = options.kind ?? "permission";

  // Track permission error occurrence
  discordPermissionErrorsTotal.inc({
    guild_id: serverId,
    error_type:
      reason !== undefined && reason.length > 0 ? "explicit" : "generic",
  });

  // Resolve the guild owner. This requires the bot to still be a member of the
  // guild; if it isn't (e.g. it was removed), we cannot DM the owner at all.
  let ownerId: string;
  let ownerTag: string;
  let guildName: string;
  try {
    const guild = await client.guilds.fetch(serverId);
    const owner = await guild.fetchOwner();
    ownerId = owner.id;
    ownerTag = owner.user.tag;
    guildName = guild.name;
  } catch (error) {
    logger.warn(
      `[PermissionNotify] Could not resolve owner for guild ${serverId} (bot likely no longer a member): ${getErrorMessage(error)}`,
    );
    discordOwnerNotificationsTotal.inc({
      guild_id: serverId,
      status: "dm_failed",
    });
    return;
  }

  const reasonText =
    reason !== undefined && reason.length > 0
      ? `\n\n**Reason:** ${reason}`
      : "";
  const message =
    kind === "channel_missing"
      ? buildChannelMissingMessage(stage, guildName, channelId, reasonText)
      : buildPermissionMessage(stage, guildName, channelId, reasonText);

  const status = await sendDM({
    client,
    userId: DiscordAccountIdSchema.parse(ownerId),
    message,
    kind: "permission_error",
    guildId: DiscordGuildIdSchema.parse(serverId),
    recipientTag: ownerTag,
  });

  // Typed as a full Record so a new DmStatus is a compile error here rather
  // than an undefined metric label. The budget statuses are unreachable on this
  // path — permission errors are core functionality and are never budgeted —
  // but they still need a defined mapping.
  const metricStatusByDmStatus: Record<DmStatus, string> = {
    sent: "success",
    dm_disabled: "dm_disabled",
    failed: "dm_failed",
    budget_exhausted: "skipped",
    deferred: "skipped",
  };
  const metricStatus = metricStatusByDmStatus[status];
  discordOwnerNotificationsTotal.inc({
    guild_id: serverId,
    status: metricStatus,
  });
}
