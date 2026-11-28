import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  buildOpmlXml,
  extractLabel,
  extractLabels,
  formatEntryItem,
  importOpmlXml,
  issueWriteToken,
  parseItemIds,
  parseStreamTarget,
  resolveFeedFromStream,
  STATE_KEPT_UNREAD_PATTERN,
  STATE_READ_PATTERN,
  STATE_STARRED_PATTERN,
  verifyWriteToken,
} from "./greader-ids.ts";
import type {
  FeedsPoller,
  FeedsRepository,
  StoreMutationFailure,
} from "./types.ts";

export type CreateGoogleReaderRoutesDeps = {
  readonly store: FeedsRepository;
  readonly poller: FeedsPoller;
  readonly readerUser: string;
  readonly readerPassword: string;
  readonly writeTokenSecret: string;
  readonly nowSeconds?: (() => number) | undefined;
};

type ReaderEnv = { Variables: { readerUsername: string } };
type ReaderContext = Context<ReaderEnv>;
type ParamsBag = {
  readonly get: (key: string) => string | undefined;
  readonly getAll: (key: string) => readonly string[];
};

const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const GOOGLE_LOGIN_PATTERN = /^GoogleLogin\s+auth=(\S+)$/iu;
const POSITIVE_INT_PATTERN = /^[1-9]\d*$/u;
const NON_NEGATIVE_INT_PATTERN = /^\d+$/u;

const sha256Buffer = (value: string): Buffer =>
  createHash("sha256").update(value).digest();
const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

async function readParams(c: ReaderContext): Promise<ParamsBag> {
  const queryParams = new URL(c.req.url).searchParams;
  const ct = (c.req.header("content-type") ?? "").toLowerCase();
  const isForm =
    c.req.method === "POST" &&
    !ct.includes("multipart/form-data") &&
    !ct.includes("xml") &&
    !ct.includes("opml");
  const bodyParams = isForm
    ? new URLSearchParams(await c.req.text())
    : new URLSearchParams();
  return {
    get: (key) => bodyParams.get(key) ?? queryParams.get(key) ?? undefined,
    getAll: (key) => [...bodyParams.getAll(key), ...queryParams.getAll(key)],
  };
}

function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) {
    return false;
  }
  const trimmed = header.trim();
  if (trimmed === "*") {
    return true;
  }
  const unquoted = etag.replaceAll(/^"|"$/gu, "");
  return trimmed
    .split(",")
    .map((token) => token.trim().replace(/^W\//u, ""))
    .some((candidate) => candidate === etag || candidate === unquoted);
}

function mapFailureResponse(
  c: ReaderContext,
  failure: StoreMutationFailure,
): Response {
  const statusMap = {
    forbidden: 403,
    "not-found": 404,
    conflict: 409,
    invalid: 400,
  } as const;
  return c.text(failure.message, statusMap[failure.kind]);
}

async function parseImportPayload(
  c: ReaderContext,
): Promise<{ readonly token: string | undefined; readonly xmlText: string }> {
  const queryToken = new URL(c.req.url).searchParams.get("T") ?? undefined;
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const formToken = typeof body["T"] === "string" ? body["T"] : undefined;
    for (const val of Object.values(body)) {
      if (val instanceof File) {
        return { token: formToken ?? queryToken, xmlText: await val.text() };
      }
      if (typeof val === "string" && val.includes("<opml")) {
        return { token: formToken ?? queryToken, xmlText: val };
      }
    }
    return { token: formToken ?? queryToken, xmlText: "" };
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await c.req.text());
    return {
      token: form.get("T") ?? queryToken,
      xmlText: form.get("opml") ?? form.get("xml") ?? "",
    };
  }
  return { token: queryToken, xmlText: await c.req.text() };
}

async function editExistingSubscription(
  c: ReaderContext,
  store: FeedsRepository,
  params: ParamsBag,
): Promise<Response> {
  const feed = await resolveFeedFromStream(store, params.get("s"));
  if (feed === undefined) {
    return c.text("Subscription not found", 404);
  }
  const rawTitle = params.get("t")?.trim();
  const title =
    rawTitle !== undefined && rawTitle.length > 0 ? rawTitle : undefined;
  const addedCategory = extractLabels(params.getAll("a"))[0];
  const nextCategory =
    addedCategory ??
    (extractLabels(params.getAll("r")).includes(feed.categoryLabel)
      ? "Uncategorized"
      : undefined);
  const res = await store.updateUserFeed(feed.id, {
    ...(title === undefined ? {} : { title }),
    ...(nextCategory === undefined ? {} : { category: nextCategory }),
  });
  return res.ok ? c.text("OK") : mapFailureResponse(c, res);
}

