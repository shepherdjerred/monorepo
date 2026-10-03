import { createHmac, randomBytes } from "node:crypto";
import type {
  PosterFetcher,
  PosterInfo,
} from "@shepherdjerred/streambot/metadata/tmdb.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/web/shared/artwork.ts";
import { WebError } from "./errors.ts";

/** Poster lookup is lazy: browsing and playback never wait for image metadata. */
export class WebArtwork {
  private readonly key = randomBytes(32);
  private readonly pending = new Map<string, Promise<PosterInfo | null>>();

  constructor(
    private readonly library: () => readonly LibraryEntry[],
    private readonly fetchPoster: PosterFetcher | undefined,
  ) {}

  forEntry(entry: LibraryEntry, guildId: string): string | undefined {
    return this.fetchPoster === undefined
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

  async resolve(id: string): Promise<Response> {
    const entry = this.library().find((item) => this.id(item.path) === id);
    if (entry === undefined || this.fetchPoster === undefined)
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

  private id(path: string): string {
    return createHmac("sha256", this.key).update(path).digest("hex");
  }
}
