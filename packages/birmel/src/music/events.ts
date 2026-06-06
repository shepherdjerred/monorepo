import type { Player } from "discord-player";
import type { MessageCreateOptions } from "discord.js";
import { z } from "zod";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { recordTrackPlay } from "@shepherdjerred/birmel/database/repositories/music-history.ts";
import { buildActionEmbed, buildNowPlayingEmbed } from "./embeds.ts";
import { normalizeTrack, trackDurationSeconds } from "./metadata.ts";

type ChannelMetadata = {
  send?: ((msg: string | MessageCreateOptions) => Promise<unknown>) | undefined;
  id?: string | undefined;
};

const ChannelMetadataSchema = z
  .object({
    send: z.unknown().optional(),
    id: z.string().optional(),
  })
  .loose();

function wrapSendFunction(
  value: unknown,
): ((msg: string | MessageCreateOptions) => Promise<unknown>) | undefined {
  if (typeof value !== "function") {
    return undefined;
  }
  const fn = value;
  return (msg: string | MessageCreateOptions): Promise<unknown> => {
    const result: unknown = Reflect.apply(fn, undefined, [msg]);
    if (result instanceof Promise) {
      return result;
    }
    return Promise.resolve(result);
  };
}

function getChannelMetadata(metadata: unknown): ChannelMetadata | undefined {
  const result = ChannelMetadataSchema.safeParse(metadata);
  if (!result.success) {
    return undefined;
  }
  return { send: wrapSendFunction(result.data.send), id: result.data.id };
}

export function setupPlayerEvents(player: Player): void {
  player.events.on("playerStart", (queue, track) => {
    const channel = getChannelMetadata(queue.metadata);
    const trackInfo = normalizeTrack(track);
    const trackDuration = trackDurationSeconds(track);
    if (channel?.send != null) {
      void channel.send({
        embeds: [
          buildNowPlayingEmbed(
            trackInfo,
            queue.node.createProgressBar() ?? undefined,
          ),
        ],
      });
    }

    recordTrackPlay({
      guildId: queue.guild.id,
      channelId: channel?.id ?? "",
      requestedBy: track.requestedBy?.id ?? "unknown",
      trackTitle: trackInfo.title,
      trackUrl: trackInfo.url,
      ...(trackDuration !== undefined && { trackDuration }),
    });

    logger.info("Started playing track", {
      guildId: queue.guild.id,
      track: trackInfo.title,
    });
  });

  player.events.on("audioTrackAdd", (queue, track) => {
    const channel = getChannelMetadata(queue.metadata);
    const trackInfo = normalizeTrack(track);
    if (channel?.send != null) {
      void channel.send({
        embeds: [
          buildActionEmbed({
            title: "Added to Queue",
            message: `Added: ${trackInfo.title}`,
            track: trackInfo,
          }),
        ],
      });
    }
  });

  player.events.on("emptyQueue", (queue) => {
    const channel = getChannelMetadata(queue.metadata);
    if (channel?.send != null) {
      void channel.send(
        "Queue finished! Add more songs to keep the party going.",
      );
    }
    logger.debug("Queue empty", { guildId: queue.guild.id });
  });

  player.events.on("emptyChannel", (queue) => {
    logger.debug("Voice channel empty, disconnecting", {
      guildId: queue.guild.id,
    });
  });

  player.events.on("error", (queue, error) => {
    logger.error("Player error", error, { guildId: queue.guild.id });
  });

  player.events.on("playerError", (queue, error) => {
    logger.error("Player playback error", error, { guildId: queue.guild.id });
    const channel = getChannelMetadata(queue.metadata);
    if (channel?.send != null) {
      void channel.send("An error occurred during playback. Skipping...");
    }
  });

  player.events.on("disconnect", (queue) => {
    logger.debug("Disconnected from voice channel", {
      guildId: queue.guild.id,
    });
  });
}
