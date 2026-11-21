import { MediaError } from "#application/errors.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { TmdbImage, TmdbImageClient } from "#integrations/tmdb-images.ts";
import {
  artworkContentType,
  type ArtworkContentType,
  type ArtworkSize,
} from "#shared/artwork/proxy.ts";
import type { ArtworkDiskCache } from "./cache.ts";
import type { ArtworkTelemetry } from "./telemetry.ts";

/** Upstream fetches in flight at once, across every key. */
const UPSTREAM_CONCURRENCY = 6;
/** Fetches allowed to wait for a slot before new ones are refused. */
const UPSTREAM_QUEUE = 256;
const MISSING_LIFETIME_MS = 10 * 60 * 1000;
const MISSING_ENTRIES = 1024;

type Artwork = {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: ArtworkContentType;
};

function unavailable(): MediaError {
  return new MediaError(
    "artwork_unavailable",
    "Artwork could not be fetched; try again later",
    502,
  );
}

function notFound(): MediaError {
  return new MediaError("artwork_not_found", "Artwork does not exist", 404);
}

/**
 * Serves artwork from the disk cache and fills it from TMDB on a miss.
 *
 * A cached file is served whatever state TMDB is in. On a miss, concurrent
 * requests for one key share a single upstream fetch, and fetches for
 * different keys share a small pool. An upstream 404 is remembered in memory
 * for ten minutes; the memory is bounded and expires when it is next read.
 */
export class ArtworkProxy {
  private readonly flights = new Map<string, Promise<Artwork>>();
  private readonly missing = new Map<string, number>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;

  constructor(
    private readonly cache: ArtworkDiskCache,
    private readonly upstream: Pick<TmdbImageClient, "image">,
    private readonly telemetry: ArtworkTelemetry,
    private readonly now: () => number = Date.now,
  ) {}

  metrics(): string {
    return this.telemetry.render(this.cache.stored());
  }

  async read(size: ArtworkSize, file: string): Promise<Artwork> {
    const key = `${size}/${file}`;
    const cached = await this.cache.read(size, file);
    if (cached !== null) {
      this.telemetry.request("hit");
      return { bytes: cached, contentType: artworkContentType(file) };
    }
    try {
      const artwork = await this.fetchOnce(key, size, file);
      this.telemetry.request("miss");
      return artwork;
    } catch (error) {
      this.telemetry.request(
        error instanceof MediaError
          ? error.status === 404
            ? "not_found"
            : "unavailable"
          : "error",
      );
      throw error;
    }
  }

  private async fetchOnce(
    key: string,
    size: ArtworkSize,
    file: string,
  ): Promise<Artwork> {
    const expires = this.missing.get(key);
    if (expires !== undefined) {
      if (expires > this.now()) throw notFound();
      this.missing.delete(key);
    }
    const joined = this.flights.get(key);
    if (joined !== undefined) return await joined;
    const flight = this.fetch(key, size, file);
    this.flights.set(key, flight);
    try {
      return await flight;
    } finally {
      this.flights.delete(key);
    }
  }

  private async fetch(
    key: string,
    size: ArtworkSize,
    file: string,
  ): Promise<Artwork> {
    await this.acquire(key);
    let image: TmdbImage;
    try {
      image = await this.upstream.image(size, file);
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      this.telemetry.upstreamFailed(key, error.kind, error.status);
      throw unavailable();
    } finally {
      this.release();
    }
    this.telemetry.upstreamOutcome(image.status);
    if (image.status === "missing") {
      // Every entry has the same lifetime, so the first is the oldest.
      for (const oldest of this.missing.keys()) {
        if (this.missing.size < MISSING_ENTRIES) break;
        this.missing.delete(oldest);
      }
      this.missing.set(key, this.now() + MISSING_LIFETIME_MS);
      throw notFound();
    }
    await this.cache.write(size, file, image.bytes);
    return { bytes: image.bytes, contentType: image.contentType };
  }

  private async acquire(key: string): Promise<void> {
    if (this.active < UPSTREAM_CONCURRENCY) {
      this.active += 1;
      return;
    }
    if (this.waiting.length >= UPSTREAM_QUEUE) {
      this.telemetry.saturated(key);
      throw unavailable();
    }
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /** Hands the slot to the longest waiter, or frees it. */
  private release(): void {
    const next = this.waiting.shift();
    if (next === undefined) this.active -= 1;
    else next();
  }
}
