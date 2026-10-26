import {
  MessageFlags,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { CommandBotDeps } from "./commands/command-bot-deps.ts";
import { requireMusicFeature } from "./music-access.ts";
import { musicCommandContext } from "./music-context.ts";
import { sendPaginatedReply } from "./pagination.ts";
import { webPageUrl } from "./web-link.ts";
import { queueBatch } from "@shepherdjerred/streambot/commands/queue-batch.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import type {
  PlaylistStore,
  PlaylistViewer,
} from "@shepherdjerred/streambot/music/playlists.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

async function playlistResult(
  interaction: ChatInputCommandInteraction,
  deps: CommandBotDeps,
  store: PlaylistStore,
  viewer: PlaylistViewer,
) {
  const action = interaction.options.getSubcommand();
  if (action === "list") {
    const scope =
      interaction.options.getString("scope") === "server" ? "server" : "mine";
    return {
      lines: store
        .list(viewer, scope)
        .map(
          (p) =>
            escapeMarkdown(p.name) +
            " · " +
            String(p.count) +
            " tracks · `" +
            p.id +
            "`",
        ),
    };
  }
  if (action === "save") {
    const context = await musicCommandContext(interaction, deps);
    const view = context.view();
    const items = [
      ...(view.current === null ? [] : [view.current]),
      ...view.queue,
    ];
    if (items.length === 0)
      throw new MusicError(
        400,
        "queue_empty",
        "Queue a song before saving a playlist.",
      );
    context.assertCurrent?.();
    const saved = store.create(
      viewer,
      interaction.options.getString("name", true),
      items.flatMap((item) =>
        item.source === undefined
          ? []
          : [{ title: item.title, source: item.source }],
      ),
    );
    return {
      id: saved.id,
      lines: ["Saved private playlist **" + escapeMarkdown(saved.name) + "**."],
    };
  }
  const query = interaction.options.getString("playlist", true);
  const candidates = [
    ...store.list(viewer, "mine"),
    ...store.list(viewer, "server"),
  ];
  const ids = new Set(
    candidates
      .filter((p) => p.id === query || p.name === query)
      .map((p) => p.id),
  );
  if (ids.size !== 1)
    throw new MusicError(
      404,
      "playlist_missing",
      "Use a unique playlist name or the ID from /music playlist list.",
    );
  const id = [...ids][0];
  if (id === undefined) throw new Error("Playlist lookup invariant");
  const playlist = store.read(id, viewer);
  if (action === "play") {
    const result = await queueBatch({
      deps: await musicCommandContext(interaction, deps),
      sources: playlist.items.map((item) => item.source),
      userId: UserIdSchema.parse(viewer.userId),
      placement: "queue",
      signal: AbortSignal.timeout(30_000),
    });
    return { id, lines: [result.message] };
  }
  if (action === "share" || action === "private") {
    store.edit(id, viewer, playlist.revision, (p) => {
      p.guild_id = action === "share" ? viewer.guildId : null;
    });
    return {
      id,
      lines: [
        action === "share"
          ? "Playlist shared with this server. Members can play or copy it."
          : "Playlist is private.",
      ],
    };
  }
  return {
    id,
    lines: playlist.items.map(
      (item, index) =>
        String(index + 1) + ". " + escapeMarkdown(item.title).slice(0, 180),
    ),
  };
}

export async function runPlaylistCommand(
  interaction: ChatInputCommandInteraction,
  deps: CommandBotDeps,
) {
  await requireMusicFeature(deps, interaction, "playlists");
  const store = deps.history?.playlists;
  if (store === undefined || interaction.guildId === null)
    throw new Error("Playlist storage is not wired");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await playlistResult(interaction, deps, store, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  const base = await webPageUrl(
    deps.config,
    { guildId: interaction.guildId, userId: interaction.user.id },
    "/playlists",
  );
  const url = base === undefined ? undefined : new URL(base);
  if (result.id !== undefined) url?.searchParams.set("playlist", result.id);
  const pages: string[] = [];
  for (let i = 0; i < result.lines.length; i += 8)
    pages.push(result.lines.slice(i, i + 8).join("\n"));
  await sendPaginatedReply(interaction, {
    header:
      url === undefined
        ? "Streambot playlists"
        : "[Open Streambot](" + url.href + ")",
    pages: pages.length === 0 ? ["No tracks or playlists yet."] : pages,
  });
}
