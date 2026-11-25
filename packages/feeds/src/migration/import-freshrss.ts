import { Database } from "bun:sqlite";
import { z } from "zod";
import {
  FeedsStore,
  type RawImportedEntry,
} from "@shepherdjerred/feeds/server/store.ts";
import type { Enclosure } from "@shepherdjerred/feeds/shared/contract.ts";

export type ImportSummary = {
  readonly mappedCodeFeeds: number;
  readonly importedUserFeeds: number;
  readonly skippedRetiredFeeds: number;
  readonly importedEntries: number;
  readonly unreadEntries: number;
  readonly starredEntries: number;
};

export const DEFAULT_SKIP_URLS: ReadonlySet<string> = new Set([
  "https://github.com/FreshRSS/FreshRSS/releases.atom",
]);

type FreshRssCategoryRow = {
  readonly id: number;
  readonly name: string;
};

type FreshRssFeedRow = {
  readonly id: number;
  readonly url: string;
  readonly category: number | null;
  readonly name: string | null;
  readonly website: string | null;
  readonly description: string | null;
  readonly priority: number | null;
};

type FreshRssEntryRow = {
  readonly id: number | bigint | string;
  readonly guid: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly content: string | null;
  readonly link: string | null;
  readonly date: number | null;
  readonly lastSeen: number | null;
  readonly is_read: number | null;
  readonly is_favorite: number | null;
  readonly id_feed: number;
  readonly attributes: string | null;
};

const RawEnclosureItemSchema = z.object({
  url: z.string().optional(),
  href: z.string().optional(),
  type: z.string().optional(),
  mime: z.string().optional(),
  length: z.union([z.number(), z.string()]).optional(),
});

const RawAttributesSchema = z.object({
  enclosures: z.array(RawEnclosureItemSchema).optional(),
});

export function normalizeFreshRssAuthor(
  raw: string | null | undefined,
): string {
  return raw === null || raw === undefined || raw === ""
    ? ""
    : raw
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .join(", ");
}

export function parseFreshRssAttributesEnclosures(
  rawAttributes: string | null | undefined,
): readonly Enclosure[] {
  if (
    rawAttributes === null ||
    rawAttributes === undefined ||
    rawAttributes.trim() === ""
  ) {
    return [];
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawAttributes);
  } catch {
    return [];
  }
  const parsed = RawAttributesSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.enclosures === undefined) {
    return [];
  }
  const enclosures: Enclosure[] = [];
  for (const item of parsed.data.enclosures) {
    const href = (item.href ?? item.url ?? "").trim();
    if (href === "") {
      continue;
    }
    const rawType = (item.type ?? item.mime ?? "").trim();
    const numericLength =
      item.length === undefined ? Number.NaN : Number(item.length);
    const validLength =
      Number.isInteger(numericLength) && numericLength >= 0
        ? numericLength
        : undefined;
    enclosures.push({
      href,
      ...(rawType === "" ? {} : { type: rawType }),
      ...(validLength === undefined ? {} : { length: validLength }),
    });
  }
  return enclosures;
}

function toSafeEntryId(raw: number | bigint | string): number {
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new Error(
      `FreshRSS entry id is not a positive safe integer: ${String(raw)}`,
    );
  }
  return num;
}

function cleanOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function fallbackFeedTitle(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "Imported Feed";
  }
}

function loadFreshRssCategories(sourceDb: Database): Map<number, string> {
  const categoriesById = new Map<number, string>();
  const rows = sourceDb
    .query<FreshRssCategoryRow, []>(
      "SELECT id, name FROM category ORDER BY id ASC",
    )
    .all();
  for (const row of rows) {
    const trimmed = row.name.trim();
    if (trimmed !== "") {
      categoriesById.set(row.id, trimmed);
    }
  }
  return categoriesById;
}

function importFreshRssFeeds(options: {
  readonly sourceDb: Database;
  readonly store: FeedsStore;
  readonly categoriesById: ReadonlyMap<number, string>;
  readonly skipUrls: ReadonlySet<string>;
}): {
  readonly feedIdMap: Map<number, number>;
  readonly mappedCodeFeeds: number;
  readonly importedUserFeeds: number;
  readonly skippedRetiredFeeds: number;
} {
  const feedIdMap = new Map<number, number>();
  let mappedCodeFeeds = 0;
  let importedUserFeeds = 0;
  let skippedRetiredFeeds = 0;

  const feedRows = options.sourceDb
    .query<FreshRssFeedRow, []>(
      "SELECT id, url, category, name, website, description, priority FROM feed ORDER BY id ASC",
    )
    .all();

  for (const row of feedRows) {
    const url = row.url.trim();
    if (url === "" || options.skipUrls.has(url)) {
      skippedRetiredFeeds += 1;
      continue;
    }
    const existing = options.store.getFeedByUrl(url);
    if (existing?.source === "code") {
      feedIdMap.set(row.id, existing.id);
      mappedCodeFeeds += 1;
      continue;
    }
    const categoryLabel =
      (row.category === null
        ? undefined
        : options.categoriesById.get(row.category)) ?? "Uncategorized";
    const userFeed = options.store.upsertImportedUserFeed({
      url,
      title: cleanOptionalText(row.name) ?? fallbackFeedTitle(url),
      category: categoryLabel,
      htmlUrl: cleanOptionalText(row.website),
      description: cleanOptionalText(row.description),
      hidden: (row.priority ?? 10) < 10,
    });
    feedIdMap.set(row.id, userFeed.id);
    importedUserFeeds += 1;
  }

  return { feedIdMap, mappedCodeFeeds, importedUserFeeds, skippedRetiredFeeds };
}

