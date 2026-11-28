import type {
  DeclaredFeed,
  ManagedCategory,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  applyRetroactiveAutoRead,
  bumpSubscriptionsEtag,
  ensureCategory,
  type Db,
} from "./sql.ts";
import {
  MANAGED_CATEGORY_ORDER,
  UNCATEGORIZED_LABEL,
  UNCATEGORIZED_SORT_ORDER,
} from "@shepherdjerred/feeds/server/store-shared.ts";

async function ensureCatalogCategories(db: Db): Promise<{
  readonly managedIds: ReadonlyMap<ManagedCategory, number>;
  readonly uncategorizedId: number;
  readonly changed: boolean;
}> {
  const managedIds = new Map<ManagedCategory, number>();
  let changed = false;
  for (const spec of MANAGED_CATEGORY_ORDER) {
    const ensured = await ensureCategory(db, spec.label, true, spec.sortOrder);
    managedIds.set(spec.label, ensured.id);
    changed = changed || ensured.changed;
  }
  const uncategorized = await ensureCategory(
    db,
    UNCATEGORIZED_LABEL,
    false,
    UNCATEGORIZED_SORT_ORDER,
  );
  return {
    managedIds,
    uncategorizedId: uncategorized.id,
    changed: changed || uncategorized.changed,
  };
}

type DeclaredRow = {
  readonly url: string;
  readonly title: string;
  readonly categoryId: number;
  readonly htmlUrl: string | null;
  readonly description: string | null;
  readonly hidden: boolean;
  readonly autoReadJson: string | null;
};

/**
 * Inserts a declared feed or brings an existing row in line with it, and
 * reports whether anything changed. A declaration without `htmlUrl` keeps
 * the one a poll discovered.
 */
async function upsertDeclaredFeed(
  db: Db,
  priorId: number | undefined,
  row: DeclaredRow,
): Promise<boolean> {
  if (priorId === undefined) {
    await db.feed.create({ data: { ...row, source: "code" } });
    return true;
  }
  const changed = await db.$executeRaw`
    UPDATE feeds SET
      title = ${row.title},
      category_id = ${row.categoryId},
      html_url = COALESCE(${row.htmlUrl}::text, html_url),
      description = ${row.description}::text,
      source = 'code',
      hidden = ${row.hidden},
      auto_read_json = ${row.autoReadJson}::text
    WHERE id = ${priorId} AND (
      title IS DISTINCT FROM ${row.title}
      OR category_id IS DISTINCT FROM ${row.categoryId}
      OR (${row.htmlUrl}::text IS NOT NULL AND html_url IS DISTINCT FROM ${row.htmlUrl}::text)
      OR description IS DISTINCT FROM ${row.description}::text
      OR source IS DISTINCT FROM 'code'
      OR hidden IS DISTINCT FROM ${row.hidden}
      OR auto_read_json IS DISTINCT FROM ${row.autoReadJson}::text
    )`;
  return changed > 0;
}

async function upsertCatalogFeeds(
  db: Db,
  feeds: readonly DeclaredFeed[],
  managedIds: ReadonlyMap<ManagedCategory, number>,
): Promise<boolean> {
  let changed = false;
  for (const feed of feeds) {
    const categoryId = managedIds.get(feed.category);
    if (categoryId === undefined) {
      throw new Error(`Unknown managed category: ${feed.category}`);
    }
    const autoReadJson =
      feed.autoRead === undefined ? null : JSON.stringify(feed.autoRead);
    const prior = await db.feed.findUnique({
      where: { url: feed.url },
      select: { id: true, autoReadJson: true },
    });
    const rowChanged = await upsertDeclaredFeed(db, prior?.id, {
      url: feed.url,
      title: feed.title,
      categoryId,
      htmlUrl: feed.htmlUrl ?? null,
      description: feed.description ?? null,
      hidden: feed.hidden === true,
      autoReadJson,
    });
    changed = changed || rowChanged;
    if (
      (prior?.autoReadJson ?? null) !== autoReadJson &&
      feed.autoRead !== undefined
    ) {
      const created =
        prior ??
        (await db.feed.findUnique({
          where: { url: feed.url },
          select: { id: true },
        }));
      const feedId = created?.id;
      if (feedId !== undefined) {
        await applyRetroactiveAutoRead(db, feedId, feed.autoRead);
      }
    }
  }
  return changed;
}

async function cleanupObsoleteManagedCategories(
  db: Db,
  uncategorizedId: number,
): Promise<boolean> {
  const activeLabels = MANAGED_CATEGORY_ORDER.map((spec) => spec.label);
  const moved = await db.feed.updateMany({
    where: { category: { managed: true, label: { notIn: activeLabels } } },
    data: { categoryId: uncategorizedId },
  });
  const deleted = await db.category.deleteMany({
    where: { managed: true, label: { notIn: activeLabels } },
  });
  return moved.count > 0 || deleted.count > 0;
}

/**
 * The SQLite store's catalog reconcile: managed categories and code feeds
 * follow the catalog, removed code feeds go (with their entries), user feeds
 * stay, and the subscription etag moves only when something changed.
 */
export async function reconcileCatalog(
  db: Db,
  feeds: readonly DeclaredFeed[],
): Promise<{ readonly upserted: number; readonly pruned: number }> {
  const categories = await ensureCatalogCategories(db);
  const upsertsChanged = await upsertCatalogFeeds(
    db,
    feeds,
    categories.managedIds,
  );
  const declaredUrls = feeds.map((feed) => feed.url);
  const pruned = await db.feed.deleteMany({
    where: { source: "code", url: { notIn: declaredUrls } },
  });
  const cleaned = await cleanupObsoleteManagedCategories(
    db,
    categories.uncategorizedId,
  );
  const changed =
    cleaned || categories.changed || upsertsChanged || pruned.count > 0;
  if (changed) {
    await bumpSubscriptionsEtag(db);
  }
  return { upserted: feeds.length, pruned: pruned.count };
}
