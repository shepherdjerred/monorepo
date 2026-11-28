import type { Database } from "bun:sqlite";
import type {
  CreateUserFeedBody,
  Enclosure,
  UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  applyRetroactiveAutoReadForFeedInDb,
  bumpSubscriptionsEtagInDb,
  ensureCategoryInDb,
  getFeedByIdFromDb,
  getFeedByUrlFromDb,
  type CategoryRow,
  type IdRow,
} from "./store-sql.ts";
import { validateHttpUrl, validateOptionalAutoRead } from "./store-shared.ts";
import type { StoredFeed, StoreMutationFailure } from "./types.ts";

export function createUserFeedInDb(
  db: Database,
  body: CreateUserFeedBody,
): { readonly ok: true; readonly feed: StoredFeed } | StoreMutationFailure {
  const urlCheck = validateHttpUrl(body.url);
  if ("ok" in urlCheck) {
    return urlCheck;
  }
  if (body.htmlUrl !== undefined) {
    const htmlCheck = validateHttpUrl(body.htmlUrl);
    if ("ok" in htmlCheck) {
      return htmlCheck;
    }
  }
  const ruleErr = validateOptionalAutoRead(body.autoRead);
  if (ruleErr !== null) {
    return ruleErr;
  }
  const categoryLabel = body.category.trim();
  if (categoryLabel === "") {
    return {
      ok: false,
      kind: "invalid",
      message: "Category cannot be empty",
    };
  }
  if (getFeedByUrlFromDb(db, body.url) !== undefined) {
    return {
      ok: false,
      kind: "conflict",
      message: "Feed URL already exists",
    };
  }
  const rawTitle = body.title === undefined ? "" : body.title.trim();
  const title = rawTitle === "" ? urlCheck.host : rawTitle;
  const newId = db.transaction(() => {
    const cat = ensureCategoryInDb(db, categoryLabel, 0, 100);
    const autoJson =
      body.autoRead === undefined || body.autoRead === null
        ? null
        : JSON.stringify(body.autoRead);
    const res = db
      .query(
        "INSERT INTO feeds (url, title, category_id, html_url, description, source, hidden, auto_read_json) VALUES (?, ?, ?, ?, NULL, 'user', ?, ?)",
      )
      .run(
        body.url,
        title,
        cat.id,
        body.htmlUrl ?? null,
        body.hidden ? 1 : 0,
        autoJson,
      );
    bumpSubscriptionsEtagInDb(db);
    return Number(res.lastInsertRowid);
  })();
  const created = getFeedByIdFromDb(db, newId);
  if (created === undefined) {
    throw new Error("Created feed could not be read back");
  }
  return { ok: true, feed: created };
}

export function updateUserFeedInDb(
  db: Database,
  id: number,
  body: UpdateUserFeedBody,
): { readonly ok: true; readonly feed: StoredFeed } | StoreMutationFailure {
  const existing = getFeedByIdFromDb(db, id);
  if (existing === undefined) {
    return { ok: false, kind: "not-found", message: "Feed not found" };
  }
  if (existing.source !== "user") {
    return {
      ok: false,
      kind: "forbidden",
      message: "Code-managed feeds cannot be modified",
    };
  }
  if (body.url !== undefined) {
    const check = validateHttpUrl(body.url);
    if ("ok" in check) {
      return check;
    }
    const conflict = getFeedByUrlFromDb(db, body.url);
    if (conflict !== undefined && conflict.id !== id) {
      return {
        ok: false,
        kind: "conflict",
        message: "Feed URL already exists",
      };
    }
  }
  if (body.htmlUrl !== undefined && body.htmlUrl !== null) {
    const check = validateHttpUrl(body.htmlUrl);
    if ("ok" in check) {
      return check;
    }
  }
  const ruleErr = validateOptionalAutoRead(body.autoRead);
  if (ruleErr !== null) {
    return ruleErr;
  }
  db.transaction(() => {
    const categoryId =
      body.category === undefined
        ? existing.categoryId
        : ensureCategoryInDb(db, body.category.trim(), 0, 100).id;
    const nextHtmlUrl =
      body.htmlUrl === undefined ? existing.htmlUrl : body.htmlUrl;
    const nextAuto =
      body.autoRead === undefined ? existing.autoRead : body.autoRead;
    const nextTitle =
      body.title === undefined ? existing.title : body.title.trim();
    db.query(
      "UPDATE feeds SET url = ?, title = ?, category_id = ?, html_url = ?, hidden = ?, auto_read_json = ? WHERE id = ?",
    ).run(
      body.url ?? existing.url,
      nextTitle,
      categoryId,
      nextHtmlUrl,
      (body.hidden ?? existing.hidden) ? 1 : 0,
      nextAuto === null ? null : JSON.stringify(nextAuto),
      id,
    );
    if (
      body.autoRead !== undefined &&
      JSON.stringify(body.autoRead) !== JSON.stringify(existing.autoRead)
    ) {
      applyRetroactiveAutoReadForFeedInDb(db, id, nextAuto);
    }
    bumpSubscriptionsEtagInDb(db);
  })();
  const updated = getFeedByIdFromDb(db, id);
  if (updated === undefined) {
    throw new Error("Updated feed could not be read back");
  }
  return { ok: true, feed: updated };
}

