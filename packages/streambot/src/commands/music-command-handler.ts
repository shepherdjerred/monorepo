import {
  escapeMarkdown,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { CommandBotDeps } from "@shepherdjerred/streambot/discord/commands/command-bot-deps.ts";
import { runMusicCommand } from "@shepherdjerred/streambot/discord/music.ts";
import { runExternalMusicCommand } from "@shepherdjerred/streambot/discord/music-links.ts";
import {
  musicService,
  requireMusicFeature,
} from "@shepherdjerred/streambot/discord/music-access.ts";
import type { MusicInteraction } from "@shepherdjerred/streambot/discord/music-context.ts";
import { webPageUrl } from "@shepherdjerred/streambot/discord/web-link.ts";
import {
  disambiguatePlaylistName,
  importExternalPlaylist,
  normalizeExternalPlaylistUrl,
  playlistImportNotice,
} from "@shepherdjerred/streambot/music/playlist-import.ts";
import { spotifyLink } from "@shepherdjerred/streambot/music/spotify.ts";
import {
  UserIdSchema,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";

export type PlaylistImportInteraction = MusicInteraction & {
  options: {
    getString: (name: string, required?: boolean) => string | null;
  };
  deferReply: (options: { flags: number }) => Promise<unknown>;
  editReply: (options: {
    content: string;
    allowedMentions?: { parse: readonly never[] };
  }) => Promise<unknown>;
};

export async function runPlaylistImportCommand(
  interaction: PlaylistImportInteraction,
  deps: CommandBotDeps,
): Promise<void> {
  await requireMusicFeature(deps, interaction, "playlists");
  const rawUrl = interaction.options.getString("url", true) ?? "";
  if (spotifyLink(normalizeExternalPlaylistUrl(rawUrl)) !== null) {
    await requireMusicFeature(deps, interaction, "spotifyLinks");
  }
  const store = deps.history?.playlists;
  if (store === undefined || interaction.guildId === null) {
    throw new Error("Playlist storage is not wired");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const customName = interaction.options.getString("name")?.trim();
  const imported = await importExternalPlaylist(
    rawUrl,
    {
      spotify: {
        load: (target, abortSignal) =>
          musicService(deps).spotify.load(target, abortSignal),
      },
      ...(deps.expandPlaylistWithMetadata === undefined
        ? {}
        : { expandPlaylistWithMetadata: deps.expandPlaylistWithMetadata }),
      requireSpotifyAllowed: () =>
        requireMusicFeature(deps, interaction, "spotifyLinks"),
    },
    AbortSignal.timeout(45_000),
  );
  if (imported.provider === "spotify") {
    await requireMusicFeature(deps, interaction, "spotifyLinks");
  }
  const viewer = {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  };
  const playlistName =
    customName !== undefined && customName !== ""
      ? customName
      : disambiguatePlaylistName(
          store.list(viewer, "mine").map((item) => item.name),
          imported.title,
        );
  const saved = store.create(viewer, playlistName, imported.items);
  const base = await webPageUrl(
    deps.config,
    { guildId: interaction.guildId, userId: interaction.user.id },
    "/playlists",
  );
  const url = base === undefined ? undefined : new URL(base);
  url?.searchParams.set("playlist", saved.id);
  const summary = `Saved private playlist **${escapeMarkdown(saved.name)}**. ${playlistImportNotice(imported)}`;
  await interaction.editReply({
    content:
      url === undefined ? summary : `${summary}\n[Open playlists](${url.href})`,
    allowedMentions: { parse: [] },
  });
}

export async function handleMusicCommand(
  interaction: ChatInputCommandInteraction,
  deps: CommandBotDeps,
  issuerVoiceChannel: () => ChannelId | null,
): Promise<boolean> {
  if (
    interaction.commandName === "music" &&
    interaction.options.getSubcommandGroup() === "playlist" &&
    interaction.options.getSubcommand() === "import"
  ) {
    await runPlaylistImportCommand(interaction, deps);
    return true;
  }
  if (
    interaction.commandName === "music" ||
    (interaction.options.getSubcommandGroup() === "playback" &&
      interaction.options.getSubcommand() === "web")
  ) {
    await runMusicCommand(interaction, deps);
    return true;
  }
  if (await runExternalMusicCommand(interaction, deps)) return true;
  const sub = interaction.options.getSubcommand();
  const voice = issuerVoiceChannel();
  if (
    voice !== null &&
    interaction.guildId !== null &&
    ["stop", "clear", "leave"].includes(sub) &&
    deps.config.discord.adminIds.includes(
      UserIdSchema.parse(interaction.user.id),
    )
  ) {
    deps.music?.loads.cancelRoom(
      interaction.guildId,
      voice,
      sub === "leave"
        ? undefined
        : await deps.getSessions().selectedChannel({
            guildId: interaction.guildId,
            channelId: voice,
            userId: interaction.user.id,
          }),
    );
  }
  return false;
}
