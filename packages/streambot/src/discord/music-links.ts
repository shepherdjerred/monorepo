import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from "discord.js";
import type { CommandBotDeps } from "./commands/command-bot-deps.ts";
import { musicCommandContext } from "./music-context.ts";
import {
  musicErrorMessage,
  requireMusicFeature,
  musicService,
} from "./music-access.ts";
import { webPageUrl } from "./web-link.ts";
import { spotifyLink } from "@shepherdjerred/streambot/music/spotify.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { isLikelyPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { queueBatch } from "@shepherdjerred/streambot/commands/queue-batch.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import type { MusicInteraction } from "./music-context.ts";
import {
  collectMusicCancellation,
  type MusicLinkReply,
} from "./music-link-reply.ts";

async function cancel(
  component: MessageComponentInteraction,
  interaction: MusicInteraction,
  deps: CommandBotDeps,
  load: { id: string; reply: MusicLinkReply },
) {
  try {
    if (component.user.id !== interaction.user.id) {
      await component.reply({
        content: "Only the person loading this playlist can cancel it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await component.deferUpdate();
    const result = musicService(deps).loads.cancel(
      load.id,
      interaction.user.id,
      interaction.guildId ?? "",
    );
    await load.reply.edit({
      content: result.message,
      components: [],
    });
  } catch {
    logger.warn("playlist cancellation reply could not be delivered");
  }
}

export async function runExternalMusicCommand(
  interaction: ChatInputCommandInteraction,
  deps: CommandBotDeps,
): Promise<boolean> {
  if (interaction.commandName !== "stream") return false;
  const sub = interaction.options.getSubcommand();
  if (sub !== "play" && sub !== "playnext") return false;
  const query = interaction.options.getString("query", true);
  return await loadMusicLink(
    interaction,
    deps,
    {
      query,
      ...linkOptions(interaction),
      subtitles: linkSubtitles(interaction),
    },
    {
      start: async (payload) => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply(payload);
      },
      edit: (payload) => interaction.editReply(payload),
      onCancel: async (listener) => {
        collectMusicCancellation(await interaction.fetchReply(), listener);
      },
    },
  );
}

export async function loadMusicLink(
  interaction: MusicInteraction,
  deps: CommandBotDeps,
  options: {
    query: string;
    placement: "queue" | "next" | "now";
    mode: Source["mode"] | null;
    subtitles?: Source["subtitles"];
  },
  reply: MusicLinkReply,
): Promise<boolean> {
  const { query } = options;
  const spotify = spotifyLink(query);
  if (deps.music === undefined) return false;
  if (spotify === null && !isLikelyPlaylist(query)) return false;
  if (spotify !== null)
    await requireMusicFeature(deps, interaction, "spotifyLinks");
  const context = await musicCommandContext(interaction, deps);
  const { placement, mode, subtitles } = options;
  if (spotify !== null && (mode === "video" || subtitles?.enabled === true))
    throw new MusicError(
      400,
      "spotify_audio",
      "Spotify links play as music. Use a YouTube link for video or subtitles.",
    );
  const url = await webPageUrl(
    deps.config,
    { guildId: interaction.guildId ?? undefined, userId: interaction.user.id },
    "/music",
  );
  const suffix = url === undefined ? "" : "\n[Open Streambot](" + url + ")";
  await reply.start({
    content: "Loading playlist…" + suffix,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("music_cancel")
          .setLabel("Cancel loading")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  const music = musicService(deps);
  let load: ReturnType<typeof music.loads.start>;
  try {
    load = music.loads.start(
      {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? "",
        channelId: context.channelId ?? "",
        slot: context.playbackChannel,
      },
      async (signal, progress) => {
        let sources: readonly Source[];
        let complete: boolean | null = true;
        let warning = "";
        if (spotify === null) {
          const items = await deps.expandPlaylist(query, signal, progress);
          sources = items.map((item) => ({
            kind: "url",
            url: item.url,
            title: item.title,
            subtitles,
            ...(mode === null ? {} : { mode }),
          }));
        } else {
          const result = await music.spotify.load(spotify, signal);
          sources = result.tracks.map((track) => musicSource(track));
          complete = result.complete;
          warning = result.warning;
        }
        progress(sources.length);
        if (spotify !== null)
          await requireMusicFeature(deps, interaction, "spotifyLinks");
        const result = await queueBatch({
          deps: context,
          sources,
          userId: UserIdSchema.parse(interaction.user.id),
          placement,
          signal,
        });
        return {
          count: sources.length,
          complete,
          message: result.message + (warning === "" ? "" : " " + warning),
        };
      },
      async (result) => {
        await reply.edit({
          content: result.message + suffix,
          components: [],
          allowedMentions: { parse: [] },
        });
      },
    );
  } catch (error) {
    await reply.edit({
      content: musicErrorMessage(error),
      components: [],
      allowedMentions: { parse: [] },
    });
    return true;
  }
  await reply.onCancel((component) => {
    void cancel(component, interaction, deps, { id: load.id, reply });
  });
  return true;
}

function linkSubtitles(
  interaction: ChatInputCommandInteraction,
): Source["subtitles"] {
  const setting = interaction.options.getString("subtitles");
  const language = interaction.options.getString("sublang");
  if (setting === null && language === null) return;
  return {
    ...(setting === null ? {} : { enabled: setting === "on" }),
    ...(language === null ? {} : { language }),
  };
}

function linkOptions(interaction: ChatInputCommandInteraction): {
  placement: "queue" | "next" | "now";
  mode: Source["mode"] | null;
} {
  const sub = interaction.options.getSubcommand();
  const placement =
    sub === "playnext"
      ? "next"
      : (interaction.options.getString("placement") ?? "queue");
  if (placement !== "queue" && placement !== "next" && placement !== "now")
    throw new Error("Invalid placement");
  const mode = interaction.options.getString("mode");
  if (mode !== null && mode !== "music" && mode !== "video" && mode !== "auto")
    throw new Error("Invalid media mode");
  return { placement, mode };
}
