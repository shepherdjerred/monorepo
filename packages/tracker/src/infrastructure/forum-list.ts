import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { TrackerError } from "#domain/error.ts";
import { parseIdentifier, searchTokens } from "#domain/issue.ts";
import type {
  ForumInboxInput,
  ForumListInput,
  ForumSort,
} from "#shared/forum.ts";
import type { Database } from "./database.ts";
import {
  parseForumNumber,
  postSummaryInclude,
  presentPostSummary,
  type PostSummaryRecord,
} from "./forum-repository.ts";

type Sql = Prisma.Sql;
const { sql, join, raw } = Prisma;

const keyKinds = {
  time: {
    schema: z.string().regex(/^-?\d{1,18}$/u),
    select: (column: Sql) =>
      sql`(extract(epoch from ${column}) * 1000000)::bigint::text`,
    bind: (value: string | number | boolean) =>
      sql`(timestamp 'epoch' + ${value}::bigint * interval '1 microsecond')`,
  },
  int: {
    schema: z.number().int().min(0).max(2_147_483_647),
    select: (column: Sql) => sql`${column}::int`,
    bind: (value: string | number | boolean) => sql`${value}::int`,
  },
  float: {
    schema: z.number(),
    select: (column: Sql) => sql`${column}::float8`,
    bind: (value: string | number | boolean) => sql`${value}::float8`,
  },
  bool: {
    schema: z.boolean(),
    select: (column: Sql) => sql`${column}::boolean`,
    bind: (value: string | number | boolean) => sql`${value}::boolean`,
  },
} as const;

type SortKey = { expr: Sql; desc: boolean; kind: keyof typeof keyKinds };
type ForumPlan = { order: string; keys: SortKey[]; where: Sql };

const CursorSchema = z.strictObject({
  o: z.string(),
  k: z.array(z.union([z.string(), z.number(), z.boolean()])).max(8),
  id: z.string().min(1).max(200),
});
type Cursor = z.infer<typeof CursorSchema>;

const escapeLike = (value: string) =>
  value.replaceAll(/[\\%_]/gu, (match) => `\\${match}`);

function stateCondition(state: ForumListInput["state"], now: Date): Sql | null {
  const byState: Record<ForumListInput["state"], Sql | null> = {
    active: sql`(p."state" = 'open' AND (p."expiresAt" IS NULL OR p."expiresAt" > ${now}))`,
    open: sql`p."state" = 'open'`,
    resolved: sql`p."state" = 'resolved'`,
    expired: sql`(p."kind" = 'notice' AND p."state" = 'open' AND p."expiresAt" <= ${now})`,
    answered: sql`(p."kind" = 'question' AND p."acceptedReplyId" IS NOT NULL)`,
    unanswered: sql`(p."kind" = 'question' AND p."acceptedReplyId" IS NULL AND p."state" = 'open')`,
    pinned: sql`p."pinnedAt" IS NOT NULL`,
    all: null,
  };
  return byState[state];
}

function subscribedSql(viewerActorKey: string): Sql {
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM "ForumThreadState" fts JOIN "Actor" va ON va."id" = fts."actorId"
      WHERE fts."postId" = p."id" AND va."key" = ${viewerActorKey} AND fts."mode" = 'muted'
    )
    AND (
      EXISTS (
        SELECT 1 FROM "ForumThreadState" fts JOIN "Actor" va ON va."id" = fts."actorId"
        WHERE fts."postId" = p."id" AND va."key" = ${viewerActorKey} AND fts."mode" = 'subscribed'
      )
      OR EXISTS (SELECT 1 FROM "Actor" ca WHERE ca."id" = p."creatorId" AND ca."key" = ${viewerActorKey})
      OR EXISTS (SELECT 1 FROM "Actor" oa WHERE oa."id" = p."ownerId" AND oa."key" = ${viewerActorKey})
    )
  )`;
}

function unreadSql(viewerActorKey: string): Sql {
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM "ForumThreadState" fts JOIN "Actor" va ON va."id" = fts."actorId"
      WHERE fts."postId" = p."id" AND va."key" = ${viewerActorKey}
        AND (fts."mode" = 'muted' OR (fts."lastReadAt" IS NOT NULL AND p."lastActivityAt" <= fts."lastReadAt"))
    )
    AND (
      EXISTS (
        SELECT 1 FROM "ForumThreadState" fts JOIN "Actor" va ON va."id" = fts."actorId"
        WHERE fts."postId" = p."id" AND va."key" = ${viewerActorKey}
      )
      OR NOT EXISTS (SELECT 1 FROM "Actor" ca WHERE ca."id" = p."creatorId" AND ca."key" = ${viewerActorKey})
    )
  )`;
}

