import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { parseIdentifier, searchTokens } from "#domain/issue.ts";
import { StateTypeSchema, type IssueListInput } from "#shared/schema.ts";
import type { Database } from "./database.ts";
import {
  keysetSqlParts,
  sliceKeysetRows,
  type SortKey,
} from "./keyset-cursor.ts";

/**
 * Issue lists page with a keyset: the cursor carries the sort key values and
 * the ID of the last row served, and the next page is every row that sorts
 * strictly after it. Rows edited, inserted or deleted between pages cannot
 * shift the remaining rows, and the cursor row itself need not still exist.
 */

type Sql = Prisma.Sql;
const { sql, join } = Prisma;

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
  urgency: [
    {
      expr: sql`CASE i."urgency"::text WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
      desc: false,
      kind: "int",
    },
  ],
  impact: [
    {
      expr: sql`CASE i."impact"::text WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
      desc: false,
      kind: "int",
    },
  ],
  effort: [
    {
      expr: sql`CASE i."effort"::text WHEN 'xs' THEN 1 WHEN 's' THEN 2 WHEN 'm' THEN 3 WHEN 'l' THEN 4 WHEN 'xl' THEN 5 ELSE 6 END`,
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

function nullableEnumFilter(column: Sql, values: readonly string[]): Sql[] {
  if (values.length === 0) return [];
  const named = values.filter((value) => value !== "none");
  const matches = [
    ...(values.includes("none") ? [sql`${column} IS NULL`] : []),
    ...(named.length === 0 ? [] : [sql`${column}::text IN (${join(named)})`]),
  ];
  return matches.length === 1 ? matches : [sql`(${join(matches, " OR ")})`];
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
    ...nullableEnumFilter(sql`i."urgency"`, input.urgencies),
    ...nullableEnumFilter(sql`i."impact"`, input.impacts),
    ...nullableEnumFilter(sql`i."effort"`, input.efforts),
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

type IssuePage = { ids: string[]; nextCursor: string | null };

async function page(
  db: Prisma.TransactionClient,
  plan: ListPlan,
  input: IssueListInput,
): Promise<IssuePage> {
  const parts = keysetSqlParts(plan, input.cursor);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT q."id", ${parts.outerSelect}
    FROM (
      SELECT i."id", ${parts.innerSelect}
      FROM "Issue" i WHERE ${plan.where}
      ${plan.trigram ? sql`OFFSET 0` : Prisma.empty}
    ) q
    WHERE ${parts.whereAfter}
    ORDER BY ${parts.orderBy}
    ${input.limit === "all" ? Prisma.empty : sql`LIMIT ${input.limit + 1}`}`;
  return sliceKeysetRows(plan, rows, input.limit);
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
