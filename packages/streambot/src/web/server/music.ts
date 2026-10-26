import { z } from "zod";
import { MusicQuerySchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { queueBatch } from "@shepherdjerred/streambot/commands/queue-batch.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { WebCommand } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { WebPlayback } from "./playback.ts";
import type { WebSession } from "./session-store.ts";
import { Selections } from "./selections.ts";
import { WebError, requestInput } from "./errors.ts";
import { WebPlaylists } from "./music-playlists.ts";
import { ExternalMusicQueue } from "./music-links.ts";
import { MusicQueueMatch } from "./music-queue-match.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";

import type {
  MusicFeature,
  MusicPlaylistOrigin,
  MusicSelection,
} from "./music-owner.ts";
export class WebMusic {
  private readonly selections = new Selections<MusicSelection>();
  private readonly playlists = new WebPlaylists(this);
  private readonly links = new ExternalMusicQueue(this);
  private readonly queueMatch = new MusicQueueMatch(this);
  constructor(readonly playback: WebPlayback) {}
  owner(session: WebSession, guildId: string) {
    return session.key + ":" + guildId;
  }
  async features(session: WebSession, guildId: string) {
    const scope = {
      guildId,
      userId: session.identity.userId,
      channelId: "web",
    };
    const gates = this.playback.deps.featureGate;
    const [catalog, spotify, playlists] = await Promise.all([
      gates.musicCatalog?.(scope),
      gates.spotifyLinks?.(scope),
      gates.playlists?.(scope),
    ]);
    return {
      catalog: this.playback.deps.music !== undefined && catalog === true,
      spotify: this.playback.deps.music !== undefined && spotify === true,
      playlists:
        this.playback.deps.commands.history !== undefined && playlists === true,
    };
  }
  async require(session: WebSession, guildId: string, feature: MusicFeature) {
    await this.playback.authorize(session, guildId);
    const features = await this.features(session, guildId);
    if (!features[feature])
      throw new WebError(
        403,
        "feature_disabled",
        "This music feature is not enabled in this server yet.",
      );
  }
  service() {
    const music = this.playback.deps.music;
    if (music === undefined) throw new Error("Music service is not wired");
    return music;
  }
  add(
    session: WebSession,
    guildId: string,
    sources: readonly Source[],
    feature: MusicFeature | MusicPlaylistOrigin = "catalog",
  ) {
    return this.selections.add(this.owner(session, guildId), {
      sources,
      feature: typeof feature === "string" ? feature : "playlists",
      ...(typeof feature === "string" ? {} : { origin: feature }),
    });
  }
  get(session: WebSession, guildId: string, id: string) {
    const selection = this.selections.get(this.owner(session, guildId), id);
    if (selection.origin !== undefined)
      this.playlists.sources(
        session,
        guildId,
        selection.origin.playlistId,
        selection.origin.revision,
      );
    return selection;
  }
  async handle(
    request: Request,
    url: URL,
    session: WebSession,
  ): Promise<Response | null> {
    if (url.pathname === "/api/playlists")
      return await this.playlists.handle(request, url, session);
    if (!url.pathname.startsWith("/api/music/")) return null;
    const guildId = url.searchParams.get("guildId") ?? "";
    await this.playback.authorize(session, guildId);
    if (url.pathname === "/api/music/queue-match")
      return await this.queueMatch.handle(request, session, guildId);
    if (url.pathname === "/api/music/features" && request.method === "GET")
      return Response.json(await this.features(session, guildId));
    if (url.pathname === "/api/music/load")
      return this.load(request, url, session, guildId);
    if (request.method !== "GET")
      throw new WebError(405, "method", "This method is not supported.");
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(30_000),
    ]);
    if (url.pathname === "/api/music/matches")
      return await this.matches(url, session, guildId, signal);
    if (url.pathname === "/api/music/artwork")
      return await musicArtwork(url.searchParams.get("id") ?? "", signal);
    await this.require(session, guildId, "catalog");
    return await this.catalog(url, session, guildId, signal);
  }
  private load(
    request: Request,
    url: URL,
    session: WebSession,
    guildId: string,
  ) {
    const id = requestInput(z.uuid(), url.searchParams.get("id"));
    if (request.method === "GET")
      return Response.json(
        this.service().loads.read(id, session.identity.userId, guildId),
      );
    if (request.method === "POST")
      return Response.json(
        this.service().loads.cancel(id, session.identity.userId, guildId),
      );
    throw new WebError(405, "method", "This method is not supported.");
  }
  private async matches(
    url: URL,
    session: WebSession,
    guildId: string,
    signal: AbortSignal,
  ) {
    const selection = this.get(
      session,
      guildId,
      url.searchParams.get("selectionId") ?? "",
    );
    await this.require(session, guildId, selection.feature);
    const source = selection.sources[0];
    if (selection.sources.length !== 1 || source?.music === undefined)
      throw new WebError(400, "track_required", "Choose one song to match.");
    const track = source.music;
    const matches = await this.service().matches(track, signal);
    return Response.json(
      matches.map((match) => ({
        ...match,
        selectionId: this.add(
          session,
          guildId,
          [musicSource(track, match.url)],
          selection.origin ?? selection.feature,
        ),
      })),
    );
  }
  private async catalog(
    url: URL,
    session: WebSession,
    guildId: string,
    signal: AbortSignal,
  ) {
    switch (url.pathname) {
      case "/api/music/catalog": {
        const page = await this.service().catalog.browse(
          url.searchParams,
          signal,
        );
        return Response.json({
          ...page,
          items: page.items.map((item) =>
            item.track === undefined
              ? item
              : {
                  ...item,
                  selectionId: this.add(session, guildId, [
                    musicSource(item.track),
                  ]),
                },
          ),
        });
      }
      case "/api/music/album": {
        const input = requestInput(
          MusicQuerySchema,
          Object.fromEntries(url.searchParams),
        );
        if (input.album === undefined)
          throw new WebError(400, "album_required", "Choose an album.");
        const album = await this.service().catalog.album(
          input.album,
          input.release,
          signal,
        );
        const all = album.tracks.map((track) => musicSource(track));
        const tracks = album.tracks.slice(input.offset, input.offset + 50);
        const selections = tracks.map((track) =>
          this.add(session, guildId, [musicSource(track)]),
        );
        return Response.json({
          ...album,
          tracks,
          offset: input.offset,
          total: all.length,
          selections,
          selectionId: this.add(session, guildId, all),
        });
      }
      default:
        throw new WebError(
          404,
          "not_found",
          "This music endpoint does not exist.",
        );
    }
  }
  async execute(
    session: WebSession,
    input: Extract<WebCommand, { action: "play" }>,
    signal: AbortSignal,
  ): Promise<{ message: string; loadId?: string } | null> {
    const selection = input.selection;
    if (selection.kind !== "music" && selection.kind !== "playlist")
      return await this.links.execute(session, input);
    const feature =
      selection.kind === "music"
        ? this.get(session, input.guildId, selection.id).feature
        : "playlists";
    await this.require(session, input.guildId, feature);
    const context = await this.playback.commandContext(session, input);
    try {
      const sources =
        selection.kind === "music"
          ? this.get(session, input.guildId, selection.id).sources
          : this.playlists.sources(
              session,
              input.guildId,
              selection.id,
              selection.revision,
            );
      return await queueBatch({
        deps: context.commandDeps,
        sources,
        userId: context.userId,
        placement: input.placement,
        signal,
      });
    } finally {
      this.playback.deps.sessions.releaseUnused(
        context.guildId,
        context.channelId,
        context.playbackChannel,
      );
    }
  }
  cancelRoom(_session: WebSession, command: WebCommand) {
    if (command.action === "stop" || command.action === "clear")
      this.playback.deps.music?.loads.cancelRoom(
        command.guildId,
        command.channelId,
        command.playbackChannel ?? undefined,
      );
  }
}

/** Identifiers, not arbitrary remote URLs, cross the artwork endpoint. */
async function musicArtwork(
  id: string,
  signal: AbortSignal,
): Promise<Response> {
  requestInput(z.uuid(), id);
  let url = new URL(
    "https://coverartarchive.org/release-group/" + id + "/front-250",
  );
  for (let redirects = 0; redirects < 5; redirects += 1) {
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !(
        url.hostname === "coverartarchive.org" ||
        url.hostname === "archive.org" ||
        url.hostname.endsWith(".archive.org")
      )
    )
      throw new Error("Unexpected artwork destination");
    const response = await fetch(url, { signal, redirect: "manual" });
    const location = response.headers.get("location");
    if (location !== null && response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (response.status === 404) return new Response(null, { status: 404 });
    if (!response.ok)
      throw new MusicError(
        503,
        "artwork_unavailable",
        "Album artwork is unavailable.",
      );
    const type = response.headers.get("content-type") ?? "";
    if (!/^image\/(?:jpeg|png|webp)$/u.test(type))
      throw new Error("Unexpected artwork type");
    return new Response(response.body, {
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=3600",
      },
    });
  }
  throw new Error("Too many artwork redirects");
}
