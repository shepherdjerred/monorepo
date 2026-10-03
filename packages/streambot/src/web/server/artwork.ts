import { createHmac, randomBytes } from "node:crypto";
import type {
  PosterFetcher,
  PosterInfo,
} from "@shepherdjerred/streambot/metadata/tmdb.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/web/shared/artwork.ts";
import { WebError } from "./errors.ts";
import {
  PlexArtworkUnavailableError,
  type LibraryArtworkProvider,
} from "@shepherdjerred/streambot/metadata/plex.ts";

/** Poster lookup is lazy: browsing and playback never wait for image metadata. */
export class WebArtwork {
  private readonly key = randomBytes(32);
  private readonly pending = new Map<string, Promise<PosterInfo | null>>();

  constructor(
    private readonly library: () => readonly LibraryEntry[],
    private readonly fetchPoster: PosterFetcher | undefined,
    private readonly plex?: LibraryArtworkProvider,
  ) {}

  forEntry(entry: LibraryEntry, guildId: string): string | undefined {
    return this.fetchPoster === undefined && this.plex === undefined
      ? undefined
      : "/api/artwork?" +
          new URLSearchParams({ guildId, id: this.id(entry.path) }).toString();
  }

  forSource(
    source: Source | undefined,
    guildId: string,
    thumbnail?: string,
  ): string | undefined {
    if (source?.kind === "file") {
      const entry = this.library().find((item) => item.path === source.path);
      return entry === undefined ? undefined : this.forEntry(entry, guildId);
    }
    return thumbnail !== undefined && isRemoteArtworkUrl(thumbnail)
      ? thumbnail
      : undefined;
  }

  async resolve(
    id: string,
    plexEnabled = false,
    signal?: AbortSignal,
  ): Promise<Response> {
    const entry = this.library().find((item) => this.id(item.path) === id);
    if (entry === undefined)
      throw new WebError(
        404,
        "artwork_unavailable",
        "Artwork is unavailable for this title.",
      );
    if (plexEnabled) return await this.plexImage(entry, signal);
    if (this.fetchPoster === undefined)
      throw new WebError(
        404,
        "artwork_unavailable",
        "Artwork is unavailable for this title.",
      );
    const title = entry.series ?? entry.title;
    const key = title.toLowerCase() + "|" + String(entry.year ?? "");
    let pending = this.pending.get(key);
    if (pending === undefined) {
      if (this.pending.size >= 1000) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) this.pending.delete(oldest);
      }
      pending = this.fetchPoster(title, entry.year ?? null);
      this.pending.set(key, pending);
    }
    const poster = await pending;
    if (poster === null)
      throw new WebError(
        404,
        "artwork_unavailable",
        "Artwork is unavailable for this title.",
      );
    if (!isRemoteArtworkUrl(poster.posterUrl))
      throw new Error("Poster metadata returned an unsupported artwork URL");
    return Response.redirect(poster.posterUrl, 302);
  }

  private async plexImage(
    entry: LibraryEntry,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (this.plex === undefined)
      throw new Error("Plex posters are enabled without Plex bootstrap");
    let image;
    try {
      image = await this.plex.image(entry.path, signal);
    } catch (error) {
      if (error instanceof PlexArtworkUnavailableError)
        throw new WebError(502, "artwork_unavailable", error.message);
      throw error;
    }
    if (image === null)
      throw new WebError(
        404,
        "artwork_unavailable",
        "Artwork is unavailable for this title.",
      );
    return new Response(image.bytes, {
      headers: {
        "content-type": image.contentType,
        "cache-control": "private, max-age=300",
        vary: "Cookie",
      },
    });
  }

  private id(path: string): string {
    return createHmac("sha256", this.key).update(path).digest("hex");
  }
}
