import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { TrackerError } from "#domain/error.ts";
import { parseIdentifier, searchTokens } from "#domain/issue.ts";
import {
  DueDateSchema,
  StateTypeSchema,
  type IssueListInput,
} from "#shared/schema.ts";
import type { Database } from "./database.ts";

/**
 * Issue lists page with a keyset: the cursor carries the sort key values and
 * the ID of the last row served, and the next page is every row that sorts
 * strictly after it. Rows edited, inserted or deleted between pages cannot
 * shift the remaining rows, and the cursor row itself need not still exist.
 */

type Sql = Prisma.Sql;
const { sql, join, raw } = Prisma;

/** How one sort key crosses the wire inside a cursor and returns to SQL. */
const keyKinds = {
  // Microseconds since the epoch, as text: exact for any timestamp column.
  time: {
    schema: z.string().regex(/^\d{1,16}$/u),
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
  date: {
    schema: DueDateSchema,
    select: (column: Sql) => sql`to_char(${column}, 'YYYY-MM-DD')`,
    bind: (value: string | number | boolean) => sql`${value}::date`,
  },
} as const;
type SortKey = { expr: Sql; desc: boolean; kind: keyof typeof keyKinds };

const issueSorts: Record<IssueListInput["sort"], SortKey[]> = {
  updated: [{ expr: sql`i."updatedAt"`, desc: true, kind: "time" }],
  created: [{ expr: sql`i."createdAt"`, desc: true, kind: "time" }],
  // Priority 0 means "No priority": it sorts after Low (4), never first.
  priority: [
    {
      expr: sql`CASE i."priority" WHEN 0 THEN 5 ELSE i."priority" END`,
      desc: false,
      kind: "int",
    },
  ],
  votes: [{ expr: sql`i."voteCount"`, desc: true, kind: "int" }],
  board: [{ expr: sql`i."boardOrder"`, desc: false, kind: "float" }],
  // Soonest first; issues without a due date come last.
  due: [
    { expr: sql`(i."dueDate" IS NULL)`, desc: false, kind: "bool" },
    {
      expr: sql`COALESCE(i."dueDate", DATE '0001-01-01')`,
      desc: false,
      kind: "date",
    },
  ],
};

/** Best match first, then open issues, then the most recently updated. */
function rankedSort(tokens: string, text: string): SortKey[] {
  return [
    {
      expr: sql`GREATEST(ts_rank_cd(i."searchVector", to_tsquery('english', ${tokens})) * 2, similarity(i."title", ${text}))::float8`,
      desc: true,
      kind: "float",
    },
    {
      expr: sql`(i."completedAt" IS NULL AND i."canceledAt" IS NULL)`,
      desc: true,
      kind: "bool",
    },
    { expr: sql`i."updatedAt"`, desc: true, kind: "time" },
  ];
}

function hierarchyFilters(input: IssueListInput): Sql[] {
  const parent =
    input.parentIdentifier === undefined
      ? undefined
      : parseIdentifier(input.parentIdentifier);
  return [
    ...(parent === undefined
      ? []
      : [
          sql`i."parentId" = (SELECT p."id" FROM "Issue" p JOIN "Team" t ON t."id" = p."teamId" WHERE t."key" = ${parent.teamKey} AND p."number" = ${parent.number})`,
        ]),
    ...(input.hasParent === undefined
      ? []
      : [
          input.hasParent
            ? sql`i."parentId" IS NOT NULL`
            : sql`i."parentId" IS NULL`,
        ]),
  ];
}

function dueFilters(input: IssueListInput): Sql[] {
  if (input.overdue !== undefined && input.today === undefined)
    throw new Error("The overdue filter was not given a date");
  return [
    ...(input.dueBefore === undefined
      ? []
      : [sql`i."dueDate" <= ${input.dueBefore}::date`]),
    ...(input.dueAfter === undefined
      ? []
      : [sql`i."dueDate" >= ${input.dueAfter}::date`]),
    ...(input.hasDueDate === undefined
      ? []
      : [
          input.hasDueDate
            ? sql`i."dueDate" IS NOT NULL`
            : sql`i."dueDate" IS NULL`,
        ]),
    ...(input.overdue === undefined
      ? []
      : [
          input.overdue
            ? sql`i."dueDate" < ${input.today}::date`
            : sql`(i."dueDate" IS NULL OR i."dueDate" >= ${input.today}::date)`,
        ]),
  ];
}

function filters(input: IssueListInput): Sql[] {
  const types = input.states.filter(
    (state) => StateTypeSchema.safeParse(state).success,
  );
  const names = input.states.filter((state) => !types.includes(state));
  const stateMatches = [
    ...(types.length === 0 ? [] : [sql`s."type"::text IN (${join(types)})`]),
    ...(names.length === 0 ? [] : [sql`s."name" IN (${join(names)})`]),
  ];
  return [
    ...(input.teamKey === undefined
      ? []
      : [
          sql`i."teamId" = (SELECT "id" FROM "Team" WHERE "key" = ${input.teamKey})`,
        ]),
    ...(input.projectSlug === undefined
      ? []
      : [
          sql`i."projectId" = (SELECT "id" FROM "Project" WHERE "slug" = ${input.projectSlug})`,
        ]),
    ...(input.assigneeKey === undefined
      ? []
      : [
          sql`i."assigneeId" = (SELECT "id" FROM "Actor" WHERE "key" = ${input.assigneeKey})`,
        ]),
    ...(input.creatorKey === undefined
      ? []
      : [
          sql`i."creatorId" = (SELECT "id" FROM "Actor" WHERE "key" = ${input.creatorKey})`,
        ]),
    ...(input.priority === undefined
      ? []
      : [sql`i."priority" = ${input.priority}`]),
    ...(input.includeArchived ? [] : [sql`i."archivedAt" IS NULL`]),
    ...hierarchyFilters(input),
    ...dueFilters(input),
    ...input.labels.map(
      (name) =>
        sql`EXISTS (SELECT 1 FROM "IssueLabel" il JOIN "Label" l ON l."id" = il."labelId" WHERE il."issueId" = i."id" AND l."name" = ${name})`,
    ),
    ...(input.states.length === 0
      ? []
      : [
          sql`EXISTS (SELECT 1 FROM "WorkflowState" s WHERE s."id" = i."stateId" AND (${join(stateMatches, " OR ")}))`,
        ]),
  ];
}

type ListPlan = {
  /** Names the ordering a cursor was issued for. */
  order: string;
  keys: SortKey[];
  where: Sql;
  /**
   * A ranked search: it uses the `%` operator, which needs the similarity
   * threshold, and its rank is fenced so it is computed once per row.
   */
  trigram: boolean;
};

/** Returns null when the search text has nothing to match on. */
function listPlan(input: IssueListInput): ListPlan | null {
  const conditions = filters(input);
  const where = (extra: Sql[]) =>
    join([sql`TRUE`, ...conditions, ...extra], " AND ");
  const text = input.search?.trim() ?? "";
  if (text === "")
    return {
      order: input.sort,
      keys: issueSorts[input.sort],
      where: where([]),
      trigram: false,
    };
  if (/^[a-z][a-z0-9]*[- ][1-9]\d*$/iu.test(text)) {
    const reference = parseIdentifier(text);
    return {
      order: input.sort,
      keys: issueSorts[input.sort],
      where: where([
        sql`i."teamId" = (SELECT "id" FROM "Team" WHERE "key" = ${reference.teamKey})`,
        sql`i."number" = ${reference.number}`,
      ]),
      trigram: false,
    };
  }
  const tokens = searchTokens(text);
  if (tokens === "") return null;
  return {
    order: "search",
    keys: rankedSort(tokens, text),
    where: where([
      sql`(i."searchVector" @@ to_tsquery('english', ${tokens}) OR i."title" % ${text})`,
    ]),
    trigram: true,
  };
}

const CursorSchema = z.strictObject({
  o: z.string(),
  k: z.array(z.union([z.string(), z.number(), z.boolean()])).max(8),
  id: z.string().min(1).max(200),
});
type Cursor = z.infer<typeof CursorSchema>;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function invalidCursor(): TrackerError {
  return new TrackerError(
    "BAD_REQUEST",
    "Invalid cursor: restart the list from its first page",
  );
}

function decodeCursor(plan: ListPlan, value: string): Cursor {
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

const alias = (index: number) => raw(`"k${String(index)}"`);
const column = (index: number) => raw(`q."k${String(index)}"`);

/** Rows that sort strictly after the cursor under the plan's ordering. */
function after(plan: ListPlan, cursor: Cursor): Sql {
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

type IssuePage = { ids: string[]; nextCursor: string | null };

async function page(
  db: Prisma.TransactionClient,
  plan: ListPlan,
  input: IssueListInput,
): Promise<IssuePage> {
  const cursor =
    input.cursor === undefined ? undefined : decodeCursor(plan, input.cursor);
  const keys = [...plan.keys.entries()];
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT q."id", ${join(
      keys.map(
        ([index, key]) =>
          sql`${keyKinds[key.kind].select(column(index))} AS ${alias(index)}`,
      ),
    )}
    FROM (
      SELECT i."id", ${join(keys.map(([index, key]) => sql`${key.expr} AS ${alias(index)}`))}
      FROM "Issue" i WHERE ${plan.where}
      ${plan.trigram ? sql`OFFSET 0` : Prisma.empty}
    ) q
    WHERE ${cursor === undefined ? sql`TRUE` : after(plan, cursor)}
    ORDER BY ${join([
      ...keys.map(
        ([index, key]) =>
          sql`${column(index)} ${key.desc ? sql`DESC` : sql`ASC`}`,
      ),
      sql`q."id" ASC`,
    ])}
    ${input.limit === "all" ? Prisma.empty : sql`LIMIT ${input.limit + 1}`}`;
  const more = input.limit !== "all" && rows.length > input.limit;
  const served = input.limit === "all" ? rows : rows.slice(0, input.limit);
  const last = served.at(-1);
  return {
    ids: served.map((row) => z.string().parse(row["id"])),
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

/**
 * One page of matching issue IDs in list order, plus the number of issues
 * the filter matches regardless of cursor and limit.
 */
export async function issuePage(
  database: Database,
  input: IssueListInput,
): Promise<IssuePage & { total: number }> {
  const plan = listPlan(input);
  if (plan === null) return { ids: [], nextCursor: null, total: 0 };
  const read = async (db: Prisma.TransactionClient) => {
    const result = await page(db, plan, input);
    if (input.limit === "all" && input.cursor === undefined)
      return { ...result, total: result.ids.length };
    const counted = await db.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS "total" FROM "Issue" i WHERE ${plan.where}`;
    return {
      ...result,
      total: z.number().int().parse(counted[0]?.total),
    };
  };
  if (!plan.trigram) return read(database);
  return database.$transaction(async (db) => {
    await db.$executeRaw`SET LOCAL pg_trgm.similarity_threshold = 0.25`;
    return read(db);
  });
}
