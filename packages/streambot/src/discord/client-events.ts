import { Events, type Client } from "discord.js";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { gatewayDisruptionsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("command-bot");

/**
 * Topology removals: without these listeners a deleted voice channel / guild kick leaves the
 * session running against a target that no longer exists — the machine's GUILD_REMOVED /
 * CHANNEL_DELETED handlers were modeled but had no dispatchers until this wiring.
 */
export function registerTopologyListeners(
  client: Client,
  getSessions: () => SessionManager,
): void {
  client.on(Events.GuildDelete, (guild) => {
    const guildId = GuildIdSchema.safeParse(guild.id);
    if (!guildId.success) {
      return;
    }
    log.warn("removed from guild — stopping its sessions", {
      guildId: guildId.data,
    });
    getSessions().notifyGuildRemoved(guildId.data);
  });
  client.on(Events.ChannelDelete, (channel) => {
    if (channel.isDMBased() || !channel.isVoiceBased()) {
      return;
    }
    const guildId = GuildIdSchema.safeParse(channel.guild.id);
    const channelId = ChannelIdSchema.safeParse(channel.id);
    if (guildId.success && channelId.success) {
      getSessions().notifyChannelDeleted(guildId.data, channelId.data);
    }
  });
}

/**
 * Gateway health observability: a dropped/invalidated command gateway means slash commands
 * silently stop working — surface it in logs + metrics instead of nothing.
 */
export function registerGatewayHealthListeners(client: Client): void {
  client.on(Events.ShardDisconnect, (event) => {
    gatewayDisruptionsTotal.inc({ client: "command", kind: "disconnect" });
    log.warn("command gateway shard disconnected", { code: event.code });
  });
  client.on(Events.Invalidated, () => {
    gatewayDisruptionsTotal.inc({ client: "command", kind: "invalidated" });
    log.error(
      "command gateway session invalidated — slash commands are dead until the process restarts",
    );
  });
  client.on(Events.Error, (error) => {
    gatewayDisruptionsTotal.inc({ client: "command", kind: "error" });
    log.warn("command client error", { error: getErrorMessage(error) });
  });
}