async function subscribeNewFeed(
  c: ReaderContext,
  deps: CreateGoogleReaderRoutesDeps,
  params: ParamsBag,
): Promise<Response> {
  const streamId = params.get("s");
  if (streamId?.startsWith("feed/") !== true) {
    return c.text("Invalid feed stream", 400);
  }
  const targetUrl = streamId.slice("feed/".length).trim();
  const existing = await deps.store.getFeedByUrl(targetUrl);
  if (existing?.source === "code") {
    return c.text("Code-owned feeds cannot be modified via Reader API", 403);
  }
  const rawTitle = params.get("t")?.trim();
  const title =
    rawTitle !== undefined && rawTitle.length > 0 ? rawTitle : undefined;
  const addedCategory = extractLabels(params.getAll("a"))[0];
  const res = await deps.poller.discoverAndSubscribe({
    url: targetUrl,
    ...(addedCategory === undefined ? {} : { category: addedCategory }),
    ...(title === undefined ? {} : { titleOverride: title }),
  });
  return res.ok ? c.text("OK") : mapFailureResponse(c, res);
}

async function handleSubscriptionEdit(
  c: ReaderContext,
  deps: CreateGoogleReaderRoutesDeps,
  params: ParamsBag,
): Promise<Response> {
  const action = params.get("ac");
  if (action === "unsubscribe") {
    const feed = await resolveFeedFromStream(deps.store, params.get("s"));
    if (feed === undefined) {
      return c.text("Subscription not found", 404);
    }
    const res = await deps.store.deleteUserFeed(feed.id);
    return res.ok ? c.text("OK") : mapFailureResponse(c, res);
  }
  if (action === "edit") {
    return await editExistingSubscription(c, deps.store, params);
  }
  return action === "subscribe"
    ? await subscribeNewFeed(c, deps, params)
    : c.text("Unsupported subscription action", 400);
}

