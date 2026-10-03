import { z } from "zod";

const TTL_MS = 5 * 60_000;
const DEADLINE_MS = 8000;
const PAGE_SIZE = 500;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const ROOTS = [
  { plex: "/data/movies/", local: "/media/movies/" },
  { plex: "/data/tv/", local: "/media/tv/" },
];

const SectionsSchema = z.object({
  MediaContainer: z.object({
    size: z.number().int().nonnegative(),
    Directory: z
      .array(z.object({ key: z.string(), type: z.string() }))
      .optional(),
  }),
});
const PageSchema = z.object({
  MediaContainer: z.object({
    totalSize: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    Metadata: z
      .array(
        z.object({
          thumb: z.string().optional(),
          grandparentThumb: z.string().optional(),
          Media: z
            .array(
              z.object({
                Part: z.array(z.object({ file: z.string() })),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  }),
});
type PlexMetadata = NonNullable<
  z.infer<typeof PageSchema>["MediaContainer"]["Metadata"]
>[number];

export type PlexImage = {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
};
export type LibraryArtworkProvider = {
  readonly image: (
    path: string,
    signal?: AbortSignal,
  ) => Promise<PlexImage | null>;
};

/** Expected Plex transport errors are cosmetic; invalid metadata remains a loud contract error. */
export class PlexArtworkUnavailableError extends Error {
  constructor() {
    super("Plex artwork is temporarily unavailable.");
  }
}

/** Exact file matching and server-side images; credentials never become image URLs. */
export class PlexArtwork implements LibraryArtworkProvider {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private index:
    { expires: number; posters: Map<string, string | null> } | undefined;
  private indexing: Promise<Map<string, string | null>> | undefined;
  private readonly images = new Map<
    string,
    { expires: number; image: PlexImage }
  >();
  private readonly loading = new Map<string, Promise<PlexImage | null>>();
  private cachedBytes = 0;

  constructor(
    private readonly config: {
      readonly baseUrl: string;
      readonly token: string;
    },
    options: { fetch?: typeof fetch; now?: () => number } = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async image(path: string, signal?: AbortSignal): Promise<PlexImage | null> {
    signal?.throwIfAborted();
    const posters = await this.posters();
    const thumb = posters.get(path);
    signal?.throwIfAborted();
    if (thumb === undefined || thumb === null) return null;
    const cached = this.images.get(thumb);
    if (cached !== undefined && cached.expires > this.now())
      return cached.image;
    if (cached !== undefined) this.evict(thumb);
    let pending = this.loading.get(thumb);
    if (pending === undefined) {
      pending = this.loadImage(thumb);
      this.loading.set(thumb, pending);
    }
    const image = await pending;
    signal?.throwIfAborted();
    return image;
  }

  private async loadImage(thumb: string): Promise<PlexImage | null> {
    try {
      const image = await this.download(thumb);
      if (image !== null) {
        while (this.cachedBytes + image.bytes.byteLength > MAX_CACHE_BYTES) {
          const oldest = this.images.keys().next().value;
          if (oldest === undefined)
            throw new Error("Plex image cache accounting is inconsistent");
          this.evict(oldest);
        }
        this.images.set(thumb, { expires: this.now() + TTL_MS, image });
        this.cachedBytes += image.bytes.byteLength;
      }
      return image;
    } finally {
      this.loading.delete(thumb);
    }
  }

  private evict(thumb: string): void {
    const cached = this.images.get(thumb);
    if (cached === undefined) throw new Error("Missing Plex cache entry");
    this.cachedBytes -= cached.image.bytes.byteLength;
    this.images.delete(thumb);
  }

  private async posters(): Promise<Map<string, string | null>> {
    if (this.index !== undefined && this.index.expires > this.now())
      return this.index.posters;
    this.indexing ??= this.populateIndex();
    return await this.indexing;
  }

  private async populateIndex(): Promise<Map<string, string | null>> {
    try {
      const posters = await this.readIndex();
      this.index = { expires: this.now() + TTL_MS, posters };
      return posters;
    } finally {
      this.indexing = undefined;
    }
  }

  private async readIndex(): Promise<Map<string, string | null>> {
    const signal = AbortSignal.timeout(DEADLINE_MS);
    const sections = SectionsSchema.parse(
      await this.json("/library/sections", signal),
    ).MediaContainer;
    if (sections.Directory === undefined && sections.size > 0)
      throw new Error("Plex omitted nonempty library sections");
    const posters = new Map<string, string | null>();
    for (const section of sections.Directory ?? []) {
      if (section.type !== "movie" && section.type !== "show") continue;
      await this.readSection(section, posters, signal);
    }
    return posters;
  }

  private async readSection(
    section: { key: string; type: string },
    posters: Map<string, string | null>,
    signal: AbortSignal,
  ): Promise<void> {
    let total = Infinity;
    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
      const url = new URL(
        "/library/sections/" + encodeURIComponent(section.key) + "/all",
        this.config.baseUrl,
      );
      url.search = new URLSearchParams({
        type: section.type === "movie" ? "1" : "4",
        "X-Plex-Container-Start": String(offset),
        "X-Plex-Container-Size": String(PAGE_SIZE),
      }).toString();
      const page = PageSchema.parse(
        await this.json(url.pathname + url.search, signal),
      ).MediaContainer;
      total = page.totalSize;
      if (page.size === 0 && offset < total)
        throw new Error(
          "Plex returned an empty page before the end of its library",
        );
      if (page.Metadata === undefined && page.size > 0)
        throw new Error("Plex omitted nonempty media metadata");
      for (const item of page.Metadata ?? [])
        this.indexItem(item, section.type, posters);
    }
  }

  private indexItem(
    item: PlexMetadata,
    type: string,
    posters: Map<string, string | null>,
  ): void {
    const thumb =
      (type === "movie" ? item.thumb : item.grandparentThumb) ?? null;
    if (thumb !== null) this.posterUrl(thumb);
    const parts = item.Media?.flatMap((media) => media.Part) ?? [];
    for (const part of parts) {
      const root = ROOTS.find((candidate) =>
        part.file.startsWith(candidate.plex),
      );
      if (root === undefined) continue;
      const local = root.local + part.file.slice(root.plex.length);
      if (posters.has(local) && posters.get(local) !== thumb)
        throw new Error("Plex returned conflicting posters for one media file");
      posters.set(local, thumb);
    }
  }

  private posterUrl(thumb: string): URL {
    const url = new URL(thumb, this.config.baseUrl);
    if (
      !thumb.startsWith("/") ||
      url.origin !== new URL(this.config.baseUrl).origin ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/library\/metadata\/[^/]+\/thumb(?:\/[^/]+)?$/u.test(url.pathname)
    ) {
      throw new Error("Plex returned an unsupported poster path");
    }
    return url;
  }

  private async json(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.request(
      new URL(path, this.config.baseUrl),
      signal,
    );
    if (!response.ok) throw new PlexArtworkUnavailableError();
    return await response.json();
  }

  private async request(url: URL, signal: AbortSignal): Promise<Response> {
    try {
      return await this.fetch(url, {
        headers: {
          "X-Plex-Token": this.config.token,
          Accept: "application/json",
        },
        signal,
        redirect: "manual",
      });
    } catch (error) {
      if (error instanceof TypeError || signal.aborted)
        throw new PlexArtworkUnavailableError();
      throw error;
    }
  }

  private async download(thumb: string): Promise<PlexImage | null> {
    const url = new URL("/photo/:/transcode", this.config.baseUrl);
    url.search = new URLSearchParams({
      url: this.posterUrl(thumb).pathname,
      width: "320",
      height: "480",
      minSize: "1",
      upscale: "0",
    }).toString();
    const signal = AbortSignal.timeout(DEADLINE_MS);
    const response = await this.request(url, signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new PlexArtworkUnavailableError();
    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();
    if (
      contentType === undefined ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType) ||
      response.body === null
    )
      throw new Error("Plex returned an invalid poster response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const chunk: unknown = next.value;
        if (!(chunk instanceof Uint8Array))
          throw new Error("Plex returned invalid poster bytes");
        size += chunk.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error("Plex poster exceeded the image size limit");
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (signal.aborted || error instanceof TypeError)
        throw new PlexArtworkUnavailableError();
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, contentType };
  }
}
