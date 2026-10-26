import { spotifyLink } from "@shepherdjerred/streambot/music/spotify.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { isLikelyPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { queueBatch } from "@shepherdjerred/streambot/commands/queue-batch.ts";
import type { WebCommand } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { WebMusicOwner } from "./music-owner.ts";
import type { WebSession } from "./session-store.ts";

export class ExternalMusicQueue {
  constructor(private readonly music: WebMusicOwner) {}
  private async sources(
    url: string,
    signal: AbortSignal,
    progress: (count: number) => void,
  ) {
    const spotify = spotifyLink(url);
    if (spotify !== null) {
      const result = await this.music.service().spotify.load(spotify, signal);
      return {
        sources: result.tracks.map((track) => musicSource(track)),
        complete: result.complete,
        warning: result.warning,
      };
    }
    const expand = this.music.playback.deps.expandPlaylist;
    if (expand === undefined)
      throw new Error("Playlist expansion is not wired");
    const items = await expand(url, signal, progress);
    const sources: Source[] = items.map((item) => ({
      kind: "url",
      url: item.url,
      title: item.title,
    }));
    return { sources, complete: true, warning: "" };
  }
  async execute(
    session: WebSession,
    input: Extract<WebCommand, { action: "play" }>,
  ) {
    const selection = input.selection;
    if (selection.kind !== "url") return null;
    const spotify = spotifyLink(selection.url);
    if (spotify === null && !isLikelyPlaylist(selection.url)) return null;
    if (spotify !== null)
      await this.music.require(session, input.guildId, "spotify");
    const playback = this.music.playback;
    const context = await playback.commandContext(session, input);
    const load = this.music.service().loads.start(
      {
        userId: context.userId,
        guildId: context.guildId,
        channelId: context.channelId,
        slot: context.playbackChannel,
      },
      async (signal, progress) => {
        try {
          const { sources, complete, warning } = await this.sources(
            selection.url,
            signal,
            progress,
          );
          progress(sources.length);
          if (spotify !== null)
            await this.music.require(session, input.guildId, "spotify");
          await playback.authorize(session, input.guildId);
          context.guard();
          const result = await queueBatch({
            deps: context.commandDeps,
            sources,
            userId: context.userId,
            placement: input.placement,
            signal,
          });
          return {
            count: sources.length,
            complete,
            message: result.message + (warning === "" ? "" : " " + warning),
          };
        } finally {
          playback.deps.sessions.releaseUnused(
            context.guildId,
            context.channelId,
            context.playbackChannel,
          );
        }
      },
    );
    return { message: load.message, loadId: load.id };
  }
}