export function deleteUserFeedInDb(
  db: Database,
  id: number,
): { readonly ok: true } | StoreMutationFailure {
  const existing = getFeedByIdFromDb(db, id);
  if (existing === undefined) {
    return { ok: false, kind: "not-found", message: "Feed not found" };
  }
  if (existing.source !== "user") {
    return {
      ok: false,
      kind: "forbidden",
      message: "Code-managed feeds cannot be deleted",
    };
  }
  db.transaction(() => {
    db.query("DELETE FROM feeds WHERE id = ?").run(id);
    bumpSubscriptionsEtagInDb(db);
  })();
  return { ok: true };
}

function requireUserCategory(
  db: Database,
  label: string,
  action: string,
): CategoryRow | StoreMutationFailure {
  const existing = db
    .query<CategoryRow, [string]>(
      "SELECT id, label, managed, sort_order FROM categories WHERE label = ?",
    )
    .get(label);
  if (existing === null) {
    return { ok: false, kind: "not-found", message: "Category not found" };
  }
  return existing.managed === 0
    ? existing
    : {
        ok: false,
        kind: "forbidden",
        message: `Managed categories cannot be ${action}`,
      };
}

export function renameUserCategoryInDb(
  db: Database,
  oldLabel: string,
  newLabel: string,
): { readonly ok: true } | StoreMutationFailure {
  const from = oldLabel.trim();
  const to = newLabel.trim();
  if (from === "" || to === "") {
    return {
      ok: false,
      kind: "invalid",
      message: "Category name cannot be empty",
    };
  }
  const existing = requireUserCategory(db, from, "renamed");
  if ("ok" in existing) {
    return existing;
  }
  if (from === to) {
    return { ok: true };
  }
  if (
    db
      .query<IdRow, [string]>("SELECT id FROM categories WHERE label = ?")
      .get(to) !== null
  ) {
    return {
      ok: false,
      kind: "conflict",
      message: "Category already exists",
    };
  }
  db.transaction(() => {
    db.query("UPDATE categories SET label = ? WHERE id = ?").run(
      to,
      existing.id,
    );
    bumpSubscriptionsEtagInDb(db);
  })();
  return { ok: true };
}

export function deleteUserCategoryInDb(
  db: Database,
  label: string,
): { readonly ok: true } | StoreMutationFailure {
  const trimmed = label.trim();
  if (trimmed === "Uncategorized") {
    return {
      ok: false,
      kind: "forbidden",
      message: "Uncategorized cannot be deleted",
    };
  }
  const existing = requireUserCategory(db, trimmed, "deleted");
  if ("ok" in existing) {
    return existing;
  }
  db.transaction(() => {
    const uncat = ensureCategoryInDb(db, "Uncategorized", 0, 40);
    db.query("UPDATE feeds SET category_id = ? WHERE category_id = ?").run(
      uncat.id,
      existing.id,
    );
    db.query("DELETE FROM categories WHERE id = ?").run(existing.id);
    bumpSubscriptionsEtagInDb(db);
  })();
  return { ok: true };
}