function metadataFilters(input: ForumListInput, now: Date): Sql[] {
  const conditions: Sql[] = [];
  if (input.kind !== undefined)
    conditions.push(sql`p."kind" = ${input.kind}::"ForumKind"`);
  if (input.scopes.length > 0)
    conditions.push(
      sql`(cardinality(p."scopes") = 0 OR p."scopes" && ARRAY[${join(input.scopes)}]::text[])`,
    );
  const stateSql = stateCondition(input.state, now);
  if (stateSql !== null) conditions.push(stateSql);
  if (input.projectSlug === null) conditions.push(sql`p."projectId" IS NULL`);
  else if (input.projectSlug !== undefined)
    conditions.push(
      sql`p."projectId" = (SELECT "id" FROM "Project" WHERE "slug" = ${input.projectSlug})`,
    );
  if (input.creatorKey !== undefined)
    conditions.push(
      sql`p."creatorId" = (SELECT "id" FROM "Actor" WHERE "key" = ${input.creatorKey})`,
    );
  if (input.ownerKey === null)
    conditions.push(sql`(p."kind" = 'notice' AND p."ownerId" IS NULL)`);
  else if (input.ownerKey !== undefined)
    conditions.push(
      sql`p."ownerId" = (SELECT "id" FROM "Actor" WHERE "key" = ${input.ownerKey})`,
    );
  return conditions;
}

