import type { Database } from "bun:sqlite";
import type {
  DeclaredFeed,
  ManagedCategory,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  applyRetroactiveAutoReadForFeedInDb,
  bumpSubscriptionsEtagInDb,
  ensureCategoryInDb,
  type IdRow,
} from "./store-sql.ts";

const MANAGED_CATEGORY_ORDER: readonly {
  readonly label: ManagedCategory;
  readonly sortOrder: number;
}[] = [
  { label: "Engineering & Infra", sortOrder: 10 },
  { label: "AI", sortOrder: 20 },
  { label: "Essays & Personal Blogs", sortOrder: 30 },
];

const UPSERT_DECLARED_FEED_SQL = `
  INSERT INTO feeds (url, title, category_id, html_url, description, source, hidden, auto_read_json) VALUES (?, ?, ?, ?, ?, 'code', ?, ?)
  ON CONFLICT(url) DO UPDATE SET title = excluded.title, category_id = excluded.category_id, html_url = COALESCE(excluded.html_url, feeds.html_url),
    description = excluded.description, source = 'code', hidden = excluded.hidden, auto_read_json = excluded.auto_read_json
  WHERE feeds.title IS NOT excluded.title OR feeds.category_id IS NOT excluded.category_id OR (excluded.html_url IS NOT NULL AND feeds.html_url IS NOT excluded.html_url)
     OR feeds.description IS NOT excluded.description OR feeds.source IS NOT excluded.source OR feeds.hidden IS NOT excluded.hidden OR feeds.auto_read_json IS NOT excluded.auto_read_json
`;

function ensureCatalogCategoriesInDb(db: Database): {
  readonly managedIds: ReadonlyMap<ManagedCategory, number>;
  readonly uncatId: number;
  readonly changed: boolean;
} {
  const managedIds = new Map<ManagedCategory, number>();
  let changed = false;
  for (const spec of MANAGED_CATEGORY_ORDER) {
    const ensured = ensureCategoryInDb(db, spec.label, 1, spec.sortOrder);
    managedIds.set(spec.label, ensured.id);
    changed = changed || ensured.changed;
  }
  const uncat = ensureCategoryInDb(db, "Uncategorized", 0, 40);
  return { managedIds, uncatId: uncat.id, changed: changed || uncat.changed };
}

function upsertCatalogFeedsInDb(
  db: Database,
  feeds: readonly DeclaredFeed[],
  managedIds: ReadonlyMap<ManagedCategory, number>,
): { readonly declaredUrls: ReadonlySet<string>; readonly changed: boolean } {
  const upsertStmt = db.query(UPSERT_DECLARED_FEED_SQL);
  const feedIdByUrlStmt = db.query<IdRow, [string]>(
    "SELECT id FROM feeds WHERE url = ?",
  );
  const declaredUrls = new Set<string>();
  let changed = false;

  for (const feed of feeds) {
    declaredUrls.add(feed.url);
    const categoryId = managedIds.get(feed.category);
    if (categoryId === undefined) {
      throw new Error(`Unknown managed category: ${feed.category}`);
    }
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
    if (feed.autoRead !== undefined) {
      const feedRow = feedIdByUrlStmt.get(feed.url);
      if (feedRow !== null) {
        applyRetroactiveAutoReadForFeedInDb(db, feedRow.id, feed.autoRead);
      }
    }
  }
  return { declaredUrls, changed };
}

function pruneRemovedCodeFeedsInDb(
  db: Database,
  declaredUrls: ReadonlySet<string>,
): number {
  const existingCode = db
    .query<{ readonly id: number; readonly url: string }, []>(
      "SELECT id, url FROM feeds WHERE source = 'code'",
    )
    .all();
  const delStmt = db.query("DELETE FROM feeds WHERE id = ?");
  let pruned = 0;
  for (const row of existingCode) {
    if (!declaredUrls.has(row.url)) {
      delStmt.run(row.id);
      pruned += 1;
    }
  }
  return pruned;
}

function cleanupObsoleteManagedCategoriesInDb(
  db: Database,
  uncatId: number,
): boolean {
  const activeLabels = MANAGED_CATEGORY_ORDER.map((s) => s.label);
  const placeholders = activeLabels.map(() => "?").join(", ");
  const movedUserFeeds = db
    .query(
      `UPDATE feeds SET category_id = ? WHERE category_id IN (SELECT id FROM categories WHERE managed = 1 AND label NOT IN (${placeholders}))`,
    )
    .run(uncatId, ...activeLabels);
  const deletedObsolete = db
    .query(
      `DELETE FROM categories WHERE managed = 1 AND label NOT IN (${placeholders})`,
    )
    .run(...activeLabels);
  return movedUserFeeds.changes > 0 || deletedObsolete.changes > 0;
}

export function reconcileCatalogInDb(
  db: Database,
  feeds: readonly DeclaredFeed[],
): { readonly upserted: number; readonly pruned: number } {
  return db.transaction(() => {
    const cats = ensureCatalogCategoriesInDb(db);
    const upserts = upsertCatalogFeedsInDb(db, feeds, cats.managedIds);
    const pruned = pruneRemovedCodeFeedsInDb(db, upserts.declaredUrls);
    const cleaned = cleanupObsoleteManagedCategoriesInDb(db, cats.uncatId);
    if (cleaned || cats.changed || upserts.changed || pruned > 0) {
      bumpSubscriptionsEtagInDb(db);
    }
    return { upserted: feeds.length, pruned };
  })();
}
