import type {
  CreateUserFeedBody,
  UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  applyRetroactiveAutoRead,
  bumpSubscriptionsEtag,
  ensureCategory,
  getFeedById,
  getFeedByUrl,
  type Db,
} from "./sql.ts";
import {
  UNCATEGORIZED_LABEL,
  UNCATEGORIZED_SORT_ORDER,
  USER_CATEGORY_SORT_ORDER,
  requireUserFeed,
  validateNewUserFeed,
  validateUserFeedEdit,
} from "@shepherdjerred/feeds/server/store-shared.ts";
import type {
  FeedMutationResult,
  OkMutationResult,
  ReaderSessionInput,
  StoredFeed,
  StoreMutationFailure,
} from "@shepherdjerred/feeds/server/types.ts";

/** Runs `work` in one transaction; every write goes through it. */
export type InTransaction = <T>(work: (tx: Db) => Promise<T>) => Promise<T>;

function readBack(feed: StoredFeed | undefined, action: string): StoredFeed {
  if (feed === undefined) {
    throw new Error(`${action} feed could not be read back`);
  }
  return feed;
}

export async function createUserFeed(
  inTransaction: InTransaction,
  body: CreateUserFeedBody,
): Promise<FeedMutationResult> {
  const valid = validateNewUserFeed(body);
  if ("ok" in valid) {
    return valid;
  }
  return await inTransaction(async (tx) => {
    if ((await getFeedByUrl(tx, body.url)) !== undefined) {
      return {
        ok: false,
        kind: "conflict",
        message: "Feed URL already exists",
      } as const;
    }
    const rawTitle = body.title === undefined ? "" : body.title.trim();
    const category = await ensureCategory(
      tx,
      body.category.trim(),
      false,
      USER_CATEGORY_SORT_ORDER,
    );
    const created = await tx.feed.create({
      data: {
        url: body.url,
        title: rawTitle === "" ? valid.host : rawTitle,
        categoryId: category.id,
        htmlUrl: body.htmlUrl ?? null,
        description: null,
        source: "user",
        hidden: body.hidden,
        autoReadJson:
          body.autoRead === undefined || body.autoRead === null
            ? null
            : JSON.stringify(body.autoRead),
      },
      select: { id: true },
    });
    await bumpSubscriptionsEtag(tx);
    return {
      ok: true,
      feed: readBack(await getFeedById(tx, created.id), "Created"),
    } as const;
  });
}

async function validateUpdate(
  db: Db,
  id: number,
  body: UpdateUserFeedBody,
): Promise<StoredFeed | StoreMutationFailure> {
  const existing = requireUserFeed(await getFeedById(db, id), "modified");
  if ("ok" in existing) {
    return existing;
  }
  const owner =
    body.url === undefined ? undefined : await getFeedByUrl(db, body.url);
  return validateUserFeedEdit({ id, body, urlOwnerId: owner?.id }) ?? existing;
}

export async function updateUserFeed(
  inTransaction: InTransaction,
  id: number,
  body: UpdateUserFeedBody,
): Promise<FeedMutationResult> {
  return await inTransaction(async (tx) => {
    const existing = await validateUpdate(tx, id, body);
    if ("ok" in existing) {
      return existing;
    }
    const category =
      body.category === undefined
        ? { id: existing.categoryId }
        : await ensureCategory(
            tx,
            body.category.trim(),
            false,
            USER_CATEGORY_SORT_ORDER,
          );
    const categoryId = category.id;
    const nextAuto =
      body.autoRead === undefined ? existing.autoRead : body.autoRead;
    await tx.feed.update({
      where: { id },
      data: {
        url: body.url ?? existing.url,
        title: body.title === undefined ? existing.title : body.title.trim(),
        categoryId,
        htmlUrl: body.htmlUrl === undefined ? existing.htmlUrl : body.htmlUrl,
        hidden: body.hidden ?? existing.hidden,
        autoReadJson: nextAuto === null ? null : JSON.stringify(nextAuto),
      },
    });
    if (
      body.autoRead !== undefined &&
      JSON.stringify(body.autoRead) !== JSON.stringify(existing.autoRead)
    ) {
      await applyRetroactiveAutoRead(tx, id, nextAuto);
    }
    await bumpSubscriptionsEtag(tx);
    return {
      ok: true,
      feed: readBack(await getFeedById(tx, id), "Updated"),
    } as const;
  });
}

