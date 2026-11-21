import {
  CATALOG_MAX_PAGE,
  CatalogFeedSchema,
  type CatalogFeed,
} from "#shared/catalog/contract.ts";

export const CATALOG_FEED_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Discover feeds change slowly and every household member asks for the same
 * pages, so one TMDB answer per feed page serves everyone for six hours.
 *
 * In-process on purpose: Media runs a single API replica, so there is nothing
 * to share a cache with, and a restart only costs one TMDB call per page.
 * Expiry is checked when a page is read; nothing refreshes in the background.
 * Concurrent readers of a missing or expired page share one load, and a failed
 * load is not remembered, so the next reader tries again. Only TMDB's own
 * items are held here; what the household has of each title is read per
 * request, for the actor asking.
 *
 * The map cannot outgrow feeds times pages: both are validated before a key
 * is formed.
 */
export class CatalogFeedCache<Page> {
  private readonly pages = new Map<string, { page: Page; loadedAt: number }>();
  private readonly loading = new Map<string, Promise<Page>>();

  constructor(
    private readonly load: (feed: CatalogFeed, page: number) => Promise<Page>,
    private readonly now: () => number = Date.now,
  ) {}

  async get(feed: CatalogFeed, page: number): Promise<Page> {
    CatalogFeedSchema.parse(feed);
    if (!Number.isInteger(page) || page < 1 || page > CATALOG_MAX_PAGE)
      throw new Error("Catalog feed page is outside the cached range");
    const key = `${feed}:${String(page)}`;
    const held = this.pages.get(key);
    if (held !== undefined) {
      const age = this.now() - held.loadedAt;
      if (age >= 0 && age < CATALOG_FEED_TTL_MS) return held.page;
    }
    const current = this.loading.get(key);
    if (current !== undefined) return current;
    const started = this.refresh(key, feed, page);
    this.loading.set(key, started);
    return started;
  }

  private async refresh(
    key: string,
    feed: CatalogFeed,
    page: number,
  ): Promise<Page> {
    try {
      // Yield first, so the entry this clears is already registered even
      // when the loader throws before returning a promise.
      await Promise.resolve();
      const loaded = await this.load(feed, page);
      this.pages.set(key, { page: loaded, loadedAt: this.now() });
      return loaded;
    } finally {
      this.loading.delete(key);
    }
  }
}