function viewerAndRelationFilters(input: ForumListInput): Sql[] {
  const conditions: Sql[] = [];
  if (input.linkedIssueIdentifier !== undefined) {
    const ref = parseIdentifier(input.linkedIssueIdentifier);
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM "ForumIssueLink" fil
        JOIN "Issue" i ON i."id" = fil."issueId" JOIN "Team" t ON t."id" = i."teamId"
        WHERE fil."postId" = p."id" AND t."key" = ${ref.teamKey} AND i."number" = ${ref.number}
      )`,
    );
  }
  if (input.subscribedOnly) {
    conditions.push(
      input.viewerActorKey === undefined || input.viewerActorKey === ""
        ? sql`FALSE`
        : subscribedSql(input.viewerActorKey),
    );
  }
  if (input.unreadOnly) {
    conditions.push(
      input.viewerActorKey === undefined || input.viewerActorKey === ""
        ? sql`FALSE`
        : unreadSql(input.viewerActorKey),
    );
  }
  return conditions;
}

function searchFilter(query: string): Sql {
  const fmNumber = parseForumNumber(query);
  const tokens = searchTokens(query);
  const pattern = `%${escapeLike(query)}%`;
  const parts: Sql[] = [
    sql`p."title" ILIKE ${pattern} ESCAPE '\\'`,
    sql`p."body" ILIKE ${pattern} ESCAPE '\\'`,
    sql`p."exitCondition" ILIKE ${pattern} ESCAPE '\\'`,
    sql`similarity(p."title", ${query}) > 0.15`,
    ...(fmNumber === null ? [] : [sql`p."number" = ${fmNumber}`]),
  ];
  const replyPredicate =
    tokens === ""
      ? sql`r."body" ILIKE ${pattern} ESCAPE '\\'`
      : sql`(r."searchVector" @@ to_tsquery('english', ${tokens}) OR r."body" ILIKE ${pattern} ESCAPE '\\')`;
  if (tokens !== "") {
    parts.push(sql`p."searchVector" @@ to_tsquery('english', ${tokens})`);
  }
  parts.push(
    sql`EXISTS (SELECT 1 FROM "ForumReply" r WHERE r."postId" = p."id" AND r."deletedAt" IS NULL AND ${replyPredicate})`,
  );
  return sql`(${join(parts, " OR ")})`;
}

const explicitSorts: Record<ForumSort, SortKey[]> = {
  activity: [{ expr: sql`p."lastActivityAt"`, desc: true, kind: "time" }],
  newest: [{ expr: sql`p."createdAt"`, desc: true, kind: "time" }],
  votes: [
    { expr: sql`p."voteCount"`, desc: true, kind: "int" },
    { expr: sql`p."lastActivityAt"`, desc: true, kind: "time" },
  ],
  replies: [
    { expr: sql`p."replyCount"`, desc: true, kind: "int" },
    { expr: sql`p."lastActivityAt"`, desc: true, kind: "time" },
  ],
};

function defaultFeedKeys(state: ForumListInput["state"]): SortKey[] {
  return state === "resolved"
    ? [{ expr: sql`p."lastActivityAt"`, desc: true, kind: "time" }]
    : [
        { expr: sql`(p."pinnedAt" IS NOT NULL)`, desc: true, kind: "bool" },
        {
          expr: sql`COALESCE(p."pinnedAt", TIMESTAMP 'epoch')`,
          desc: true,
          kind: "time",
        },
        { expr: sql`(p."kind" = 'notice')`, desc: true, kind: "bool" },
        { expr: sql`p."lastActivityAt"`, desc: true, kind: "time" },
      ];
}

function searchSortKeys(query: string): SortKey[] {
  const fmNumber = parseForumNumber(query);
  const tokens = searchTokens(query);
  const exactBoost =
    fmNumber === null
      ? sql`0.0`
      : sql`(CASE WHEN p."number" = ${fmNumber} THEN 100.0 ELSE 0.0 END)`;
  const ftsRank =
    tokens === ""
      ? sql`0.0`
      : sql`(
          ts_rank_cd(p."searchVector", to_tsquery('english', ${tokens})) * 2.0 +
          COALESCE((
            SELECT MAX(ts_rank_cd(r."searchVector", to_tsquery('english', ${tokens})))
            FROM "ForumReply" r WHERE r."postId" = p."id" AND r."deletedAt" IS NULL
          ), 0.0) * 0.8
        )`;
  return [
    {
      expr: sql`(${exactBoost} + GREATEST(${ftsRank}, similarity(p."title", ${query})))::float8`,
      desc: true,
      kind: "float",
    },
    { expr: sql`p."lastActivityAt"`, desc: true, kind: "time" },
  ];
}

const encodeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");
const invalidCursor = () =>
  new TrackerError(
    "BAD_REQUEST",
    "Invalid cursor: restart the list from its first page",
  );
const alias = (index: number) => raw(`"k${String(index)}"`);
const column = (index: number) => raw(`q."k${String(index)}"`);

function decodeCursor(plan: ForumPlan, value: string): Cursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const cursor = CursorSchema.safeParse(decoded);
  if (
    !cursor.success ||
    cursor.data.o !== plan.order ||
    cursor.data.k.length !== plan.keys.length ||
    plan.keys.some(
      (key, index) =>
        !keyKinds[key.kind].schema.safeParse(cursor.data.k[index]).success,
    )
  )
    throw invalidCursor();
  return cursor.data;
}

function afterCursor(plan: ForumPlan, cursor: Cursor): Sql {
  let condition = sql`q."id" > ${cursor.id}`;
  for (const [index, key] of [...plan.keys.entries()].reverse()) {
    const value = cursor.k[index];
    if (value === undefined) throw invalidCursor();
    const bound = keyKinds[key.kind].bind(value);
    const beyond = key.desc
      ? sql`${column(index)} < ${bound}`
      : sql`${column(index)} > ${bound}`;
    condition = sql`(${beyond} OR (${column(index)} = ${bound} AND ${condition}))`;
  }
  return condition;
}

async function runPlan(
  database: Database,
  plan: ForumPlan,
  limit: number,
  rawCursor: string | undefined,
) {
  const cursor =
    rawCursor === undefined ? undefined : decodeCursor(plan, rawCursor);
  const keys = [...plan.keys.entries()];
  const [rows, counted] = await Promise.all([
    database.$queryRaw<Record<string, unknown>[]>`
      SELECT q."id", ${join(
        keys.map(
          ([index, key]) =>
            sql`${keyKinds[key.kind].select(column(index))} AS ${alias(index)}`,
        ),
      )}
      FROM (
        SELECT p."id", ${join(keys.map(([index, key]) => sql`${key.expr} AS ${alias(index)}`))}
        FROM "ForumPost" p WHERE ${plan.where}
      ) q
      WHERE ${cursor === undefined ? sql`TRUE` : afterCursor(plan, cursor)}
      ORDER BY ${join([
        ...keys.map(
          ([index, key]) =>
            sql`${column(index)} ${key.desc ? sql`DESC` : sql`ASC`}`,
        ),
        sql`q."id" ASC`,
      ])}
      LIMIT ${limit + 1}`,
    database.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS "total" FROM "ForumPost" p WHERE ${plan.where}`,
  ]);
  const more = rows.length > limit;
  const served = rows.slice(0, limit);
  const last = served.at(-1);
  return {
    ids: served.map((row) => z.string().parse(row["id"])),
    total: z
      .number()
      .int()
      .parse(counted[0]?.total ?? 0),
    nextCursor:
      more && last !== undefined
        ? encodeCursor({
            o: plan.order,
            k: keys.map(([index, key]) =>
              keyKinds[key.kind].schema.parse(last[`k${String(index)}`]),
            ),
            id: z.string().parse(last["id"]),
          })
        : null,
  };
}

