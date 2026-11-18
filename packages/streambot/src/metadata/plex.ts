import {
  indexCatalogItem,
  PageSchema,
  resolvePlexPosterUrl,
  SectionsSchema,
  type PlexCatalogIndex,
  type PlexItemMetadata,
  type PlexSectionType,
} from "@shepherdjerred/streambot/metadata/plex-catalog.ts";

const TTL_MS = 5 * 60_000;
const DEADLINE_MS = 8000;
const PAGE_SIZE = 500;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const EMPTY_METADATA: ReadonlyMap<string, PlexItemMetadata> = new Map();

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

export type LibraryMetadataProvider = {
  readonly metadataForPath: (
    localPath: string,
    signal?: AbortSignal,
  ) => Promise<PlexItemMetadata | null>;
  readonly cachedMetadataForPath: (
    localPath: string,
  ) => PlexItemMetadata | null;
  readonly ensureIndexed: (
    signal?: AbortSignal,
  ) => Promise<ReadonlyMap<string, PlexItemMetadata>>;
};

/** Expected Plex transport errors are cosmetic; invalid metadata remains a loud contract error. */
export class PlexArtworkUnavailableError extends Error {
  constructor() {
    super("Plex artwork is temporarily unavailable.");
  }
}

/** Exact file matching, catalog metadata, and server-side images; credentials never become image URLs. */
export class PlexArtwork
  implements LibraryArtworkProvider, LibraryMetadataProvider
{
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private index: ({ readonly expires: number } & PlexCatalogIndex) | undefined;
  private indexing: Promise<PlexCatalogIndex> | undefined;
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
    const { posters } = await this.catalogIndex();
    const thumb = posters.get(path);
    signal?.throwIfAborted();
    if (thumb === undefined || thumb === null) {
      return null;
    }
    const cached = this.images.get(thumb);
    if (cached !== undefined && cached.expires > this.now()) {
      return cached.image;
    }
    if (cached !== undefined) {
      this.evict(thumb);
    }
    let pending = this.loading.get(thumb);
    if (pending === undefined) {
      pending = this.loadImage(thumb);
      this.loading.set(thumb, pending);
    }
    const image = await pending;
    signal?.throwIfAborted();
    return image;
  }

  cachedMetadataForPath(localPath: string): PlexItemMetadata | null {
    return this.index === undefined || this.index.expires <= this.now()
      ? null
      : (this.index.metadata.get(localPath) ?? null);
  }

  async ensureIndexed(
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, PlexItemMetadata>> {
    signal?.throwIfAborted();
    try {
      const { metadata } = await this.catalogIndex();
      signal?.throwIfAborted();
      return metadata;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof PlexArtworkUnavailableError) {
        return EMPTY_METADATA;
      }
      throw error;
    }
  }

  async metadataForPath(
    localPath: string,
    signal?: AbortSignal,
  ): Promise<PlexItemMetadata | null> {
    const metadata = await this.ensureIndexed(signal);
    return metadata.get(localPath) ?? null;
  }

  private async loadImage(thumb: string): Promise<PlexImage | null> {
    try {
      const image = await this.download(thumb);
      if (image !== null) {
        while (this.cachedBytes + image.bytes.byteLength > MAX_CACHE_BYTES) {
          const oldest = this.images.keys().next().value;
          if (oldest === undefined) {
            throw new Error("Plex image cache accounting is inconsistent");
          }
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
    if (cached === undefined) {
      throw new Error("Missing Plex cache entry");
    }
    this.cachedBytes -= cached.image.bytes.byteLength;
    this.images.delete(thumb);
  }

  private async catalogIndex(): Promise<PlexCatalogIndex> {
    if (this.index !== undefined && this.index.expires > this.now()) {
      return this.index;
    }
    this.indexing ??= this.populateIndex();
    return await this.indexing;
  }

  private async populateIndex(): Promise<PlexCatalogIndex> {
    try {
      const built = await this.readIndex();
      this.index = { expires: this.now() + TTL_MS, ...built };
      return built;
    } finally {
      this.indexing = undefined;
    }
  }

  private async readIndex(): Promise<PlexCatalogIndex> {
    const signal = AbortSignal.timeout(DEADLINE_MS);
    const sections = SectionsSchema.parse(
      await this.json("/library/sections", signal),
    ).MediaContainer;
    if (sections.Directory === undefined && sections.size > 0) {
      throw new Error("Plex omitted nonempty library sections");
    }
    const index: PlexCatalogIndex = {
      posters: new Map<string, string | null>(),
      metadata: new Map<string, PlexItemMetadata>(),
    };
    for (const section of sections.Directory ?? []) {
      if (section.type !== "movie" && section.type !== "show") {
        continue;
      }
      await this.readSection(
        { key: section.key, type: section.type },
        index,
        signal,
      );
    }
    return index;
  }

  private async readSection(
    section: { readonly key: string; readonly type: PlexSectionType },
    index: PlexCatalogIndex,
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
      if (page.size === 0 && offset < total) {
        throw new Error(
          "Plex returned an empty page before the end of its library",
        );
      }
      if (page.Metadata === undefined && page.size > 0) {
        throw new Error("Plex omitted nonempty media metadata");
      }
      for (const item of page.Metadata ?? []) {
        indexCatalogItem({
          item,
          sectionType: section.type,
          baseUrl: this.config.baseUrl,
          index,
        });
      }
    }
  }

  private async json(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.request(
      new URL(path, this.config.baseUrl),
      signal,
    );
    if (!response.ok) {
      throw new PlexArtworkUnavailableError();
    }
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
      if (error instanceof TypeError || signal.aborted) {
        throw new PlexArtworkUnavailableError();
      }
      throw error;
    }
  }

  private async download(thumb: string): Promise<PlexImage | null> {
    const url = new URL("/photo/:/transcode", this.config.baseUrl);
    url.search = new URLSearchParams({
      url: resolvePlexPosterUrl(thumb, this.config.baseUrl).pathname,
      width: "320",
      height: "480",
      minSize: "1",
      upscale: "0",
    }).toString();
    const signal = AbortSignal.timeout(DEADLINE_MS);
    const response = await this.request(url, signal);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new PlexArtworkUnavailableError();
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();
    if (
      contentType === undefined ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType) ||
      response.body === null
    ) {
      throw new Error("Plex returned an invalid poster response");
    }
    const bytes = await readBoundedPosterBytes(response.body, signal);
    return { bytes, contentType };
  }
}

async function readBoundedPosterBytes(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("Plex returned invalid poster bytes");
      }
      size += chunk.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Plex poster exceeded the image size limit");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (signal.aborted || error instanceof TypeError) {
      throw new PlexArtworkUnavailableError();
    }
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
  return bytes;
}
