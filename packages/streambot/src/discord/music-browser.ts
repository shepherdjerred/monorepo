import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from "discord.js";
import type { CommandBotDeps } from "./commands/command-bot-deps.ts";
import { musicCommandContext } from "./music-context.ts";
import { musicBrowserView } from "./music-view.ts";
import { webPageUrl } from "./web-link.ts";
import {
  musicService,
  requireMusicFeature,
  musicErrorMessage,
} from "./music-access.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import type { MusicEntity } from "@shepherdjerred/streambot/music/contracts.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { queueBatch } from "@shepherdjerred/streambot/commands/queue-batch.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";

type Choice = {
  kind: string;
  title: string;
  subtitle: string;
  entity?: MusicEntity;
  source?: Source;
};

export class DiscordMusicBrowser {
  private readonly music;
  private readonly root;
  private params;
  private offset = 0;
  private choices: Choice[] = [];
  private all: readonly Source[] = [];
  private next = false;
  private title = "Music results";
  private busy = false;
  private readonly lifetime = AbortSignal.timeout(5 * 60_000);
  private base: string | undefined;
  private stop: (() => void) | undefined;
  constructor(
    private readonly interaction: ChatInputCommandInteraction,
    private readonly deps: CommandBotDeps,
  ) {
    this.music = musicService(deps);
    const sub = interaction.options.getSubcommand();
    this.root = new URLSearchParams({
      query: interaction.options.getString("query", true),
      type:
        sub === "search"
          ? (interaction.options.getString("type") ?? "all")
          : sub,
      limit: "10",
    });
    this.params = new URLSearchParams(this.root);
  }
  async run() {
    await requireMusicFeature(this.deps, this.interaction, "musicCatalog");
    await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    this.base = await webPageUrl(
      this.deps.config,
      {
        guildId: this.interaction.guildId ?? undefined,
        userId: this.interaction.user.id,
      },
      "/music",
    );
    await this.render();
    const message = await this.interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      time: 5 * 60_000,
    });
    this.stop = () => {
      collector.stop("queued");
    };
    collector.on("collect", (component) => {
      void this.handle(component);
    });
    collector.on("end", () => {
      void this.clear();
    });
  }
  private async render() {
    this.params.set("offset", String(this.offset));
    const albumId = this.params.get("album");
    if (albumId === null) {
      const page = await this.music.catalog.browse(this.params, this.lifetime);
      this.choices = page.items.slice(0, 10).map((entity) => ({
        ...entity,
        entity,
        ...(entity.track === undefined
          ? {}
          : { source: musicSource(entity.track) }),
      }));
      this.all = [];
      this.next = page.hasMore ?? this.offset + 10 < page.total;
      this.title = this.params.has("artist")
        ? "Artist releases"
        : "Music results";
    } else {
      const album = await this.music.catalog.album(
        albumId,
        undefined,
        this.lifetime,
      );
      this.title = album.title;
      this.all = album.tracks.map((track) => musicSource(track));
      this.choices = album.tracks
        .slice(this.offset, this.offset + 10)
        .map((track) => ({
          kind: "song",
          title: track.title,
          subtitle: track.artists.join(", "),
          source: musicSource(track),
        }));
      this.next = this.offset + 10 < album.tracks.length;
    }
    await this.update();
  }
  private async update() {
    let url = this.base;
    if (url !== undefined) {
      const link = new URL(url);
      for (const [key, value] of this.params)
        link.searchParams.set(key === "query" ? "q" : key, value);
      url = link.href;
    }
    await this.interaction.editReply(
      musicBrowserView({
        title: this.title,
        description:
          "Choose music here, or open Streambot for album editions, saved playlists, and video choices.",
        items: this.choices,
        previous: this.offset > 0,
        next: this.next,
        queueAll: this.all.length > 0,
        url,
        artworkUrl: musicArtworkUrl(
          this.all[0]?.music ??
            this.choices[0]?.source?.music ??
            this.choices[0]?.entity,
        ),
      }),
    );
  }
  private async navigate(component: MessageComponentInteraction) {
    switch (component.customId) {
      case "music_previous":
        this.offset = Math.max(0, this.offset - 10);
        break;
      case "music_next":
        this.offset += 10;
        break;
      case "music_back":
        this.params = new URLSearchParams(this.root);
        this.offset = 0;
        break;
      case "music_all":
        await this.queue(component, this.all);
        return;
      default:
        await this.choose(component);
        return;
    }
    await this.render();
  }
  private async choose(component: MessageComponentInteraction) {
    if (!component.isStringSelectMenu())
      throw new MusicError(
        400,
        "selection_invalid",
        "Choose a result from the menu.",
      );
    const choice = this.choices[Number(component.values[0])];
    if (choice === undefined)
      throw new MusicError(
        409,
        "selection_expired",
        "These results changed. Search again.",
      );
    const entity = choice.entity;
    if (entity?.kind === "artist" || entity?.kind === "album") {
      this.params.set(entity.kind, entity.id);
      this.offset = 0;
      if (entity.kind === "artist") this.params.delete("album");
      await this.render();
      return;
    }
    const source = choice.source;
    if (source === undefined) throw new Error("Music choice has no source");
    if (source.kind !== "search" || source.music === undefined) {
      await this.queue(component, [source]);
      return;
    }
    const track = source.music;
    const matches = await this.music.matches(track, this.lifetime);
    const confident = matches.find((match) => match.confident);
    if (confident !== undefined) {
      await this.queue(component, [musicSource(track, confident.url)]);
      return;
    }
    this.choices = matches.map((match) => ({
      kind: "video",
      title: match.title,
      subtitle: match.channel ?? "YouTube",
      source: musicSource(track, match.url),
    }));
    this.all = [];
    this.next = false;
    this.offset = 0;
    this.title = "Choose a YouTube recording";
    await this.update();
  }
  private async queue(
    component: MessageComponentInteraction,
    sources: readonly Source[],
  ) {
    const deps = await musicCommandContext(component, this.deps);
    const result = await queueBatch({
      deps,
      sources,
      userId: UserIdSchema.parse(component.user.id),
      placement: "queue",
      signal: this.lifetime,
    });
    await this.interaction.editReply({
      content:
        result.message +
        (this.base === undefined
          ? ""
          : "\n[Open Streambot](" + this.base + ")"),
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
    this.stop?.();
  }
  private async handle(component: MessageComponentInteraction) {
    try {
      if (component.user.id !== this.interaction.user.id) {
        await component.reply({
          content: "Run /music search to browse your own results.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (this.busy) {
        await component.reply({
          content: "The previous selection is still loading.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      this.busy = true;
      await component.deferUpdate();
      try {
        await requireMusicFeature(this.deps, component, "musicCatalog");
        await this.navigate(component);
      } catch (error) {
        await component.followUp({
          content: musicErrorMessage(error),
          flags: MessageFlags.Ephemeral,
        });
      } finally {
        this.busy = false;
      }
    } catch {
      logger.warn("music interaction response could not be delivered");
      this.stop?.();
    }
  }
  private async clear() {
    try {
      await this.interaction.editReply({ components: [] });
    } catch {
      logger.debug("music browser reply expired");
    }
  }
}