export function upsertImportedUserFeedInDb(
  db: Database,
  input: {
    readonly url: string;
    readonly title: string;
    readonly category: string;
    readonly htmlUrl: string | null;
    readonly description: string | null;
    readonly hidden: boolean;
  },
): StoredFeed {
  const existing = getFeedByUrlFromDb(db, input.url);
  if (existing?.source === "code") {
    return existing;
  }
  db.transaction(() => {
    const cat = ensureCategoryInDb(
      db,
      input.category.trim() || "Uncategorized",
      0,
      100,
    );
    db.query(
      `INSERT INTO feeds (url, title, category_id, html_url, description, source, hidden) VALUES (?, ?, ?, ?, ?, 'user', ?) ON CONFLICT(url) DO UPDATE SET title = excluded.title, category_id = excluded.category_id, html_url = excluded.html_url, description = excluded.description, hidden = excluded.hidden WHERE feeds.source = 'user'`,
    ).run(
      input.url,
      input.title,
      cat.id,
      input.htmlUrl,
      input.description,
      input.hidden ? 1 : 0,
    );
    bumpSubscriptionsEtagInDb(db);
  })();
  const stored = getFeedByUrlFromDb(db, input.url);
  if (stored === undefined) {
    throw new Error("Imported user feed could not be read back");
  }
  return stored;
}

export function createReaderSessionInDb(
  db: Database,
  input: {
    readonly tokenSha256: string;
    readonly username: string;
    readonly nowSeconds: number;
    readonly ttlSeconds: number;
  },
): void {
  db.query("DELETE FROM reader_sessions WHERE expires_at <= ?").run(
    input.nowSeconds,
  );
  db.query(
    "INSERT OR REPLACE INTO reader_sessions (token_sha256, username, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(
    input.tokenSha256,
    input.username,
    input.nowSeconds,
    input.nowSeconds + input.ttlSeconds,
  );
}

export function validateReaderSessionInDb(
  db: Database,
  tokenSha256: string,
  nowSeconds: number,
): { readonly username: string } | undefined {
  const row = db
    .query<{ readonly username: string }, [string, number]>(
      "SELECT username FROM reader_sessions WHERE token_sha256 = ? AND expires_at > ?",
    )
    .get(tokenSha256, nowSeconds);
  return row === null ? undefined : { username: row.username };
}

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

export function upsertRawEntryInDb(
  db: Database,
  entry: RawImportedEntry,
  allocateId: (nowMs: number) => number,
): number {
  if (!Number.isSafeInteger(entry.id) || entry.id <= 0) {
    throw new Error(`Invalid imported entry id: ${String(entry.id)}`);
  }
  const encJson = JSON.stringify(entry.enclosures);
  const existingGuid = db
    .query<IdRow, [number, string]>(
      "SELECT id FROM entries WHERE feed_id = ? AND guid = ?",
    )
    .get(entry.feedId, entry.guid);
  if (existingGuid !== null) {
    db.query(
      "UPDATE entries SET url = ?, title = ?, author = ?, content_html = ?, enclosures_json = ?, is_read = ?, is_starred = ? WHERE id = ?",
    ).run(
      entry.url,
      entry.title,
      entry.author,
      entry.contentHtml,
      encJson,
      entry.isRead ? 1 : 0,
      entry.isStarred ? 1 : 0,
      existingGuid.id,
    );
    return Math.max(existingGuid.id, entry.id);
  }
  const collided = db
    .query<IdRow, [number]>("SELECT id FROM entries WHERE id = ?")
    .get(entry.id);
  const targetId = collided === null ? entry.id : allocateId(entry.crawledAtMs);
  db.query(
    "INSERT INTO entries (id, feed_id, guid, url, title, author, content_html, published_at, crawled_at_ms, enclosures_json, is_read, is_starred, auto_read_matched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
  ).run(
    targetId,
    entry.feedId,
    entry.guid,
    entry.url,
    entry.title,
    entry.author,
    entry.contentHtml,
    entry.publishedAt,
    entry.crawledAtMs,
    encJson,
    entry.isRead ? 1 : 0,
    entry.isStarred ? 1 : 0,
  );
  return targetId;
}