async function loadSnippets(
  database: Database,
  ids: string[],
  query: string,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const tokens = searchTokens(query);
  const pattern = `%${escapeLike(query)}%`;
  const rows =
    tokens === ""
      ? await database.$queryRaw<{ id: string; snippet: string }[]>`
          SELECT p."id", left(p."body", 160) AS "snippet"
          FROM "ForumPost" p WHERE p."id" IN (${join(ids)})`
      : await database.$queryRaw<{ id: string; snippet: string }[]>`
          SELECT p."id", ts_headline(
            'english',
            CASE
              WHEN p."searchVector" @@ to_tsquery('english', ${tokens}) THEN p."body"
              ELSE COALESCE((
                SELECT r."body" FROM "ForumReply" r
                WHERE r."postId" = p."id" AND r."deletedAt" IS NULL
                  AND (r."searchVector" @@ to_tsquery('english', ${tokens}) OR r."body" ILIKE ${pattern} ESCAPE '\\')
                ORDER BY r."createdAt" DESC LIMIT 1
              ), p."body")
            END,
            to_tsquery('english', ${tokens}),
            'StartSel=, StopSel=, MaxWords=28, MinWords=8'
          ) AS "snippet"
          FROM "ForumPost" p WHERE p."id" IN (${join(ids)})`;
  return new Map(rows.map((row) => [row.id, row.snippet]));
}

async function hydratePosts(
  database: Database,
  ids: string[],
  options: {
    now: Date;
    viewerActorKey?: string | undefined;
    snippets?: ReadonlyMap<string, string> | undefined;
  },
) {
  if (ids.length === 0) return [];
  const records = await database.forumPost.findMany({
    where: { id: { in: ids } },
    include: postSummaryInclude(options.viewerActorKey),
  });
  const byId = new Map<string, PostSummaryRecord>(
    records.map((record) => [record.id, record]),
  );
  return ids.flatMap((id) => {
    const record = byId.get(id);
    return record === undefined
      ? []
      : [
          presentPostSummary(record, {
            now: options.now,
            viewerActorKey: options.viewerActorKey,
            searchSnippet: options.snippets?.get(id),
          }),
        ];
  });
}

export async function listForumPosts(
  database: Database,
  input: ForumListInput,
  now = new Date(),
) {
  const query = input.query?.trim() ?? "";
  const conditions = [
    sql`TRUE`,
    ...metadataFilters(input, now),
    ...viewerAndRelationFilters(input),
    ...(query === "" ? [] : [searchFilter(query)]),
  ];
  const order =
    input.sort === undefined
      ? query === ""
        ? `feed:${input.state}`
        : "search"
      : `sort:${input.sort}`;
  const keys =
    input.sort === undefined
      ? query === ""
        ? defaultFeedKeys(input.state)
        : searchSortKeys(query)
      : explicitSorts[input.sort];
  const plan: ForumPlan = { order, keys, where: join(conditions, " AND ") };
  const page = await runPlan(database, plan, input.limit, input.cursor);
  const snippets =
    query === "" ? undefined : await loadSnippets(database, page.ids, query);
  const items = await hydratePosts(database, page.ids, {
    now,
    viewerActorKey: input.viewerActorKey,
    snippets,
  });
  return {
    items,
    total: page.total,
    nextCursor: page.nextCursor,
    checkedAt: now.toISOString(),
  };
}

export async function listForumInbox(
  database: Database,
  input: ForumInboxInput,
  now = new Date(),
) {
  const conditions: Sql[] = [
    subscribedSql(input.viewerActorKey),
    ...(input.unreadOnly ? [unreadSql(input.viewerActorKey)] : []),
  ];
  const plan: ForumPlan = {
    order: "inbox",
    keys: [{ expr: sql`p."lastActivityAt"`, desc: true, kind: "time" }],
    where: join(conditions, " AND "),
  };
  const page = await runPlan(database, plan, input.limit, input.cursor);
  const items = await hydratePosts(database, page.ids, {
    now,
    viewerActorKey: input.viewerActorKey,
  });
  return {
    items,
    total: page.total,
    nextCursor: page.nextCursor,
    checkedAt: now.toISOString(),
  };
}

export async function listForumScopes(database: Database) {
  return database.$queryRaw<
    { scope: string; openCount: number; totalCount: number }[]
  >`
    SELECT
      s.scope AS "scope",
      COUNT(*) FILTER (WHERE p."state" = 'open')::int AS "openCount",
      COUNT(*)::int AS "totalCount"
    FROM "ForumPost" p,
    LATERAL unnest(p."scopes") AS s(scope)
    GROUP BY s.scope
    ORDER BY "openCount" DESC, s.scope ASC`;
}