function parseOptionalInt(
  raw: string | null,
  pattern: RegExp,
): number | undefined {
  if (raw === null || !pattern.test(raw)) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

async function handleStreamItemsIds(
  c: ReaderContext,
  store: FeedsRepository,
  now: number,
): Promise<Response> {
  c.header("Date", new Date(now * 1000).toUTCString());
  const qp = new URL(c.req.url).searchParams;
  const stream = await parseStreamTarget(qp.get("s") ?? undefined, store);
  if (stream === undefined) {
    return c.json({ error: "invalid stream" }, 400);
  }
  if (stream === "empty-feed") {
    return c.json({ itemRefs: [] });
  }
  const excludeRead = qp.getAll("xt").some((xt) => STATE_READ_PATTERN.test(xt));
  const minPublishedAt = parseOptionalInt(
    qp.get("ot"),
    NON_NEGATIVE_INT_PATTERN,
  );
  const limit = Math.min(
    10_000,
    Math.max(
      1,
      parseOptionalInt(qp.get("n"), NON_NEGATIVE_INT_PATTERN) ?? 1000,
    ),
  );
  const cursor = parseOptionalInt(qp.get("c"), POSITIVE_INT_PATTERN);
  const page = await store.queryReaderStreamIds({
    stream,
    excludeRead,
    limit,
    ...(minPublishedAt === undefined ? {} : { minPublishedAt }),
    ...(cursor === undefined ? {} : { cursor }),
  });
  return c.json({
    itemRefs: page.ids.map((id) => ({ id: String(id) })),
    ...(page.nextCursor === undefined
      ? {}
      : { continuation: String(page.nextCursor) }),
  });
}

async function applyEditTags(
  store: FeedsRepository,
  params: ParamsBag,
): Promise<void> {
  const ids = parseItemIds(params.getAll("i"));
  const addTags = params.getAll("a");
  const removeTags = params.getAll("r");
  let markRead: boolean | undefined;
  if (addTags.some((t) => STATE_READ_PATTERN.test(t))) {
    markRead = true;
  } else if (
    removeTags.some((t) => STATE_READ_PATTERN.test(t)) ||
    addTags.some((t) => STATE_KEPT_UNREAD_PATTERN.test(t))
  ) {
    markRead = false;
  }
  let markStarred: boolean | undefined;
  if (addTags.some((t) => STATE_STARRED_PATTERN.test(t))) {
    markStarred = true;
  } else if (removeTags.some((t) => STATE_STARRED_PATTERN.test(t))) {
    markStarred = false;
  }
  if (ids.length > 0 && (markRead !== undefined || markStarred !== undefined)) {
    await store.editEntryTags({
      ids,
      ...(markRead === undefined ? {} : { markRead }),
      ...(markStarred === undefined ? {} : { markStarred }),
    });
  }
}

function buildInnerReaderApp(
  deps: CreateGoogleReaderRoutesDeps,
): Hono<ReaderEnv> {
  const getNow = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const app = new Hono<ReaderEnv>();
  const checkToken = (c: ReaderContext, token: string | undefined): boolean =>
    verifyWriteToken({
      token,
      username: c.get("readerUsername"),
      nowSec: getNow(),
      secret: deps.writeTokenSecret,
    });

  app.post("/accounts/ClientLogin", async (c) => {
    const params = await readParams(c);
    const userOk = timingSafeEqual(
      sha256Buffer(params.get("Email") ?? ""),
      sha256Buffer(deps.readerUser),
    );
    const passOk = timingSafeEqual(
      sha256Buffer(params.get("Passwd") ?? ""),
      sha256Buffer(deps.readerPassword),
    );
    if (
      !userOk ||
      !passOk ||
      deps.readerUser.length === 0 ||
      deps.readerPassword.length === 0
    ) {
      return c.text("Error=BadAuthentication\n", 403);
    }
    const authToken = randomBytes(32).toString("hex");
    await deps.store.createReaderSession({
      tokenSha256: sha256Hex(authToken),
      username: deps.readerUser,
      nowSeconds: getNow(),
      ttlSeconds: SESSION_TTL_SECONDS,
    });
    return c.text(`SID=feeds\nLSID=null\nAuth=${authToken}\n`, 200);
  });

  app.use("/reader/api/0/*", async (c, next) => {
    const authHeader = c.req.header("authorization");
    const rawToken =
      authHeader === undefined
        ? undefined
        : GOOGLE_LOGIN_PATTERN.exec(authHeader)?.[1];
    const session =
      rawToken !== undefined && rawToken.length > 0
        ? await deps.store.validateReaderSession(sha256Hex(rawToken), getNow())
        : undefined;
    if (session === undefined) {
      return c.text("Unauthorized", 401);
    }
    c.set("readerUsername", session.username);
    await next();
    return;
  });

  app.get("/reader/api/0/token", (c) =>
    c.text(
      issueWriteToken(c.get("readerUsername"), getNow(), deps.writeTokenSecret),
      200,
    ),
  );

  app.get("/reader/api/0/tag/list", async (c) => {
    const revision = await deps.store.subscriptionsEtag();
    const etag = `"tags-${revision.replaceAll(/^"|"$/gu, "")}"`;
    c.header("ETag", etag);
    if (matchesIfNoneMatch(c.req.header("if-none-match"), etag)) {
      return c.body(null, 304);
    }
    const categories = await deps.store.listAllCategories();
    return c.json({
      tags: [
        { id: "user/-/state/com.google/starred" },
        ...categories.map((cat) => ({
          id: `user/-/label/${cat.label}`,
          type: "folder",
        })),
      ],
    });
  });

  app.get("/reader/api/0/subscription/list", async (c) => {
    const revision = await deps.store.subscriptionsEtag();
    const etag = `"subs-${revision.replaceAll(/^"|"$/gu, "")}"`;
    c.header("ETag", etag);
    if (matchesIfNoneMatch(c.req.header("if-none-match"), etag)) {
      return c.body(null, 304);
    }
    const feeds = await deps.store.listAllFeeds();
    return c.json({
      subscriptions: feeds.map((f) => ({
        id: `feed/${String(f.id)}`,
        title: f.title,
        categories: [
          { id: `user/-/label/${f.categoryLabel}`, label: f.categoryLabel },
        ],
        url: f.url,
        htmlUrl: f.htmlUrl ?? f.url,
      })),
    });
  });

  app.get("/reader/api/0/stream/items/ids", (c) =>
    handleStreamItemsIds(c, deps.store, getNow()),
  );

  app.post("/reader/api/0/stream/items/contents", async (c) => {
    const params = await readParams(c);
    if (!checkToken(c, params.get("T"))) {
      return c.text("Unauthorized", 401);
    }
    const requestedIds = parseItemIds(params.getAll("i"));
    const stored = await deps.store.getEntriesByIds(requestedIds);
    const byId = new Map(stored.map((entry) => [entry.id, entry]));
    const items = requestedIds.flatMap((id) => {
      const entry = byId.get(id);
      return entry === undefined ? [] : [formatEntryItem(entry)];
    });
    return c.json({
      id: "user/-/state/com.google/reading-list",
      updated: getNow(),
      items,
    });
  });

  app.post("/reader/api/0/edit-tag", async (c) => {
    const params = await readParams(c);
    if (!checkToken(c, params.get("T"))) {
      return c.text("Unauthorized", 401);
    }
    await applyEditTags(deps.store, params);
    return c.text("OK");
  });

  app.post("/reader/api/0/subscription/quickadd", async (c) => {
    const params = await readParams(c);
    if (!checkToken(c, params.get("T"))) {
      return c.text("Unauthorized", 401);
    }
    const quickadd = params.get("quickadd")?.trim() ?? "";
    if (quickadd.length === 0) {
      return c.json({ numResults: 0, error: "Missing feed URL" });
    }
    const res = await deps.poller.discoverAndSubscribe({ url: quickadd });
    return res.ok
      ? c.json({
          numResults: 1,
          query: quickadd,
          streamId: `feed/${String(res.feed.id)}`,
        })
      : c.json({ numResults: 0, error: res.message });
  });

  app.post("/reader/api/0/subscription/edit", async (c) => {
    const params = await readParams(c);
    return checkToken(c, params.get("T"))
      ? await handleSubscriptionEdit(c, deps, params)
      : c.text("Unauthorized", 401);
  });

  app.post("/reader/api/0/rename-tag", async (c) => {
    const params = await readParams(c);
    if (!checkToken(c, params.get("T"))) {
      return c.text("Unauthorized", 401);
    }
    const oldLabel = extractLabel(params.get("s"));
    const newLabel = extractLabel(params.get("dest"));
    if (oldLabel === undefined || newLabel === undefined) {
      return c.text("Invalid category label", 400);
    }
    const res = await deps.store.renameUserCategory(oldLabel, newLabel);
    return res.ok ? c.text("OK") : mapFailureResponse(c, res);
  });

  app.post("/reader/api/0/disable-tag", async (c) => {
    const params = await readParams(c);
    if (!checkToken(c, params.get("T"))) {
      return c.text("Unauthorized", 401);
    }
    const label = extractLabel(params.get("s")) ?? params.get("t")?.trim();
    if (label === undefined || label.length === 0) {
      return c.text("Invalid category label", 400);
    }
    const res = await deps.store.deleteUserCategory(label);
    return res.ok ? c.text("OK") : mapFailureResponse(c, res);
  });

  app.get("/reader/api/0/subscription/export", async (c) =>
    c.body(buildOpmlXml(await deps.store.listAllFeeds()), 200, {
      "Content-Type": "text/x-opml; charset=utf-8",
    }),
  );

  app.post("/reader/api/0/subscription/import", async (c) => {
    const { token, xmlText } = await parseImportPayload(c);
    if (!checkToken(c, token)) {
      return c.text("Unauthorized", 401);
    }
    return (await importOpmlXml(deps.store, xmlText))
      ? c.text("OK")
      : c.text("Invalid OPML document", 400);
  });

  return app;
}

export function createGoogleReaderRoutes(
  deps: CreateGoogleReaderRoutesDeps,
): Hono {
  const inner = buildInnerReaderApp(deps);
  const router = new Hono();
  router.route("/api/greader.php", inner);
  router.route("/", inner);
  return router;
}