function importFreshRssEntries(
  sourceDb: Database,
  store: FeedsStore,
  feedIdMap: ReadonlyMap<number, number>,
): {
  readonly importedEntries: number;
  readonly unreadEntries: number;
  readonly starredEntries: number;
} {
  const entryRows = sourceDb
    .query<FreshRssEntryRow, []>(
      `SELECT id, guid, title, author, content, link, date, lastSeen,
              is_read, is_favorite, id_feed, attributes
       FROM entry ORDER BY id ASC`,
    )
    .all();

  const batch: RawImportedEntry[] = [];
  let unreadEntries = 0;
  let starredEntries = 0;

  for (const row of entryRows) {
    const targetFeedId = feedIdMap.get(row.id_feed);
    if (targetFeedId === undefined) {
      continue;
    }
    const id = toSafeEntryId(row.id);
    const publishedAt =
      row.date !== null && row.date > 0 ? row.date : Math.floor(id / 1_000_000);
    const crawledAtMs =
      row.lastSeen !== null && row.lastSeen > 0
        ? row.lastSeen * 1000
        : Math.floor(id / 1000);
    const isRead = (row.is_read ?? 0) !== 0;
    const isStarred = (row.is_favorite ?? 0) !== 0;

    batch.push({
      id,
      feedId: targetFeedId,
      guid: row.guid,
      url: row.link ?? "",
      title: row.title ?? "",
      author: normalizeFreshRssAuthor(row.author),
      contentHtml: row.content ?? "",
      publishedAt,
      crawledAtMs,
      enclosures: parseFreshRssAttributesEnclosures(row.attributes),
      isRead,
      isStarred,
    });
    if (!isRead) {
      unreadEntries += 1;
    }
    if (isStarred) {
      starredEntries += 1;
    }
  }

  store.importRawEntries(batch);
  return { importedEntries: batch.length, unreadEntries, starredEntries };
}

export function importFromFreshRssSqlite(options: {
  readonly fromPath: string;
  readonly store: FeedsStore;
  readonly skipUrls?: ReadonlySet<string> | undefined;
}): ImportSummary {
  const skipUrls = options.skipUrls ?? DEFAULT_SKIP_URLS;
  if (options.store.listAllFeeds().length === 0) {
    options.store.reconcileCatalog();
  }

  const sourceDb = new Database(options.fromPath, { readonly: true });
  try {
    const categoriesById = loadFreshRssCategories(sourceDb);
    const feedStats = importFreshRssFeeds({
      sourceDb,
      store: options.store,
      categoriesById,
      skipUrls,
    });
    const entryStats = importFreshRssEntries(
      sourceDb,
      options.store,
      feedStats.feedIdMap,
    );

    return {
      mappedCodeFeeds: feedStats.mappedCodeFeeds,
      importedUserFeeds: feedStats.importedUserFeeds,
      skippedRetiredFeeds: feedStats.skippedRetiredFeeds,
      importedEntries: entryStats.importedEntries,
      unreadEntries: entryStats.unreadEntries,
      starredEntries: entryStats.starredEntries,
    };
  } finally {
    sourceDb.close();
  }
}

function parseCliArgs(argv: readonly string[]): {
  readonly fromPath: string;
  readonly toPath: string;
} {
  let fromPath: string | undefined;
  let toPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--from" && next !== undefined) {
      fromPath = next;
      i += 1;
    } else if (arg === "--to" && next !== undefined) {
      toPath = next;
      i += 1;
    }
  }
  if (fromPath === undefined || toPath === undefined) {
    throw new Error(
      "Usage: bun src/migration/import-freshrss.ts --from <freshrss.sqlite> --to <feeds.sqlite>",
    );
  }
  return { fromPath, toPath };
}

if (import.meta.main) {
  const { fromPath, toPath } = parseCliArgs(Bun.argv.slice(2));
  const store = FeedsStore.open(toPath);
  try {
    store.reconcileCatalog();
    const summary = importFromFreshRssSqlite({ fromPath, store });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    store.close();
  }
}
