import { Database } from "bun:sqlite";
import { DECLARED_FEEDS } from "@shepherdjerred/feeds/catalog/catalog.ts";
import type {
  CategorySummary,
  CreateUserFeedBody,
  DeclaredFeed,
  Enclosure,
  EntriesResponse,
  FeedSource,
  FeedsListResponse,
  MarkAllReadBody,
  SummaryResponse,
  UpdateEntriesStateBody,
  UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";
import { matchesAutoReadRule } from "./auto-read.ts";
import {
  createReaderSessionInDb,
  createUserFeedInDb,
  deleteUserCategoryInDb,
  deleteUserFeedInDb,
  renameUserCategoryInDb,
  updateUserFeedInDb,
  upsertImportedUserFeedInDb,
  upsertRawEntryInDb,
  validateReaderSessionInDb,
} from "./store-mutations.ts";
import {
  editEntryTagsInDb,
  getEntriesByIdsFromDb,
  listAllCategoriesFromDb,
  listAllFeedsFromDb,
  markAllReadInDb,
  queryCategoriesFromDb,
  queryConsoleEntriesFromDb,
  queryFeedsHealthFromDb,
  queryReaderStreamIdsFromDb,
  querySummaryFromDb,
} from "./store-queries.ts";
import {
  bumpSubscriptionsEtagInDb,
  ensureCategoryInDb,
  FEED_SELECT_SQL,
  getFeedByIdFromDb,
  getFeedByUrlFromDb,
  mapFeedRow,
  SCHEMA_SQL,
  subscriptionsEtagFromDb,
  type FeedRow,
  type IdRow,
} from "./store-sql.ts";
import type {
  ConsoleEntriesQuery,
  FeedsRepository,
  ParsedFeedEntry,
  ReaderStreamIdsPage,
  ReaderStreamQuery,
  StoredCategory,
  StoredEntry,
  StoredFeed,
  StoreMutationFailure,
} from "./types.ts";

export type RawImportedEntry = {
  readonly id: number;
  readonly feedId: number;
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly contentHtml: string;
  readonly publishedAt: number;
  readonly crawledAtMs: number;
  readonly enclosures: readonly Enclosure[];
  readonly isRead: boolean;
  readonly isStarred: boolean;
};

export class FeedsStore implements FeedsRepository {
  #lastEntryId: number;

  private constructor(private readonly db: Database) {
    const row = this.db
      .query<{ readonly max_id: number }, []>(
        "SELECT COALESCE(MAX(id), 0) AS max_id FROM entries",
      )
      .get();
    this.#lastEntryId = row?.max_id ?? 0;
  }

  static open(path: string): FeedsStore {
    const db = new Database(path);
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") {
      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA synchronous = NORMAL");
    }
    db.run(SCHEMA_SQL);
    return new FeedsStore(db);
  }

  close(): void {
    this.db.close();
  }

  #allocateEntryId(nowMs: number = Date.now()): number {
    const next = Math.max(this.#lastEntryId + 1, nowMs * 1000);
    if (!Number.isSafeInteger(next) || next <= 0) {
      throw new Error(`Allocated entry id out of safe range: ${String(next)}`);
    }
    this.#lastEntryId = next;
    return next;
  }

  reconcileCatalog(feeds: readonly DeclaredFeed[] = DECLARED_FEEDS): {
    readonly upserted: number;
    readonly pruned: number;
  } {
    const upsertStmt = this.db.query(`
      INSERT INTO feeds (url, title, category_id, html_url, description, source, hidden, auto_read_json) VALUES (?, ?, ?, ?, ?, 'code', ?, ?)
      ON CONFLICT(url) DO UPDATE SET title = excluded.title, category_id = excluded.category_id, html_url = COALESCE(excluded.html_url, feeds.html_url),
        description = excluded.description, source = 'code', hidden = excluded.hidden, auto_read_json = excluded.auto_read_json
      WHERE feeds.title IS NOT excluded.title OR feeds.category_id IS NOT excluded.category_id OR (excluded.html_url IS NOT NULL AND feeds.html_url IS NOT excluded.html_url)
         OR feeds.description IS NOT excluded.description OR feeds.source IS NOT excluded.source OR feeds.hidden IS NOT excluded.hidden OR feeds.auto_read_json IS NOT excluded.auto_read_json
    `);
    return this.db.transaction(() => {
      const repoCat = ensureCategoryInDb(this.db, "Repo Stack", 1, 10);
      const blogsCat = ensureCategoryInDb(this.db, "Blogs", 1, 20);
      const uncat = ensureCategoryInDb(this.db, "Uncategorized", 0, 30);
      let changed = repoCat.changed || blogsCat.changed || uncat.changed;
      const declaredUrls = new Set<string>();
      for (const feed of feeds) {
        declaredUrls.add(feed.url);
        const categoryId =
          feed.category === "Repo Stack" ? repoCat.id : blogsCat.id;
        const autoJson =
          feed.autoRead === undefined ? null : JSON.stringify(feed.autoRead);
        const res = upsertStmt.run(
          feed.url,
          feed.title,
          categoryId,
          feed.htmlUrl ?? null,
          feed.description ?? null,
          feed.hidden === true ? 1 : 0,
          autoJson,
        );
        changed = changed || res.changes > 0;
      }
      const existingCode = this.db
        .query<{ readonly id: number; readonly url: string }, []>(
          "SELECT id, url FROM feeds WHERE source = 'code'",
        )
        .all();
      const delStmt = this.db.query("DELETE FROM feeds WHERE id = ?");
      let pruned = 0;
      for (const row of existingCode) {
        if (!declaredUrls.has(row.url)) {
          delStmt.run(row.id);
          pruned += 1;
        }
      }
      if (changed || pruned > 0) {
        bumpSubscriptionsEtagInDb(this.db);
      }
      return { upserted: feeds.length, pruned };
    })();
  }

  pruneOldEntries(options?: {
    readonly maxReadPerFeed?: number | undefined;
    readonly minAgeSeconds?: number | undefined;
    readonly nowSeconds?: number | undefined;
  }): number {
    const maxRead = options?.maxReadPerFeed ?? 500;
    const minAge = options?.minAgeSeconds ?? 120 * 24 * 60 * 60;
    const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    return this.db
      .query(
        `DELETE FROM entries WHERE id IN (SELECT id FROM (SELECT id, published_at, ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY published_at DESC, id DESC) AS rn FROM entries WHERE is_read = 1 AND is_starred = 0) WHERE rn > ? AND published_at < ?)`,
      )
      .run(maxRead, now - minAge).changes;
  }

  listFeedsForPoll(nowSeconds: number): readonly StoredFeed[] {
    return this.db
      .query<FeedRow, [number]>(
        `${FEED_SELECT_SQL} WHERE f.next_poll_after IS NULL OR f.next_poll_after <= ? ORDER BY COALESCE(f.last_polled_at, 0) ASC, f.id ASC`,
      )
      .all(nowSeconds)
      .map((row) => mapFeedRow(row));
  }

  getFeedById(id: number): StoredFeed | undefined {
    return getFeedByIdFromDb(this.db, id);
  }

  getFeedByUrl(url: string): StoredFeed | undefined {
    return getFeedByUrlFromDb(this.db, url);
  }

  recordPollNotModified(input: {
    readonly feedId: number;
    readonly polledAtSeconds: number;
    readonly etag?: string | null | undefined;
    readonly lastModified?: string | null | undefined;
  }): void {
    this.db
      .query(
        "UPDATE feeds SET last_polled_at = ?, last_success_at = ?, last_status = 304, last_error = NULL, consecutive_failures = 0, next_poll_after = NULL, etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified) WHERE id = ?",
      )
      .run(
        input.polledAtSeconds,
        input.polledAtSeconds,
        input.etag ?? null,
        input.lastModified ?? null,
        input.feedId,
      );
  }

  recordPollSuccess(input: {
    readonly feedId: number;
    readonly polledAtSeconds: number;
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly discoveredHtmlUrl?: string | null | undefined;
    readonly entries: readonly ParsedFeedEntry[];
  }): { readonly inserted: number; readonly autoRead: number } {
    const findExisting = this.db.query<IdRow, [number, string]>(
      "SELECT id FROM entries WHERE feed_id = ? AND guid = ?",
    );
    const insertEntry = this.db.query(
      "INSERT INTO entries (id, feed_id, guid, url, title, author, content_html, published_at, crawled_at_ms, enclosures_json, is_read, is_starred, auto_read_matched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
    );
    const updateEntry = this.db.query(
      "UPDATE entries SET title = ?, url = ?, author = ?, content_html = ?, enclosures_json = ? WHERE id = ?",
    );
    return this.db.transaction(() => {
      const feed = this.getFeedById(input.feedId);
      if (feed === undefined) {
        throw new Error(`Unknown feed id: ${String(input.feedId)}`);
      }
      const crawledAtMs = input.polledAtSeconds * 1000;
      let inserted = 0;
      let autoRead = 0;
      for (const entry of input.entries) {
        const encJson = JSON.stringify(entry.enclosures);
        const existing = findExisting.get(input.feedId, entry.guid);
        if (existing !== null) {
          updateEntry.run(
            entry.title,
            entry.url,
            entry.author,
            entry.contentHtml,
            encJson,
            existing.id,
          );
          continue;
        }
        const matched = matchesAutoReadRule(feed.autoRead, entry);
        insertEntry.run(
          this.#allocateEntryId(crawledAtMs),
          input.feedId,
          entry.guid,
          entry.url,
          entry.title,
          entry.author,
          entry.contentHtml,
          entry.publishedAt,
          crawledAtMs,
          encJson,
          matched ? 1 : 0,
          matched ? 1 : 0,
        );
        inserted += 1;
        if (matched) {
          autoRead += 1;
        }
      }
      const discovered = input.discoveredHtmlUrl ?? "";
      const nextHtmlUrl =
        discovered !== "" && feed.htmlUrl === null ? discovered : feed.htmlUrl;
      this.db
        .query(
          "UPDATE feeds SET html_url = ?, etag = ?, last_modified = ?, last_polled_at = ?, last_success_at = ?, last_status = 200, last_error = NULL, consecutive_failures = 0, next_poll_after = NULL WHERE id = ?",
        )
        .run(
          nextHtmlUrl,
          input.etag,
          input.lastModified,
          input.polledAtSeconds,
          input.polledAtSeconds,
          input.feedId,
        );
      return { inserted, autoRead };
    })();
  }

  recordPollFailure(input: {
    readonly feedId: number;
    readonly polledAtSeconds: number;
    readonly status: number | null;
    readonly errorMessage: string;
    readonly nextPollAfterSeconds: number;
  }): void {
    this.db
      .query(
        "UPDATE feeds SET last_polled_at = ?, last_status = ?, last_error = ?, consecutive_failures = consecutive_failures + 1, next_poll_after = ? WHERE id = ?",
      )
      .run(
        input.polledAtSeconds,
        input.status,
        input.errorMessage,
        input.nextPollAfterSeconds,
        input.feedId,
      );
  }

  summary(): SummaryResponse {
    return querySummaryFromDb(this.db);
  }

  listCategories(): readonly CategorySummary[] {
    return queryCategoriesFromDb(this.db);
  }

  listFeedsHealth(
    redactUrl: (url: string, source: FeedSource) => string,
  ): FeedsListResponse {
    return queryFeedsHealthFromDb(this.db, redactUrl);
  }

  queryEntries(query: ConsoleEntriesQuery): EntriesResponse {
    return queryConsoleEntriesFromDb(this.db, query);
  }

  updateEntriesState(body: UpdateEntriesStateBody): number {
    return editEntryTagsInDb(this.db, {
      ids: body.ids,
      markRead: body.isRead,
      markStarred: body.isStarred,
    });
  }

  markAllRead(body: MarkAllReadBody): number {
    return markAllReadInDb(this.db, body);
  }

  createUserFeed(
    body: CreateUserFeedBody,
  ): { readonly ok: true; readonly feed: StoredFeed } | StoreMutationFailure {
    return createUserFeedInDb(this.db, body);
  }

  updateUserFeed(
    id: number,
    body: UpdateUserFeedBody,
  ): { readonly ok: true; readonly feed: StoredFeed } | StoreMutationFailure {
    return updateUserFeedInDb(this.db, id, body);
  }

  deleteUserFeed(id: number): { readonly ok: true } | StoreMutationFailure {
    return deleteUserFeedInDb(this.db, id);
  }

  createReaderSession(input: {
    readonly tokenSha256: string;
    readonly username: string;
    readonly nowSeconds: number;
    readonly ttlSeconds: number;
  }): void {
    createReaderSessionInDb(this.db, input);
  }

  validateReaderSession(
    tokenSha256: string,
    nowSeconds: number,
  ): { readonly username: string } | undefined {
    return validateReaderSessionInDb(this.db, tokenSha256, nowSeconds);
  }

  subscriptionsEtag(): string {
    return subscriptionsEtagFromDb(this.db);
  }

  listAllFeeds(): readonly StoredFeed[] {
    return listAllFeedsFromDb(this.db);
  }

  listAllCategories(): readonly StoredCategory[] {
    return listAllCategoriesFromDb(this.db);
  }

  queryReaderStreamIds(query: ReaderStreamQuery): ReaderStreamIdsPage {
    return queryReaderStreamIdsFromDb(this.db, query);
  }

  getEntriesByIds(ids: readonly number[]): readonly StoredEntry[] {
    return getEntriesByIdsFromDb(this.db, ids);
  }

  editEntryTags(input: {
    readonly ids: readonly number[];
    readonly markRead?: boolean | undefined;
    readonly markStarred?: boolean | undefined;
  }): number {
    return editEntryTagsInDb(this.db, input);
  }

  renameUserCategory(
    oldLabel: string,
    newLabel: string,
  ): { readonly ok: true } | StoreMutationFailure {
    return renameUserCategoryInDb(this.db, oldLabel, newLabel);
  }

  deleteUserCategory(
    label: string,
  ): { readonly ok: true } | StoreMutationFailure {
    return deleteUserCategoryInDb(this.db, label);
  }

  upsertImportedUserFeed(input: {
    readonly url: string;
    readonly title: string;
    readonly category: string;
    readonly htmlUrl: string | null;
    readonly description: string | null;
    readonly hidden: boolean;
  }): StoredFeed {
    return upsertImportedUserFeedInDb(this.db, input);
  }

  importRawEntry(entry: RawImportedEntry): void {
    this.importRawEntries([entry]);
  }

  importRawEntries(entries: readonly RawImportedEntry[]): void {
    this.db.transaction(() => {
      for (const entry of entries) {
        const high = upsertRawEntryInDb(this.db, entry, (ms) =>
          this.#allocateEntryId(ms),
        );
        this.#lastEntryId = Math.max(this.#lastEntryId, high);
      }
    })();
  }
}
