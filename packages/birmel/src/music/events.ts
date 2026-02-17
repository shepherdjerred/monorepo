import type { Player } from "discord-player";
import { logger } from "../utils/index.js";
import { recordTrackPlay } from "../database/repositories/music-history.js";

type ChannelMetadata = {
  send?: (msg: string) => Promise<unknown>;
  id?: string;
};

export function setupPlayerEvents(player: Player): void {
  player.events.on("playerStart", (queue, track) => {
    const channel = queue.metadata as ChannelMetadata | undefined;
    if (channel?.send != null) {
      void channel.send(`🎵 Now playing: **${track.title}**`);
    }

    // Record to history
    const trackDuration = track.durationMS
      ? Math.floor(track.durationMS / 1000)
      : undefined;
    recordTrackPlay({
      guildId: queue.guild.id,
      channelId: channel?.id ?? "",
      requestedBy: track.requestedBy?.id ?? "unknown",
      trackTitle: track.title,
      trackUrl: track.url,
      ...(trackDuration !== undefined && { trackDuration }),
    });

    logger.info("Started playing track", {
      guildId: queue.guild.id,
      track: track.title,
    });
  });

  player.events.on("audioTrackAdd", (queue, track) => {
    const channel = queue.metadata as ChannelMetadata | undefined;
    if (channel?.send != null) {
      void channel.send(`✅ Added to queue: **${track.title}**`);
    }
  });

  player.events.on("emptyQueue", (queue) => {
    const channel = queue.metadata as ChannelMetadata | undefined;
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
    const channel = queue.metadata as ChannelMetadata | undefined;
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