export async function deleteUserFeed(
  inTransaction: InTransaction,
  id: number,
): Promise<OkMutationResult> {
  return await inTransaction(async (tx) => {
    const existing = requireUserFeed(await getFeedById(tx, id), "deleted");
    if ("ok" in existing) {
      return existing;
    }
    await tx.feed.delete({ where: { id } });
    await bumpSubscriptionsEtag(tx);
    return { ok: true } as const;
  });
}

async function requireUserCategory(
  db: Db,
  label: string,
  action: string,
): Promise<{ readonly id: number } | StoreMutationFailure> {
  const existing = await db.category.findUnique({ where: { label } });
  if (existing === null) {
    return { ok: false, kind: "not-found", message: "Category not found" };
  }
  return existing.managed
    ? {
        ok: false,
        kind: "forbidden",
        message: `Managed categories cannot be ${action}`,
      }
    : { id: existing.id };
}

export async function renameUserCategory(
  inTransaction: InTransaction,
  oldLabel: string,
  newLabel: string,
): Promise<OkMutationResult> {
  const from = oldLabel.trim();
  const to = newLabel.trim();
  if (from === "" || to === "") {
    return {
      ok: false,
      kind: "invalid",
      message: "Category name cannot be empty",
    };
  }
  return await inTransaction(async (tx) => {
    const existing = await requireUserCategory(tx, from, "renamed");
    if ("ok" in existing) {
      return existing;
    }
    if (from === to) {
      return { ok: true } as const;
    }
    if ((await tx.category.findUnique({ where: { label: to } })) !== null) {
      return {
        ok: false,
        kind: "conflict",
        message: "Category already exists",
      } as const;
    }
    await tx.category.update({
      where: { id: existing.id },
      data: { label: to },
    });
    await bumpSubscriptionsEtag(tx);
    return { ok: true } as const;
  });
}

export async function deleteUserCategory(
  inTransaction: InTransaction,
  label: string,
): Promise<OkMutationResult> {
  const trimmed = label.trim();
  if (trimmed === UNCATEGORIZED_LABEL) {
    return {
      ok: false,
      kind: "forbidden",
      message: "Uncategorized cannot be deleted",
    };
  }
  return await inTransaction(async (tx) => {
    const existing = await requireUserCategory(tx, trimmed, "deleted");
    if ("ok" in existing) {
      return existing;
    }
    const uncategorized = await ensureCategory(
      tx,
      UNCATEGORIZED_LABEL,
      false,
      UNCATEGORIZED_SORT_ORDER,
    );
    await tx.feed.updateMany({
      where: { categoryId: existing.id },
      data: { categoryId: uncategorized.id },
    });
    await tx.category.delete({ where: { id: existing.id } });
    await bumpSubscriptionsEtag(tx);
    return { ok: true } as const;
  });
}

export async function createReaderSession(
  inTransaction: InTransaction,
  input: ReaderSessionInput,
): Promise<void> {
  await inTransaction(async (tx) => {
    await tx.readerSession.deleteMany({
      where: { expiresAt: { lte: BigInt(input.nowSeconds) } },
    });
    const session = {
      username: input.username,
      createdAt: BigInt(input.nowSeconds),
      expiresAt: BigInt(input.nowSeconds + input.ttlSeconds),
    };
    await tx.readerSession.upsert({
      where: { tokenSha256: input.tokenSha256 },
      create: { tokenSha256: input.tokenSha256, ...session },
      update: session,
    });
  });
}

export async function validateReaderSession(
  db: Db,
  tokenSha256: string,
  nowSeconds: number,
): Promise<{ readonly username: string } | undefined> {
  const row = await db.readerSession.findFirst({
    where: { tokenSha256, expiresAt: { gt: BigInt(nowSeconds) } },
    select: { username: true },
  });
  return row === null ? undefined : { username: row.username };
}
